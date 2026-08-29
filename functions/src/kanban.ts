import { FieldPath, FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  assertTeamMemberInTransaction,
  auditRecord,
  getInput,
  isReplayOfOwnCreate,
  requireString,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember,
  type TeamAdmin
} from './phase2.js';

type KanbanRequest = CallableRequest<Record<string, unknown>>;

/**
 * gRPC status codes the Firestore Admin SDK throws. `onCall` turns anything that is
 * not an HttpsError into a bare `INTERNAL [500]`, which hides the one detail that
 * makes these failures fixable — so translate the operational ones into typed errors
 * that say what to do. Unrecognized failures stay generic: their real text goes to
 * Cloud Logging rather than to a client that may not be an admin.
 */
const FIRESTORE_STATUS = { notFound: 5, permissionDenied: 7, resourceExhausted: 8, failedPrecondition: 9, aborted: 10, unavailable: 14, deadlineExceeded: 4 } as const;

export function describeFirestoreFailure(error: unknown, includeOperatorDetail = false): never {
  if (error instanceof HttpsError) throw error;
  const code = (error as { code?: unknown }).code;
  // Read `message` structurally: gRPC rejections are not always Error instances, and
  // the index-creation link lives in that string.
  const reported = (error as { message?: unknown } | null)?.message;
  const detail = typeof reported === 'string' && reported ? reported : String(error);
  if (code === FIRESTORE_STATUS.failedPrecondition) {
    // Almost always a composite index that is missing or still building. The raw
    // Firestore text carries the project id, collection paths, and the index
    // console link — operator information that must not reach an ordinary team
    // member, so it is logged here and only echoed to a platform admin.
    console.error('Kanban query needs a Firestore index', error);
    const guidance = 'A Firestore index this board needs is missing or still building. Retry in a few minutes, or ask an administrator to check the server logs.';
    throw new HttpsError('failed-precondition', includeOperatorDetail ? `${guidance} ${detail}` : guidance);
  }
  if (code === FIRESTORE_STATUS.permissionDenied) throw new HttpsError('permission-denied', 'The server is not allowed to read this team\'s board data.');
  if (code === FIRESTORE_STATUS.aborted) throw new HttpsError('aborted', 'The board changed while this request ran. Retry.');
  if (code === FIRESTORE_STATUS.resourceExhausted) throw new HttpsError('resource-exhausted', 'Firestore is rate limiting this project. Retry shortly.');
  if (code === FIRESTORE_STATUS.unavailable || code === FIRESTORE_STATUS.deadlineExceeded) {
    throw new HttpsError('unavailable', 'Firestore did not respond in time. Retry shortly.');
  }
  if (code === FIRESTORE_STATUS.notFound) throw new HttpsError('not-found', 'A record this board needs was not found.');
  console.error('Unhandled kanban command failure', error);
  throw new HttpsError('internal', 'The board could not be loaded. The server logged the reason.');
}

/** Wraps a callable so Firestore failures reach the client as typed, actionable errors. */
export function withBoardErrors<TRequest, TResult>(command: (request: TRequest) => Promise<TResult>) {
  return async (request: TRequest): Promise<TResult> => {
    try {
      return await command(request);
    } catch (error) {
      const auth = (request as { auth?: { token?: { platformAdmin?: unknown } } } | null)?.auth;
      return describeFirestoreFailure(error, auth?.token?.platformAdmin === true);
    }
  };
}

export const MAX_PROJECTS_PER_TEAM = 10;
export const MIN_COLUMNS_PER_PROJECT = 2;
export const MAX_COLUMNS_PER_PROJECT = 8;
export const MAX_CARDS_PER_COLUMN_PAGE = 50;
export const ORDER_STEP = 1024;
const MIGRATION_PAGE_SIZE = 200;

export type ProjectColumn = {
  id: string;
  name: string;
  color: string;
};

export const DEFAULT_PROJECT_COLUMNS: ProjectColumn[] = [
  { id: 'todo', name: 'To Do', color: 'blue' },
  { id: 'inProgress', name: 'In Progress', color: 'purple' },
  { id: 'review', name: 'Review', color: 'orange' },
  { id: 'completed', name: 'Completed', color: 'green' }
];

