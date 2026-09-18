import { FieldPath, FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTaskEditorInTransaction,
  assertTeamAdminInTransaction,
  assertTeamMemberInTransaction,
  auditRecord,
  getInput,
  isReplayOfOwnCreate,
  isTaskEditor,
  requireString,
  requireText,
  requireTeamAdmin,
  requireTeamId,
  requireTaskEditor,
  requireTeamMember,
  type TeamAdmin
} from './phase2.js';
import { DASHBOARD_AREAS } from './phase7.js';
import { buildStandardPlan } from './standard-plan.js';

/** The judging areas a category may be tied to; the dashboard counts the same ids. */
const AREA_IDS: readonly string[] = DASHBOARD_AREAS.map((area) => area.id);

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
export const MAX_CARDS_PER_COLUMN_PAGE = 150;
export const MAX_CATEGORIES_PER_PROJECT = 20;
export const ORDER_STEP = 1024;
const MIGRATION_PAGE_SIZE = 200;

export type ProjectColumn = {
  id: string;
  name: string;
  color: string;
};

/**
 * A board group, in the monday.com sense: the coach's own breakdown of the work
 * ("Innovation project", "Build UI"), independent of the workflow columns.
 *
 * `areaId` optionally ties a category to one of the four FIRST LEGO League
 * judging areas. The area itself still lives on each task as a label — that is
 * what the dashboard counts — so the tie is a default for new cards, not a
 * second source of truth.
 *
 * `goalId` is the work-breakdown parent: the milestone this package of work
 * belongs to. A card created in the category inherits it, which is what keeps
 * the milestone counters — maintained per task — in step with the tree. A card
 * can still be pointed at a different milestone on its own.
 */
export type ProjectCategory = {
  id: string;
  name: string;
  color: string;
  areaId: string | null;
  goalId: string | null;
};

export const DEFAULT_PROJECT_COLUMNS: ProjectColumn[] = [
  { id: 'todo', name: 'To Do', color: 'blue' },
  { id: 'inProgress', name: 'In Progress', color: 'purple' },
  { id: 'review', name: 'Review', color: 'orange' },
  { id: 'completed', name: 'Completed', color: 'green' }
];

export const COLUMN_COLORS = ['blue', 'purple', 'orange', 'green', 'slate', 'pink'] as const;

export function inputRecord(request: KanbanRequest) {
  return request.data ?? {};
}

function has(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optionalId(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, label, 128);
}

export function operationId(input: Record<string, unknown>, prefix: string) {
  return `${prefix}_${requireString(input.operationId, 'Operation ID', 120)}`;
}

export function operationRef(teamId: string, id: string) {
  return getFirestore().doc(`kanbanOperations/${teamId}_${id}`);
}

export function entityId(input: Record<string, unknown>, key: string, prefix: string, fallback: string) {
  if (input[key] !== undefined) return requireString(input[key], `${prefix} ID`, 128);
  if (input.operationId !== undefined) return `${prefix}_${requireString(input.operationId, 'Operation ID', 96)}`;
  return fallback;
}

