import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { assertAssignableMemberInTransaction, assertTeamAdminInTransaction, auditRecord, isTaskAssignableRole, requireString, requireTeamAdmin, requireTeamId, requireText } from './phase2.js';
import {
  categoryGoalId,
  MAX_CARDS_PER_COLUMN_PAGE,
  MAX_CATEGORIES_PER_PROJECT,
  ORDER_STEP,
  COLUMN_COLORS,
  inputRecord,
  operationId,
  operationRef,
  projectCategories,
  projectColumns,
  requireProject,
  statusForColumn,
  type ProjectCategory,
  type ProjectColumn
} from './kanban.js';
import { MAX_SUBTASKS_PER_TASK, validateSubtasks, type Subtask } from './phase3.js';
import { DASHBOARD_AREAS } from './phase7.js';

type ImportRequest = CallableRequest<Record<string, unknown>>;

/**
 * A coach's spreadsheet of predefined tasks arrives here as rows the browser
 * already parsed and previewed. The file itself never reaches the server; the
 * rows are untrusted input and get the same validation `createKanbanTask`
 * applies, plus bounds sized so one import is one small transaction.
 *
 * One import fills at most one column page, so every imported card is visible
 * on the board without paging.
 */
/**
 * A whole season plan arrives in one file, so the cap is the transaction's, not
 * a column's: each row writes a task and a history record, and the receipt,
 * audit record and project update share the same 500-write budget.
 */
export const MAX_IMPORT_ROWS = 200;
const MAX_EXTRA_LABELS = 10;
const MAX_TASK_LABELS = 20;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const AREA_IDS: readonly string[] = DASHBOARD_AREAS.map((area) => area.id);
const IMPORT_OPERATION_KIND = 'kanban-task.import';

export type ImportedTaskRow = {
  title: string;
  description: string;
  priority: string;
  labels: string[];
  dueAt: Timestamp | null;
  startAt: Timestamp | null;
  endAt: Timestamp | null;
  /** Resolved by the browser against the roster; re-checked here. */
  assignedTo: string | null;
  /** The board column this row asked for by name, already matched client-side. */
  columnId: string | null;
  /** Category by name: matched case-insensitively, created when the board lacks it. */
  categoryName: string | null;
  subtasks: Subtask[];
};

export type ImportResult = {
  projectId: string;
  columnId: string;
  taskIds: string[];
  importedCount: number;
  createdCategories: string[];
};

function isBlank(value: unknown) {
  return value === undefined || value === null || value === '';
}

function importDueDate(value: unknown, label: string): Timestamp | null {
  if (isBlank(value)) return null;
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} must be a date.`);
  const date = new Date(value);
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) throw new HttpsError('invalid-argument', `${label} must be a date between 2000 and 2100.`);
  return Timestamp.fromDate(date);
}

export function normalizeImportRows(value: unknown): ImportedTaskRow[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpsError('invalid-argument', 'Choose at least one task to import.');
  if (value.length > MAX_IMPORT_ROWS) throw new HttpsError('invalid-argument', `Import at most ${MAX_IMPORT_ROWS} tasks at a time.`);
  return value.map((entry, index) => {
    const row = `Row ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpsError('invalid-argument', `${row} is not a task.`);
    const record = entry as Record<string, unknown>;
    if (!isBlank(record.priority) && !TASK_PRIORITIES.includes(record.priority as typeof TASK_PRIORITIES[number])) {
      throw new HttpsError('invalid-argument', `${row} priority must be low, medium, high, or urgent.`);
    }
    if (!isBlank(record.area) && !AREA_IDS.includes(String(record.area))) {
      throw new HttpsError('invalid-argument', `${row} area is not a known judging area.`);
    }
    if (record.labels !== undefined && (!Array.isArray(record.labels) || record.labels.length > MAX_EXTRA_LABELS)) {
      throw new HttpsError('invalid-argument', `${row} can carry at most ${MAX_EXTRA_LABELS} labels.`);
    }
    const extraLabels = ((record.labels ?? []) as unknown[]).map((label) => requireString(label, `${row} label`, 40));
    // Sub-items arrive nested under their parent row; the browser groups the
    // sheet's "Subtask" lines before sending them.
    const subtasks = record.subtasks === undefined ? [] : validateSubtasks(record.subtasks);
    if (subtasks.length > MAX_SUBTASKS_PER_TASK) throw new HttpsError('invalid-argument', `${row} has more than ${MAX_SUBTASKS_PER_TASK} subtasks.`);
    return {
      title: requireText(record.title, `${row} title`, 160),
      description: isBlank(record.description) ? '' : requireText(record.description, `${row} description`, 4000),
      priority: isBlank(record.priority) ? 'medium' : String(record.priority),
      // The area label leads so it survives the label cap and the dashboard counts it.
      labels: [...new Set([...(isBlank(record.area) ? [] : [String(record.area)]), ...extraLabels])].slice(0, MAX_TASK_LABELS),
      dueAt: importDueDate(record.dueAt, `${row} due date`),
      startAt: importDueDate(record.startAt, `${row} start date`),
      endAt: importDueDate(record.endAt, `${row} end date`),
      assignedTo: isBlank(record.assignedTo) ? null : requireString(record.assignedTo, `${row} assignee`, 128),
      columnId: isBlank(record.columnId) ? null : requireString(record.columnId, `${row} status column`, 128),
      categoryName: isBlank(record.categoryName) ? null : requireString(record.categoryName, `${row} category`, 60),
      subtasks
    };
  });
}