const COLUMN_COLORS = ['blue', 'purple', 'orange', 'green', 'slate', 'pink'] as const;

function inputRecord(request: KanbanRequest) {
  return request.data ?? {};
}

function has(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function isAdmin(actor: TeamAdmin) {
  return actor.platformAdmin || actor.role === 'coach' || actor.role === 'teamLeader';
}

function optionalId(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, label, 128);
}

function operationId(input: Record<string, unknown>, prefix: string) {
  return `${prefix}_${requireString(input.operationId, 'Operation ID', 120)}`;
}

function operationRef(teamId: string, id: string) {
  return getFirestore().doc(`kanbanOperations/${teamId}_${id}`);
}

function entityId(input: Record<string, unknown>, key: string, prefix: string, fallback: string) {
  if (input[key] !== undefined) return requireString(input[key], `${prefix} ID`, 128);
  if (input.operationId !== undefined) return `${prefix}_${requireString(input.operationId, 'Operation ID', 96)}`;
  return fallback;
}

function projectColumns(project: DocumentData): ProjectColumn[] {
  if (!Array.isArray(project.columns)) throw new HttpsError('failed-precondition', 'Project workflow is invalid.');
  return project.columns.map((column: unknown) => {
    if (!column || typeof column !== 'object') throw new HttpsError('failed-precondition', 'Project workflow is invalid.');
    const record = column as Record<string, unknown>;
    return {
      id: requireString(record.id, 'Column ID', 128),
      name: requireString(record.name, 'Column name', 40),
      color: COLUMN_COLORS.includes(record.color as typeof COLUMN_COLORS[number]) ? String(record.color) : 'slate'
    };
  });
}

/**
 * Column edits rewrite the whole `columns` array, so two admins reordering or
 * renaming at once used to be last-write-wins. Every column mutation now carries
 * the version it was based on; projects created before the field existed count
 * as version 1.
 */
export function nextProjectVersion(currentVersion: unknown, expectedVersion: unknown): number {
  const expected = Number(expectedVersion);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > 1_000_000) {
    throw new HttpsError('invalid-argument', 'Expected project version must be a positive integer.');
  }
  const currentRaw = currentVersion ?? 1;
  const current = Number.isSafeInteger(Number(currentRaw)) && Number(currentRaw) >= 1 ? Number(currentRaw) : 1;
  if (current !== expected) {
    throw new HttpsError('aborted', 'This board\'s workflow changed while you were editing it. Reload the board before saving.');
  }
  return current + 1;
}

function requireProject(project: FirebaseFirestore.DocumentSnapshot, teamId: string) {
  const data = project.data();
  if (!project.exists || data?.teamId !== teamId || data.archived === true) {
    throw new HttpsError('not-found', 'Project not found in this team.');
  }
  return data;
}

function requireColumn(project: DocumentData, columnId: string) {
  const columns = projectColumns(project);
  if (!columns.some((column) => column.id === columnId)) throw new HttpsError('not-found', 'Project column not found.');
  return columns;
}

function statusForColumn(columnId: string, completedColumnId: string) {
  if (columnId === completedColumnId) return 'completed';
  if (columnId === 'review') return 'review';
  if (columnId === 'inProgress') return 'inProgress';
  return 'todo';
}

function taskRecipients(task: DocumentData, actorUserId: string) {
  return [...new Set([
    typeof task.assignedTo === 'string' ? task.assignedTo : '',
    ...(Array.isArray(task.watcherUserIds) ? task.watcherUserIds.map(String) : [])
  ])].filter((userId) => userId && userId !== actorUserId);
}

async function notificationRecords(transaction: Transaction, recipients: string[], teamId: string, dedupeKey: string) {
  const db = getFirestore();
  const refs = recipients.map((recipient) => db.doc(`notifications/${Buffer.from(`${recipient}_${teamId}_${dedupeKey}`).toString('base64url')}`));
  const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
  return refs.map((ref, index) => ({ ref, exists: snapshots[index].exists, recipientUserId: recipients[index] }));
}