export function projectColumns(project: DocumentData): ProjectColumn[] {
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
 * Categories are optional: a board created before this feature has no
 * `categories` field, and its cards carry no `categoryId`. Both read as empty
 * rather than as an error, so no migration is needed.
 */
export function projectCategories(project: DocumentData): ProjectCategory[] {
  if (project.categories === undefined || project.categories === null) return [];
  if (!Array.isArray(project.categories)) throw new HttpsError('failed-precondition', 'Project categories are invalid.');
  return project.categories.map((category: unknown) => {
    if (!category || typeof category !== 'object') throw new HttpsError('failed-precondition', 'Project categories are invalid.');
    const record = category as Record<string, unknown>;
    return {
      id: requireString(record.id, 'Category ID', 128),
      name: requireText(record.name, 'Category name', 60),
      color: COLUMN_COLORS.includes(record.color as typeof COLUMN_COLORS[number]) ? String(record.color) : 'slate',
      areaId: typeof record.areaId === 'string' && AREA_IDS.includes(record.areaId) ? record.areaId : null,
      goalId: typeof record.goalId === 'string' && record.goalId ? record.goalId : null
    };
  });
}

/** The milestone a category rolls up into, or null when it stands alone. */
export function categoryGoalId(categories: ProjectCategory[], categoryId: string | null): string | null {
  if (!categoryId) return null;
  return categories.find((category) => category.id === categoryId)?.goalId ?? null;
}

/** Validates one caller-supplied category. `id` is absent for a new one. */
function requireCategoryInput(value: unknown, index: number): { id: string | null; name: string; color: string; areaId: string | null; goalId: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', `Category ${index + 1} is invalid.`);
  const record = value as Record<string, unknown>;
  const areaId = record.areaId === undefined || record.areaId === null || record.areaId === '' ? null : requireString(record.areaId, 'Category judging area', 64);
  if (areaId !== null && !AREA_IDS.includes(areaId)) throw new HttpsError('invalid-argument', 'Category judging area is not a known area.');
  return {
    id: record.id === undefined || record.id === null || record.id === '' ? null : requireString(record.id, 'Category ID', 128),
    name: requireText(record.name, `Category ${index + 1} name`, 60),
    color: COLUMN_COLORS.includes(record.color as typeof COLUMN_COLORS[number]) ? String(record.color) : 'slate',
    areaId,
    goalId: optionalId(record.goalId, 'Category milestone')
  };
}

/** The category a card may carry: `null`, or one this project actually defines. */
export function requireCategoryId(categories: ProjectCategory[], value: unknown): string | null {
  const categoryId = optionalId(value, 'Category ID');
  if (categoryId === null) return null;
  if (!categories.some((category) => category.id === categoryId)) throw new HttpsError('not-found', 'Project category not found.');
  return categoryId;
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

export function requireProject(project: FirebaseFirestore.DocumentSnapshot, teamId: string) {
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

export function statusForColumn(columnId: string, completedColumnId: string) {
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
  let seededTaskCount = 0;
  if (!projectSnapshot.exists) {
    const plan = buildStandardPlan();
    const seedRefs = plan.cards.map(() => db.collection('tasks').doc());
    await db.runTransaction(async (transaction) => {
      await assertTeamAdminInTransaction(transaction, teamId, actor);
      const [existing, anyTask] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(db.collection('tasks').where('teamId', '==', teamId).limit(1))
      ]);
      if (existing.exists) return;
      // A team with no work yet starts from the standard season plan. A team
      // that already has tasks keeps exactly those: they migrate onto the board
      // below, and seeding would bury them under 48 cards nobody asked for.
      const seed = anyTask.empty;
      const now = FieldValue.serverTimestamp();
      transaction.set(projectRef, {
        id: projectId,
        teamId,
        createdBy: actor.uid,
        name: 'Team Board',
        description: seed ? 'The standard FLL season plan. Edit, add or remove tasks to fit your team.' : 'Shared team work carried forward from the Tracker.',
        columns: DEFAULT_PROJECT_COLUMNS,
        categories: seed ? plan.categories : [],
        completedColumnId: 'completed',
        archived: false,
        version: 1,
        // Nothing to migrate on a seeded board, so the migration pass is skipped.
        migrationVersion: seed ? 1 : 0,
        migrationCursor: null,
        migrationColumnCounts: seed ? { todo: plan.cards.length } : {},
        ...(seed ? { templateId: 'standard-plan' } : {}),
        createdAt: now,
        updatedAt: now
      });
      if (seed) {
        plan.cards.forEach((card, index) => {
          const ref = seedRefs[index];
          transaction.set(ref, {
            id: ref.id,
            teamId,
            createdBy: actor.uid,
            projectId,
            columnId: 'todo',
            categoryId: card.categoryId,
            orderKey: (index + 1) * ORDER_STEP,
            version: 1,
            title: card.title,
            description: card.description,
            status: 'todo',
            priority: 'medium',
            assignedTo: null,
            watcherUserIds: [],
            goalId: null,
            labels: card.labels,
            checklist: [],
            subtasks: [],
            attachmentFileIds: [],
            startAt: null,
            endAt: null,
            dueAt: null,
            completedAt: null,
            historyCount: 1,
            createdAt: now,
            updatedAt: now
          });
          transaction.set(db.collection('taskHistory').doc(), { id: ref.id, teamId, createdBy: actor.uid, taskId: ref.id, actorUserId: actor.uid, action: 'created', changedFields: ['created', 'projectId', 'columnId'], createdAt: now, updatedAt: now });
        });
      }
      transaction.set(db.collection('auditEvents').doc(), auditRecord({
        type: 'administrative.action',
        actorUserId: actor.uid,
        teamId,
        targetResource: `projects/${projectId}`,
        metadata: { action: seed ? 'kanban.default-project.seeded' : 'kanban.default-project.created' }
      }));
      created = true;
      seededTaskCount = seed ? plan.cards.length : 0;
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
  return { projectId, created, seededTaskCount, ...result };
};

export const createProject = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const name = requireText(input.name, 'Project name', 80);
  const description = input.description === undefined ? '' : requireText(input.description, 'Project description', 1000);
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
  if (has(input, 'name')) updates.name = requireText(input.name, 'Project name', 80);
  if (has(input, 'description')) updates.description = requireText(input.description, 'Project description', 1000);
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

/**
 * Add, rename, recolor, reorder, retag and remove board categories in one call.
 *
 * The whole list is replaced, like the `columns` array it sits beside, so the
 * caller sends the order it wants and `expectedVersion` makes two coaches
 * editing at once a conflict rather than a silent overwrite. A category that
 * still has cards cannot be removed: moving those cards is the coach's
 * decision, and doing it here would rewrite an unbounded number of tasks
 * inside one transaction.
 */
export const updateProjectCategories = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  if (!Array.isArray(input.categories)) throw new HttpsError('invalid-argument', 'Categories must be a list.');
  if (input.categories.length > MAX_CATEGORIES_PER_PROJECT) {
    throw new HttpsError('resource-exhausted', `A board can have at most ${MAX_CATEGORIES_PER_PROJECT} categories.`);
  }
  const requested = input.categories.map(requireCategoryInput);
  const expectedVersion = input.expectedVersion;
  const db = getFirestore();
  let committedVersion = 1;
  let categories: ProjectCategory[] = [];
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projects/${projectId}`);
    const project = requireProject(await transaction.get(ref), teamId);
    const current = projectCategories(project);
    committedVersion = nextProjectVersion(project.version, expectedVersion);
    const currentIds = new Set(current.map((category) => category.id));
    for (const category of requested) {
      if (category.id !== null && !currentIds.has(category.id)) throw new HttpsError('not-found', 'Project category not found.');
    }
    const keptIds = new Set(requested.map((category) => category.id).filter((id): id is string => id !== null));
    if (keptIds.size !== requested.filter((category) => category.id !== null).length) {
      throw new HttpsError('invalid-argument', 'Each category can appear only once.');
    }
    const removed = current.filter((category) => !keptIds.has(category.id));
    const usage = await Promise.all(removed.map((category) => transaction.get(db.collection('tasks')
      .where('teamId', '==', teamId)
      .where('projectId', '==', projectId)
      .where('categoryId', '==', category.id)
      .limit(1))));
    const blocked = removed.filter((_, index) => !usage[index].empty);
    if (blocked.length) {
      throw new HttpsError('failed-precondition', `Move every card out of ${blocked.map((category) => `"${category.name}"`).join(', ')} before removing it.`);
    }
    // Every milestone named must be a real goal of this team; a stale id would
    // otherwise put a whole branch of the tree under nothing.
    const goalIds = [...new Set(requested.map((category) => category.goalId).filter((goalId): goalId is string => Boolean(goalId)))];
    const goals = await Promise.all(goalIds.map((goalId) => transaction.get(db.doc(`goals/${goalId}`))));
    goals.forEach((snapshot, index) => {
      if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', `Milestone not found in this team: ${goalIds[index]}`);
    });
    categories = requested.map((category) => ({
      id: category.id ?? db.collection('projects').doc().id,
      name: category.name,
      color: category.color,
      areaId: category.areaId,
      goalId: category.goalId
    }));
    transaction.update(ref, { categories, version: committedVersion, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetResource: `projects/${projectId}`,
      metadata: { action: 'kanban.categories.updated' }
    }));
  });
  return { projectId, categories, version: committedVersion };
};

function stringList(value: unknown, label: string, maxItems: number, maxLength = 128) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} must be a bounded list.`);
  return value.map((entry) => requireString(entry, label, maxLength));
}

export const createKanbanTask = async (request: KanbanRequest) => {
  const teamId = requireTeamId(request);
  // Students add work too; mentors and parents view the board.
  const actor = await requireTaskEditor(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const columnId = requireString(input.columnId, 'Column ID', 128);
  const title = requireText(input.title, 'Task title', 160);
  const description = input.description === undefined ? '' : requireText(input.description, 'Task description', 4000);
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(input.priority ?? 'medium')) ? String(input.priority ?? 'medium') : 'medium';
  const assignedTo = optionalId(input.assignedTo, 'Assigned user ID');
  const watcherUserIds = stringList(input.watcherUserIds, 'Task watchers', 20);
  const labels = stringList(input.labels, 'Task labels', 20, 40);
  const requestedGoalId = has(input, 'goalId') ? optionalId(input.goalId, 'Goal ID') : undefined;
  const db = getFirestore();
  const taskId = entityId(input, 'taskId', 'task', db.collection('tasks').doc().id);
  const taskRef = db.doc(`tasks/${taskId}`);
  const opRef = operationRef(teamId, operationId(input, 'createKanbanTask'));
  await db.runTransaction(async (transaction) => {
    await assertTaskEditorInTransaction(transaction, teamId, actor);
    const projectRef = db.doc(`projects/${projectId}`);
    const [projectSnapshot, existing, operation, lastCards] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(taskRef),
      transaction.get(opRef),
      transaction.get(db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).where('columnId', '==', columnId).orderBy('orderKey', 'desc').limit(MAX_CARDS_PER_COLUMN_PAGE))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: actor.uid }, 'Task')) return;
    const project = requireProject(projectSnapshot, teamId);
    requireColumn(project, columnId);
    const projectCategoryList = projectCategories(project);
    const categoryId = requireCategoryId(projectCategoryList, input.categoryId);
    // The work-breakdown default: a card belongs to its category's milestone
    // unless the caller pointed it somewhere else on purpose.
    const goalId = requestedGoalId === undefined ? categoryGoalId(projectCategoryList, categoryId) : requestedGoalId;
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
      createdBy: actor.uid,
      projectId,
      columnId,
      categoryId,
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
      subtasks: [],
      attachmentFileIds: [],
      startAt: null,
      endAt: null,
      dueAt: null,
      completedAt: completed ? now : null,
      historyCount: 1,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(db.collection('taskHistory').doc(), { id: taskId, teamId, createdBy: actor.uid, taskId, actorUserId: actor.uid, action: 'created', changedFields: ['created', 'projectId', 'columnId'], createdAt: now, updatedAt: now });
    transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'kanban-task.create', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `tasks/${taskId}`, metadata: { action: 'kanban.task.created' } }));
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
    if (!isTaskEditor({ ...actor, role: String(membership.role) as TeamAdmin['role'] })) {
      throw new HttpsError('permission-denied', 'Your role can view the board but cannot move cards.');
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