/**
 * Categories named in the sheet are matched case-insensitively against the
 * board's own list, and anything left over is created. Creating them here — in
 * the same transaction as the cards — is what lets a coach describe a whole
 * season's structure in one file, rather than having to pre-build the groups.
 */
export function resolveImportCategories(existing: ProjectCategory[], names: Array<string | null>) {
  const byName = new Map(existing.map((category) => [category.name.trim().toLowerCase(), category]));
  const created: ProjectCategory[] = [];
  const assigned = new Map<string, string>();
  for (const name of names) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (assigned.has(key)) continue;
    const match = byName.get(key);
    if (match) {
      assigned.set(key, match.id);
      continue;
    }
    if (existing.length + created.length >= MAX_CATEGORIES_PER_PROJECT) {
      throw new HttpsError('resource-exhausted', `This import needs more than the ${MAX_CATEGORIES_PER_PROJECT} categories a board can hold. Reuse existing categories, or remove some first.`);
    }
    const category: ProjectCategory = {
      // Deterministic within the transaction; the caller supplies the ids.
      id: '',
      name: trimmed,
      color: COLUMN_COLORS[(existing.length + created.length) % COLUMN_COLORS.length],
      areaId: null,
      // A category the sheet invents has no milestone until a coach gives it one.
      goalId: null
    };
    created.push(category);
    assigned.set(key, '');
  }
  return { created, assigned };
}

/** Imported work lands in the requested column, or the first column that is not "done". */
export function importColumnId(columns: ProjectColumn[], completedColumnId: string, requested: string | null): string {
  if (requested) {
    if (!columns.some((column) => column.id === requested)) throw new HttpsError('not-found', 'Project column not found.');
    return requested;
  }
  return (columns.find((column) => column.id !== completedColumnId) ?? columns[0]).id;
}