function writeMoveNotifications(
  transaction: Transaction,
  records: Awaited<ReturnType<typeof notificationRecords>>,
  teamId: string,
  task: DocumentData,
  projectId: string,
  dedupeKey: string
) {
  const now = FieldValue.serverTimestamp();
  for (const record of records) {
    if (record.exists) continue;
    transaction.set(record.ref, {
      id: record.ref.id,
      teamId,
      createdBy: 'system',
      recipientUserId: record.recipientUserId,
      type: 'task.updated',
      title: 'Task moved',
      body: String(task.title ?? 'Task'),
      deepLink: `/coordination?project=${encodeURIComponent(projectId)}&task=${encodeURIComponent(String(task.id ?? ''))}`,
      dedupeKey,
      mandatory: false,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
  }
}

export function orderBetween(before?: number, after?: number) {
  if (before !== undefined && after !== undefined) {
    if (!(before < after)) throw new HttpsError('aborted', 'Card order changed. Refresh the board and try again.');
    return before + (after - before) / 2;
  }
  if (before !== undefined) return before + ORDER_STEP;
  if (after !== undefined) return after - ORDER_STEP;
  return ORDER_STEP;
}

export function legacyTaskColumn(status: unknown) {
  return ['todo', 'inProgress', 'review', 'completed'].includes(String(status)) ? String(status) : 'todo';
}

export function legacyOrderKey(previousCount: number) {
  if (!Number.isInteger(previousCount) || previousCount < 0) throw new HttpsError('failed-precondition', 'Legacy task ordering is invalid.');
  return (previousCount + 1) * ORDER_STEP;
}

export function columnHasCapacity(cardCount: number, cardAlreadyInTarget = false) {
  return cardCount - (cardAlreadyInTarget ? 1 : 0) < MAX_CARDS_PER_COLUMN_PAGE;
}

export const ensureDefaultProject = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  await requireTeamMember(request, teamId);
  const db = getFirestore();
  const projectId = `default_${teamId}`;
  const projectRef = db.doc(`projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (projectSnapshot.exists && projectSnapshot.data()?.migrationVersion === 1) {
    return { projectId, created: false, migratedTaskCount: 0 };
  }
  const actor = await requireTeamAdmin(request, teamId);
  let created = false;
  if (!projectSnapshot.exists) {
    await db.runTransaction(async (transaction) => {
      await assertTeamAdminInTransaction(transaction, teamId, actor);
      const existing = await transaction.get(projectRef);
      if (existing.exists) return;
      const now = FieldValue.serverTimestamp();
      transaction.set(projectRef, {
        id: projectId,
        teamId,
        createdBy: actor.uid,
        name: 'Team Board',
        description: 'Shared team work carried forward from the Tracker.',
        columns: DEFAULT_PROJECT_COLUMNS,
        completedColumnId: 'completed',
        archived: false,
        version: 1,
        migrationVersion: 0,
        migrationCursor: null,
        migrationColumnCounts: {},
        createdAt: now,
        updatedAt: now
      });
      transaction.set(db.collection('auditEvents').doc(), auditRecord({
        type: 'administrative.action',
        actorUserId: actor.uid,
        teamId,
        targetResource: `projects/${projectId}`,
        metadata: { action: 'kanban.default-project.created' }
      }));
      created = true;
    });
  }

  const requestedCursor = optionalId(getInput(request, 'cursor'), 'Migration cursor');
  let result: { migratedTaskCount: number; nextCursor: string | null } = { migratedTaskCount: 0, nextCursor: null };
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const current = (await transaction.get(projectRef)).data();
    if (current?.migrationVersion === 1) {
      result = { migratedTaskCount: 0, nextCursor: null };
      return;
    }
    const storedCursor = typeof current?.migrationCursor === 'string' ? current.migrationCursor : null;
    if (requestedCursor !== null && requestedCursor !== storedCursor) {
      throw new HttpsError('aborted', 'The legacy migration advanced in another session. Retry project loading.');
    }

    let legacyQuery = db.collection('tasks')
      .where('teamId', '==', teamId)
      .orderBy(FieldPath.documentId())
      .limit(MIGRATION_PAGE_SIZE);
    if (storedCursor) legacyQuery = legacyQuery.startAfter(storedCursor);
    const legacyTasks = await transaction.get(legacyQuery);
    const storedCounts = current?.migrationColumnCounts && typeof current.migrationColumnCounts === 'object'
      ? current.migrationColumnCounts as Record<string, unknown>
      : {};
    const lastCardSnapshots = Object.keys(storedCounts).length
      ? []
      : await Promise.all(DEFAULT_PROJECT_COLUMNS.map((column) => transaction.get(db.collection('tasks')
        .where('teamId', '==', teamId)
        .where('projectId', '==', projectId)
        .where('columnId', '==', column.id)
        .orderBy('orderKey', 'desc')
        .limit(1))));
    const columnCounts = new Map(DEFAULT_PROJECT_COLUMNS.map((column, index) => {
      const stored = Number(storedCounts[column.id]);
      const lastOrder = Number(lastCardSnapshots[index]?.docs[0]?.data().orderKey ?? 0);
      return [column.id, Number.isFinite(stored) && stored >= 0 ? stored : Math.ceil(lastOrder / ORDER_STEP)];
    }));
    const tasksToMigrate = legacyTasks.docs.filter((snapshot) => {
      const task = snapshot.data();
      return typeof task.projectId !== 'string' || typeof task.columnId !== 'string';
    });
    const goalIds = [...new Set(tasksToMigrate.map((snapshot) => snapshot.data().goalId).filter((goalId): goalId is string => typeof goalId === 'string'))];
    const goalSnapshots = await Promise.all(goalIds.map((goalId) => transaction.get(db.doc(`goals/${goalId}`))));
    const validGoals = new Map(goalSnapshots
      .filter((snapshot) => snapshot.exists && snapshot.data()?.teamId === teamId)
      .map((snapshot) => [snapshot.id, snapshot.ref]));
    const goalCounts = new Map<string, { taskCount: number; completedTaskCount: number }>();

    for (const snapshot of tasksToMigrate) {
      const task = snapshot.data();
      const columnId = legacyTaskColumn(task.status);
      const previousCount = columnCounts.get(columnId) ?? 0;
      const index = previousCount + 1;
      columnCounts.set(columnId, index);
      transaction.update(snapshot.ref, {
        projectId,
        columnId,
        orderKey: legacyOrderKey(previousCount),
        version: Number.isInteger(task.version) ? task.version : 1,
        completedAt: columnId === 'completed' ? task.updatedAt ?? FieldValue.serverTimestamp() : null
      });
      if (typeof task.goalId === 'string' && validGoals.has(task.goalId)) {
        const counts = goalCounts.get(task.goalId) ?? { taskCount: 0, completedTaskCount: 0 };
        counts.taskCount += 1;
        if (columnId === 'completed') counts.completedTaskCount += 1;
        goalCounts.set(task.goalId, counts);
      }
    }
    for (const [goalId, counts] of goalCounts) {
      transaction.update(validGoals.get(goalId)!, {
        taskCount: FieldValue.increment(counts.taskCount),
        completedTaskCount: FieldValue.increment(counts.completedTaskCount),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    const nextCursor = legacyTasks.size === MIGRATION_PAGE_SIZE ? legacyTasks.docs.at(-1)?.id ?? null : null;
    transaction.update(projectRef, {
      migrationVersion: nextCursor ? 0 : 1,
      migrationCursor: nextCursor,
      migrationColumnCounts: Object.fromEntries(columnCounts),
      updatedAt: FieldValue.serverTimestamp()
    });
    result = { migratedTaskCount: tasksToMigrate.length, nextCursor };
  });
  return { projectId, created, ...result };
};

export const createProject = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const name = requireString(input.name, 'Project name', 80);
  const description = input.description === undefined ? '' : requireString(input.description, 'Project description', 1000);
  const db = getFirestore();
  const projectId = entityId(input, 'projectId', 'project', db.collection('projects').doc().id);
  const projectRef = db.doc(`projects/${projectId}`);
  const opRef = operationRef(teamId, operationId(input, 'createProject'));
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const [existing, operation, activeProjects] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(opRef),
      transaction.get(db.collection('projects').where('teamId', '==', teamId).where('archived', '==', false).limit(MAX_PROJECTS_PER_TEAM))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Project')) return;
    if (activeProjects.size >= MAX_PROJECTS_PER_TEAM) throw new HttpsError('resource-exhausted', `A team can have at most ${MAX_PROJECTS_PER_TEAM} active projects.`);
    const now = FieldValue.serverTimestamp();
    transaction.set(projectRef, {
      id: projectId,
      teamId,
      createdBy: admin.uid,
      name,
      description,
      columns: DEFAULT_PROJECT_COLUMNS,
      completedColumnId: 'completed',
      archived: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'project.create', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.project.created' } }));
  });
  return { projectId };
};

export const updateProject = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const updates: Record<string, unknown> = {};
  if (has(input, 'name')) updates.name = requireString(input.name, 'Project name', 80);
  if (has(input, 'description')) updates.description = requireString(input.description, 'Project description', 1000);
  if (!Object.keys(updates).length) throw new HttpsError('invalid-argument', 'No project changes were provided.');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    requireProject(await transaction.get(ref), teamId);
    transaction.update(ref, { ...updates, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.project.updated' } }));
  });
  return { projectId };
};

export const archiveProject = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const projectId = requireString(getInput(request, 'projectId'), 'Project ID', 128);
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const [project, activeProjects] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.collection('projects').where('teamId', '==', teamId).where('archived', '==', false).limit(2))
    ]);
    requireProject(project, teamId);
    if (activeProjects.size <= 1) throw new HttpsError('failed-precondition', 'A team needs at least one active project.');
    transaction.update(ref, { archived: true, archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.project.archived' } }));
  });
  return { projectId, archived: true as const };
};

export const addProjectColumn = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const name = requireString(input.name, 'Column name', 40);
  const columnId = entityId(input, 'columnId', 'column', getFirestore().collection('projects').doc().id);
  const color = COLUMN_COLORS.includes(input.color as typeof COLUMN_COLORS[number]) ? String(input.color) : 'slate';
  const expectedVersion = input.expectedVersion;
  const db = getFirestore();
  let committedVersion = 1;
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const project = requireProject(await transaction.get(ref), teamId);
    const columns = projectColumns(project);
    committedVersion = Number(project.version ?? 1);
    if (columns.length >= MAX_COLUMNS_PER_PROJECT) throw new HttpsError('resource-exhausted', `A project can have at most ${MAX_COLUMNS_PER_PROJECT} columns.`);
    if (columns.some((column) => column.id === columnId)) return;
    // `expectedVersion` is optional here only because adding a column is
    // append-only; when the caller supplies it, it is enforced like every other
    // workflow edit.
    committedVersion = nextProjectVersion(project.version, expectedVersion ?? project.version ?? 1);
    transaction.update(ref, { columns: [...columns, { id: columnId, name, color }], version: committedVersion, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.column.created' } }));
  });
  return { projectId, columnId, version: committedVersion };
};

export const updateProjectColumn = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const columnId = requireString(input.columnId, 'Column ID', 128);
  const expectedVersion = input.expectedVersion;
  const db = getFirestore();
  let committedVersion = 1;
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const project = requireProject(await transaction.get(ref), teamId);
    const columns = requireColumn(project, columnId);
    committedVersion = nextProjectVersion(project.version, expectedVersion);
    const nextColumns = columns.map((column) => column.id === columnId ? {
      ...column,
      ...(has(input, 'name') ? { name: requireString(input.name, 'Column name', 40) } : {}),
      ...(has(input, 'color') && COLUMN_COLORS.includes(input.color as typeof COLUMN_COLORS[number]) ? { color: String(input.color) } : {})
    } : column);
    const changes: Record<string, unknown> = { columns: nextColumns, version: committedVersion, updatedAt: FieldValue.serverTimestamp() };
    if (input.isCompleted === true && project.completedColumnId !== columnId) {
      const cards = await transaction.get(db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).limit(1));
      if (!cards.empty) throw new HttpsError('failed-precondition', 'The completion column can change only while the project has no cards.');
      changes.completedColumnId = columnId;
    }
    transaction.update(ref, changes);
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.column.updated' } }));
  });
  return { projectId, columnId, version: committedVersion };
};

export const reorderProjectColumns = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  if (!Array.isArray(input.columnIds)) throw new HttpsError('invalid-argument', 'Column order must be a list.');
  const columnIds = input.columnIds.map((id) => requireString(id, 'Column ID', 128));
  const expectedVersion = input.expectedVersion;
  const db = getFirestore();
  let committedVersion = 1;
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const project = requireProject(await transaction.get(ref), teamId);
    const columns = projectColumns(project);
    committedVersion = nextProjectVersion(project.version, expectedVersion);
    if (columnIds.length !== columns.length || new Set(columnIds).size !== columns.length || columns.some((column) => !columnIds.includes(column.id))) {
      throw new HttpsError('invalid-argument', 'Column order must include every project column exactly once.');
    }
    const byId = new Map(columns.map((column) => [column.id, column]));
    transaction.update(ref, { columns: columnIds.map((id) => byId.get(id)), version: committedVersion, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.columns.reordered' } }));
  });
  return { projectId, columnIds, version: committedVersion };
};

export const removeProjectColumn = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const projectId = requireString(getInput(request, 'projectId'), 'Project ID', 128);
  const columnId = requireString(getInput(request, 'columnId'), 'Column ID', 128);
  const expectedVersion = getInput(request, 'expectedVersion');
  const db = getFirestore();
  let committedVersion = 1;
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const project = requireProject(await transaction.get(ref), teamId);
    const columns = requireColumn(project, columnId);
    committedVersion = nextProjectVersion(project.version, expectedVersion);
    if (columns.length <= MIN_COLUMNS_PER_PROJECT) throw new HttpsError('failed-precondition', `A project needs at least ${MIN_COLUMNS_PER_PROJECT} columns.`);
    if (project.completedColumnId === columnId) throw new HttpsError('failed-precondition', 'The completion column cannot be removed.');
    const cards = await transaction.get(db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).where('columnId', '==', columnId).limit(1));
    if (!cards.empty) throw new HttpsError('failed-precondition', 'Move every card out of this column before removing it.');
    transaction.update(ref, { columns: columns.filter((column) => column.id !== columnId), version: committedVersion, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `projects/${projectId}`, metadata: { action: 'kanban.column.removed' } }));
  });
  return { projectId, columnId, removed: true as const, version: committedVersion };
};

function stringList(value: unknown, label: string, maxItems: number, maxLength = 128) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} must be a bounded list.`);
  return value.map((entry) => requireString(entry, label, maxLength));
}

export const createKanbanTask = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const columnId = requireString(input.columnId, 'Column ID', 128);
  const title = requireString(input.title, 'Task title', 160);
  const description = input.description === undefined ? '' : requireString(input.description, 'Task description', 4000);
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(input.priority ?? 'medium')) ? String(input.priority ?? 'medium') : 'medium';
  const assignedTo = optionalId(input.assignedTo, 'Assigned user ID');
  const watcherUserIds = stringList(input.watcherUserIds, 'Task watchers', 20);
  const labels = stringList(input.labels, 'Task labels', 20, 40);
  const goalId = optionalId(input.goalId, 'Goal ID');
  const db = getFirestore();
  const taskId = entityId(input, 'taskId', 'task', db.collection('tasks').doc().id);
  const taskRef = db.doc(`tasks/${taskId}`);
  const opRef = operationRef(teamId, operationId(input, 'createKanbanTask'));
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const projectRef = db.doc(`projects/${projectId}`);
    const [projectSnapshot, existing, operation, lastCards] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(taskRef),
      transaction.get(opRef),
      transaction.get(db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).where('columnId', '==', columnId).orderBy('orderKey', 'desc').limit(MAX_CARDS_PER_COLUMN_PAGE))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Task')) return;
    const project = requireProject(projectSnapshot, teamId);
    requireColumn(project, columnId);
    if (!columnHasCapacity(lastCards.size)) throw new HttpsError('resource-exhausted', 'This column is full. Archive completed work before adding more cards.');
    if (assignedTo) await assertTeamMemberInTransaction(transaction, teamId, assignedTo);
    for (const watcher of watcherUserIds) await assertTeamMemberInTransaction(transaction, teamId, watcher);
    if (goalId) {
      const goal = await transaction.get(db.doc(`goals/${goalId}`));
      if (!goal.exists || goal.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Goal not found in this team.');
      transaction.update(goal.ref, {
        taskCount: FieldValue.increment(1),
        ...(project.completedColumnId === columnId ? { completedTaskCount: FieldValue.increment(1) } : {}),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    const orderKey = Number(lastCards.docs[0]?.data().orderKey ?? 0) + ORDER_STEP;
    const completed = project.completedColumnId === columnId;
    const now = FieldValue.serverTimestamp();
    transaction.set(taskRef, {
      id: taskId,
      teamId,
      createdBy: admin.uid,
      projectId,
      columnId,
      orderKey,
      version: 1,
      title,
      description,
      status: statusForColumn(columnId, String(project.completedColumnId)),
      priority,
      assignedTo,
      watcherUserIds,
      goalId,
      labels,
      checklist: [],
      attachmentFileIds: [],
      dueAt: null,
      completedAt: completed ? now : null,
      historyCount: 1,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(db.collection('taskHistory').doc(), { id: taskId, teamId, createdBy: admin.uid, taskId, actorUserId: admin.uid, action: 'created', changedFields: ['created', 'projectId', 'columnId'], createdAt: now, updatedAt: now });
    transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'kanban-task.create', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `tasks/${taskId}`, metadata: { action: 'kanban.task.created' } }));
  });
  return { taskId, projectId, columnId };
};