export const importProjectTasks = async (request: ImportRequest): Promise<ImportResult> => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const requestedColumnId = isBlank(input.columnId) ? null : requireString(input.columnId, 'Column ID', 128);
  const rows = normalizeImportRows(input.rows);
  const db = getFirestore();
  const opRef = operationRef(teamId, operationId(input, 'importProjectTasks'));
  const projectRef = db.doc(`projects/${projectId}`);
  const taskRefs = rows.map(() => db.collection('tasks').doc());

  return db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const [projectSnapshot, operation] = await Promise.all([transaction.get(projectRef), transaction.get(opRef)]);
    // A retried import replays the committed result instead of adding the rows twice.
    if (operation.exists) {
      const receipt = operation.data() ?? {};
      if (receipt.teamId !== teamId || receipt.createdBy !== admin.uid || receipt.kind !== IMPORT_OPERATION_KIND) {
        throw new HttpsError('already-exists', 'This import operation ID was already used.');
      }
      return receipt.result as ImportResult;
    }
    const project = requireProject(projectSnapshot, teamId);
    const columns = projectColumns(project);
    const completedColumnId = typeof project.completedColumnId === 'string' ? project.completedColumnId : columns[columns.length - 1].id;
    const defaultColumnId = importColumnId(columns, completedColumnId, requestedColumnId);
    // A row's Status cell names a column; the browser matched it by name, and an
    // unmatched row falls back to the import's default column.
    const rowColumnIds = rows.map((row) => {
      if (!row.columnId) return defaultColumnId;
      if (!columns.some((column) => column.id === row.columnId)) throw new HttpsError('not-found', 'Project column not found.');
      return row.columnId;
    });

    // Every assignee the sheet named must still be an active member of this
    // team. The browser resolved the names; this is the check that counts.
    const assignees = [...new Set(rows.flatMap((row) => [row.assignedTo, ...row.subtasks.map((subtask) => subtask.assignedTo)]).filter((uid): uid is string => Boolean(uid)))];
    for (const assignee of assignees) await assertAssignableMemberInTransaction(transaction, teamId, assignee);

    const existingCategories = projectCategories(project);
    const { created, assigned } = resolveImportCategories(existingCategories, rows.map((row) => row.categoryName));
    const newCategories = created.map((category) => ({ ...category, id: db.collection('projects').doc().id }));
    for (const category of newCategories) assigned.set(category.name.trim().toLowerCase(), category.id);
    const categoryIdFor = (name: string | null) => (name?.trim() ? assigned.get(name.trim().toLowerCase()) ?? null : null);
    // Imported cards join the milestone of the work package they land in, and
    // each milestone's counters move once for the whole import rather than per
    // row.
    const allCategories = [...existingCategories, ...newCategories];
    const goalTotals = new Map<string, number>();

    // Capacity is per target column, so a file that fills three columns is
    // checked three times rather than once against the default.
    const targetColumnIds = [...new Set(rowColumnIds)];
    const columnCards = await Promise.all(targetColumnIds.map((columnId) => transaction.get(db.collection('tasks')
      .where('teamId', '==', teamId)
      .where('projectId', '==', projectId)
      .where('columnId', '==', columnId)
      .orderBy('orderKey', 'desc')
      .limit(MAX_CARDS_PER_COLUMN_PAGE))));
    const columnState = new Map(targetColumnIds.map((columnId, index) => [columnId, {
      name: columns.find((column) => column.id === columnId)?.name ?? columnId,
      used: columnCards[index].size,
      lastOrderKey: Number(columnCards[index].docs[0]?.data().orderKey ?? 0),
      placed: 0
    }]));
    for (const [columnId, state] of columnState) {
      const incoming = rowColumnIds.filter((id) => id === columnId).length;
      const room = MAX_CARDS_PER_COLUMN_PAGE - state.used;
      if (incoming > room) {
        throw new HttpsError('resource-exhausted', room > 0
          ? `"${state.name}" has room for ${room} more card${room === 1 ? '' : 's'}, and this import has ${incoming} for it. Import fewer tasks, or archive completed work first.`
          : `"${state.name}" is full. Archive completed work before importing more cards into it.`);
      }
    }

    const now = FieldValue.serverTimestamp();
    rows.forEach((row, index) => {
      const ref = taskRefs[index];
      const columnId = rowColumnIds[index];
      const state = columnState.get(columnId)!;
      state.placed += 1;
      const status = statusForColumn(columnId, completedColumnId);
      const categoryId = categoryIdFor(row.categoryName);
      const goalId = categoryGoalId(allCategories, categoryId);
      if (goalId) goalTotals.set(goalId, (goalTotals.get(goalId) ?? 0) + 1);
      transaction.set(ref, {
        id: ref.id,
        teamId,
        createdBy: admin.uid,
        projectId,
        columnId,
        categoryId,
        orderKey: state.lastOrderKey + ORDER_STEP * state.placed,
        version: 1,
        title: row.title,
        description: row.description,
        status,
        priority: row.priority,
        assignedTo: row.assignedTo,
        watcherUserIds: [],
        goalId,
        labels: row.labels,
        checklist: [],
        subtasks: row.subtasks,
        attachmentFileIds: [],
        dueAt: row.dueAt,
        startAt: row.startAt,
        endAt: row.endAt,
        completedAt: status === 'completed' ? now : null,
        historyCount: 1,
        createdAt: now,
        updatedAt: now
      });
      transaction.set(db.collection('taskHistory').doc(), { id: ref.id, teamId, createdBy: admin.uid, taskId: ref.id, actorUserId: admin.uid, action: 'created', changedFields: ['created', 'projectId', 'columnId', 'imported'], createdAt: now, updatedAt: now });
    });
    for (const [goalId, count] of goalTotals) {
      // Imported cards start open, so only the total moves.
      transaction.update(db.doc(`goals/${goalId}`), { taskCount: FieldValue.increment(count), updatedAt: now });
    }
    if (newCategories.length) {
      transaction.update(projectRef, {
        categories: [...existingCategories, ...newCategories],
        version: Number(project.version ?? 1) + 1,
        updatedAt: now
      });
    }
    const result: ImportResult = {
      projectId,
      columnId: defaultColumnId,
      taskIds: taskRefs.map((ref) => ref.id),
      importedCount: rows.length,
      createdCategories: newCategories.map((category) => category.name)
    };
    transaction.set(opRef, { teamId, createdBy: admin.uid, kind: IMPORT_OPERATION_KIND, result, createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetResource: `projects/${projectId}`,
      // Audit metadata is an allow-listed key set; the row count lives on the receipt.
      metadata: { action: 'kanban.tasks.imported' }
    }));
    return result;
  });
};

/**
 * Matches the Assignee cells of a spreadsheet against the team roster.
 *
 * It runs on the server because matching by email means reading `users/{uid}`,
 * and those documents are readable only by their owner — deliberately, for a
 * product used by minors. Only the resolved user id and display name come back;
 * no address ever reaches the browser, and an address that matches nobody is
 * reported as unmatched rather than confirmed or denied as an account.
 */
export const MAX_ASSIGNEE_LOOKUPS = 60;

export type AssigneeMatch = {
  value: string;
  userId: string | null;
  displayName: string | null;
  /**
   * Why a value did not resolve: 'unknown', 'ambiguous', or 'parent' — a
   * teammate who is a parent, and so follows the tracker read-only.
   */
  reason: 'matched' | 'unknown' | 'ambiguous' | 'parent';
};

function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchAssignees(
  values: string[],
  members: Array<{ userId: string; displayName: string; email: string | null; role?: string }>
): AssigneeMatch[] {
  const byName = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  for (const member of members) {
    const name = normalizeLookup(member.displayName);
    if (name) byName.set(name, [...(byName.get(name) ?? []), member.userId]);
    const email = member.email ? normalizeLookup(member.email) : '';
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), member.userId]);
  }
  const displayNames = new Map(members.map((member) => [member.userId, member.displayName]));
  // A member without a role recorded is matched as before; only a known
  // parent is held back.
  const parents = new Set(members.filter((member) => member.role !== undefined && !isTaskAssignableRole(member.role)).map((member) => member.userId));
  return values.map((value) => {
    const key = normalizeLookup(value);
    // An email is unique per account, so it wins over a display name that two
    // students could share.
    const candidates = byEmail.get(key) ?? byName.get(key) ?? [];
    if (candidates.length === 1 && parents.has(candidates[0])) {
      // Named plainly so the coach knows why, rather than being told this
      // person "is not on this team".
      return { value, userId: null, displayName: displayNames.get(candidates[0]) ?? null, reason: 'parent' as const };
    }
    if (candidates.length === 1) return { value, userId: candidates[0], displayName: displayNames.get(candidates[0]) ?? null, reason: 'matched' as const };
    return { value, userId: null, displayName: null, reason: candidates.length > 1 ? 'ambiguous' as const : 'unknown' as const };
  });
}

export const resolveImportAssignees = async (request: ImportRequest) => {
  const teamId = requireTeamId(request);
  await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  if (!Array.isArray(input.values)) throw new HttpsError('invalid-argument', 'Assignee values must be a list.');
  if (input.values.length > MAX_ASSIGNEE_LOOKUPS) throw new HttpsError('invalid-argument', `Look up at most ${MAX_ASSIGNEE_LOOKUPS} assignees at a time.`);
  const values = input.values.map((value, index) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 254) throw new HttpsError('invalid-argument', `Assignee ${index + 1} is invalid.`);
    return value.trim();
  });
  if (!values.length) return { matches: [] as AssigneeMatch[] };

  const db = getFirestore();
  const memberships = await db.collection('memberships').where('teamId', '==', teamId).where('status', '==', 'active').limit(200).get();
  const userIds = memberships.docs.map((document) => String(document.data().userId));
  const roles = new Map(memberships.docs.map((document) => [String(document.data().userId), String(document.data().role ?? '')]));
  if (!userIds.length) return { matches: matchAssignees(values, []) };
  const profiles = await db.getAll(...userIds.map((userId) => db.doc(`users/${userId}`)));
  // The address to match on is the one the member signs in with, which lives in
  // Firebase Auth: a `users/{uid}` profile is written by the client and may not
  // exist at all for someone who only ever accepted an invitation.
  const identities = new Map<string, { email: string | null; displayName: string }>();
  for (let index = 0; index < userIds.length; index += 100) {
    const page = await getAuth().getUsers(userIds.slice(index, index + 100).map((uid) => ({ uid })));
    for (const record of page.users) {
      identities.set(record.uid, { email: record.email ?? null, displayName: record.displayName ?? '' });
    }
  }
  const members = profiles.map((snapshot) => {
    const data = snapshot.data() ?? {};
    const identity = identities.get(snapshot.id);
    return {
      userId: snapshot.id,
      displayName: typeof data.displayName === 'string' && data.displayName ? data.displayName : identity?.displayName ?? '',
      email: identity?.email ?? (typeof data.email === 'string' ? data.email : null),
      role: roles.get(snapshot.id)
    };
  });
  return { matches: matchAssignees(values, members) };
};