export const moveTaskCard = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const input = inputRecord(request);
  const taskId = requireString(input.taskId, 'Task ID', 128);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const columnId = requireString(input.columnId, 'Column ID', 128);
  const beforeTaskId = optionalId(input.beforeTaskId, 'Previous task ID');
  const afterTaskId = optionalId(input.afterTaskId, 'Next task ID');
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new HttpsError('invalid-argument', 'Expected task version is invalid.');
  if (beforeTaskId === taskId || afterTaskId === taskId || (beforeTaskId && beforeTaskId === afterTaskId)) throw new HttpsError('invalid-argument', 'Card neighbors are invalid.');
  const opId = operationId(input, 'moveTaskCard');
  const db = getFirestore();
  const taskRef = db.doc(`tasks/${taskId}`);
  const opRef = operationRef(teamId, opId);
  await db.runTransaction(async (transaction) => {
    const membership = await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const projectRef = db.doc(`projects/${projectId}`);
    const targetQuery = db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).where('columnId', '==', columnId).orderBy('orderKey', 'asc').limit(MAX_CARDS_PER_COLUMN_PAGE + 1);
    const [taskSnapshot, projectSnapshot, operation, targetCards] = await Promise.all([
      transaction.get(taskRef),
      transaction.get(projectRef),
      transaction.get(opRef),
      transaction.get(targetQuery)
    ]);
    if (isReplayOfOwnCreate(null, operation, { teamId, actorUserId: actor.uid }, 'Move')) return;
    const task = taskSnapshot.data();
    if (!taskSnapshot.exists || task?.teamId !== teamId || task.projectId !== projectId) throw new HttpsError('not-found', 'Task not found in this project.');
    const project = requireProject(projectSnapshot, teamId);
    requireColumn(project, columnId);
    if (!columnHasCapacity(targetCards.size, task.columnId === columnId)) throw new HttpsError('resource-exhausted', 'This column is full. Archive completed work before moving more cards here.');
    if (Number(task.version ?? 1) !== expectedVersion) throw new HttpsError('aborted', 'This card changed after the board loaded. The board has been refreshed.');
    if (!isAdmin({ ...actor, role: String(membership.role) as TeamAdmin['role'] })) {
      if (membership.role !== 'student') throw new HttpsError('permission-denied', 'Your role can view the board but cannot move cards.');
      if (task.assignedTo !== actor.uid) throw new HttpsError('permission-denied', 'Students can move only tasks assigned to them.');
    }

    const target = targetCards.docs.filter((snapshot) => snapshot.id !== taskId);
    const beforeIndex = beforeTaskId ? target.findIndex((snapshot) => snapshot.id === beforeTaskId) : -1;
    const afterIndex = afterTaskId ? target.findIndex((snapshot) => snapshot.id === afterTaskId) : -1;
    if (beforeTaskId && beforeIndex < 0) throw new HttpsError('aborted', 'The previous card moved. Refresh the board and try again.');
    if (afterTaskId && afterIndex < 0) throw new HttpsError('aborted', 'The next card moved. Refresh the board and try again.');
    if (beforeTaskId && afterTaskId && afterIndex !== beforeIndex + 1) throw new HttpsError('aborted', 'Card order changed. Refresh the board and try again.');
    const beforeOrder = beforeIndex >= 0 ? Number(target[beforeIndex].data().orderKey) : undefined;
    const afterOrder = afterIndex >= 0 ? Number(target[afterIndex].data().orderKey) : undefined;
    const dedupeKey = `kanban:${taskId}:move:${opId}`;
    const notifications = await notificationRecords(transaction, taskRecipients(task, actor.uid), teamId, dedupeKey);
    let nextOrder = orderBetween(beforeOrder, afterOrder);
    const needsRebalance = beforeOrder !== undefined && afterOrder !== undefined && afterOrder - beforeOrder < 0.000001;
    if (needsRebalance) {
      const insertIndex = afterIndex >= 0 ? afterIndex : target.length;
      const ordered = [...target];
      ordered.splice(insertIndex, 0, taskSnapshot as FirebaseFirestore.QueryDocumentSnapshot);
      ordered.forEach((snapshot, index) => {
        const orderKey = (index + 1) * ORDER_STEP;
        if (snapshot.id === taskId) nextOrder = orderKey;
        else transaction.update(snapshot.ref, { orderKey, updatedAt: FieldValue.serverTimestamp() });
      });
    }

    const wasCompleted = task.columnId === project.completedColumnId;
    const isCompleted = columnId === project.completedColumnId;
    const now = FieldValue.serverTimestamp();
    transaction.update(taskRef, {
      columnId,
      orderKey: nextOrder,
      status: statusForColumn(columnId, String(project.completedColumnId)),
      completedAt: isCompleted ? task.completedAt ?? now : null,
      version: FieldValue.increment(1),
      updatedAt: now,
      historyCount: FieldValue.increment(1)
    });
    if (task.goalId && wasCompleted !== isCompleted) {
      transaction.update(db.doc(`goals/${String(task.goalId)}`), { completedTaskCount: FieldValue.increment(isCompleted ? 1 : -1), updatedAt: now });
    }
    transaction.set(db.collection('taskHistory').doc(), {
      id: taskId,
      teamId,
      createdBy: actor.uid,
      taskId,
      actorUserId: actor.uid,
      action: isCompleted && !wasCompleted ? 'completed' : 'moved',
      changedFields: ['columnId', 'orderKey'],
      fromColumnId: task.columnId,
      toColumnId: columnId,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'kanban-task.move', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `tasks/${taskId}`, metadata: { action: 'kanban.task.moved' } }));
    writeMoveNotifications(transaction, notifications, teamId, task, projectId, dedupeKey);
  });
  return { taskId, projectId, columnId, version: expectedVersion + 1 };
};
