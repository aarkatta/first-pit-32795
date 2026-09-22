import { FieldValue, getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  assertAssignableMemberInTransaction,
  assertTeamMemberInTransaction,
  isTaskAssignableRole,
  getInput,
  isReplayOfOwnCreate,
  isTaskEditor,
  requireString,
  requireText,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember,
  auditRecord,
  TASK_EDITOR_ROLES
} from './phase2.js';
import { categoryGoalId, columnHasCapacity, DEFAULT_PROJECT_COLUMNS, MAX_CARDS_PER_COLUMN_PAGE, ORDER_STEP, projectCategories, projectColumns, requireCategoryId, requireProject } from './kanban.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

/**
 * Byte-level content check for an uploaded object.
 *
 * The declared `contentType` is chosen by the browser and stored verbatim, and
 * `storage.rules` compares the upload's content type against that same stored
 * value — so both sides of that check come from the client and it proves only
 * self-consistency. Anything could be uploaded labelled `text/plain`. This
 * reads the leading bytes and confirms they actually look like the declared
 * type before the file is ever made downloadable.
 *
 * It is a format check, not an antivirus scan: it stops a mislabelled or
 * disguised file, not a malicious PDF. `scanStatus` is the hook a real scanner
 * would set later.
 */
export const CONTENT_SNIFF_BYTES = 4096;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function looksLikeText(bytes: Uint8Array): boolean {
  // A UTF-8 BOM, or no NUL bytes and no unexpected C0 control characters. Tab,
  // newline, carriage return and form feed are ordinary in .txt and .csv.
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return true;
  for (const byte of bytes) {
    if (byte === 0x00) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

export function detectContentMismatch(declaredContentType: string, bytes: Uint8Array): string | null {
  const empty = bytes.length === 0;
  switch (declaredContentType) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : 'not a PNG image';
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? null : 'not a JPEG image';
    case 'image/webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
        ? null
        : 'not a WebP image';
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? null : 'not a PDF document';
    case 'application/zip':
      // Local file header, empty archive, or spanned archive marker.
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
        || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
        ? null
        : 'not a ZIP archive';
    case 'text/plain':
    case 'text/csv':
      if (empty) return null;
      return looksLikeText(bytes) ? null : 'not plain text';
    default:
      return 'an unsupported file type';
  }
}

export function validateContentType(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'Content type is invalid.');
  const contentType = value.trim().toLowerCase();
  if (contentType.length < 3
    || contentType.length > 120
    || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType)) {
    throw new HttpsError('invalid-argument', 'Content type is invalid.');
  }
  return contentType;
}

type Phase3Request = CallableRequest<Record<string, unknown>>;

function requestRecord(request: Phase3Request) {
  return request.data ?? {};
}

function has(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, label);
}

function stringArray(value: unknown, label: string, maxItems = 50, maxLength = 64): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} must be a bounded list.`);
  return value.map((entry) => requireString(entry, label, maxLength));
}

function parseTimestamp(value: unknown, label: string): Timestamp {
  if (value instanceof Timestamp) return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Timestamp.fromDate(date);
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpsError('invalid-argument', `${label} must be a valid date.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', `${label} must be a valid date.`);
  return Timestamp.fromDate(date);
}

function optionalTimestamp(value: unknown, label: string): Timestamp | null {
  return value === undefined || value === null || value === '' ? null : parseTimestamp(value, label);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  const candidate = value ?? fallback;
  if (!allowed.includes(candidate as T)) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return candidate as T;
}

function operationId(input: Record<string, unknown>, prefix: string): string | null {
  const value = input.operationId;
  return value === undefined ? null : `${prefix}_${requireString(value, 'Operation ID', 120)}`;
}

function operationRef(teamId: string, id: string | null) {
  return id ? getFirestore().doc(`phase3Operations/${teamId}_${id}`) : null;
}

function entityId(input: Record<string, unknown>, key: string, prefix: string, fallback: string) {
  if (input[key] !== undefined) return requireString(input[key], `${prefix} ID`);
  if (input.operationId !== undefined) return `${prefix}_${requireString(input.operationId, 'Operation ID', 96)}`;
  return fallback;
}

function mutationVersion(value: unknown, label: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000) {
    throw new HttpsError('invalid-argument', `${label} must be a positive integer.`);
  }
  return version;
}

function nextRecordVersion(currentVersion: unknown, expectedVersion: unknown, conflictMessage: string): number {
  // Records written before the version field existed default to 1.
  const current = mutationVersion(currentVersion ?? 1, 'Current version');
  if (expectedVersion !== undefined && mutationVersion(expectedVersion, 'Expected version') !== current) {
    throw new HttpsError('aborted', conflictMessage);
  }
  return current + 1;
}

export function nextTaskMutationVersion(currentVersion: unknown, expectedVersion?: unknown): number {
  return nextRecordVersion(currentVersion, expectedVersion, 'This task changed while you were editing it. Reload the latest task before saving.');
}

export function nextGoalMutationVersion(currentVersion: unknown, expectedVersion?: unknown): number {
  return nextRecordVersion(currentVersion, expectedVersion, 'This goal changed while you were editing it. Reload the latest goal before saving.');
}

export function goalOperationVersion(
  receipt: Record<string, unknown>,
  expected: { teamId: string; actorUserId: string; goalId: string }
) {
  if (receipt.teamId !== expected.teamId
    || receipt.createdBy !== expected.actorUserId
    || receipt.kind !== 'goal.update'
    || receipt.goalId !== expected.goalId) {
    throw new HttpsError('failed-precondition', 'This operation ID belongs to a different goal update.');
  }
  return mutationVersion(receipt.version, 'Stored goal version');
}

export function taskNotificationDedupeKey(taskId: string, version: number) {
  return `task:${taskId}:changed:v${version}`;
}

export function taskOperationVersion(
  receipt: Record<string, unknown>,
  expected: { teamId: string; actorUserId: string; taskId: string }
) {
  if (receipt.teamId !== expected.teamId
    || receipt.createdBy !== expected.actorUserId
    || receipt.kind !== 'task.update'
    || receipt.taskId !== expected.taskId) {
    throw new HttpsError('failed-precondition', 'This operation ID belongs to a different task update.');
  }
  return mutationVersion(receipt.version, 'Stored task version');
}

function validateChecklist(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new HttpsError('invalid-argument', 'Checklist must contain at most 100 items.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpsError('invalid-argument', 'Checklist item is invalid.');
    const record = item as Record<string, unknown>;
    return {
      id: requireString(record.id, 'Checklist item ID', 64),
      label: requireString(record.label, 'Checklist label', 240),
      completed: record.completed === true
    };
  });
}

/**
 * Sub-items, in the monday.com sense: a small ordered list inside the task
 * document rather than a second collection of cards.
 *
 * Kept inside the task because it makes a subtask edit atomic with its parent's
 * `version`, keeps sub-items out of the per-column card budget, and needs no
 * new collection, rules block or index. The trade-off is deliberate: a subtask
 * is not a board card and has no history of its own.
 */
export const MAX_SUBTASKS_PER_TASK = 30;
export const SUBTASK_STATUSES = ['todo', 'inProgress', 'done'] as const;
export type SubtaskStatus = (typeof SUBTASK_STATUSES)[number];
export type Subtask = { id: string; title: string; status: SubtaskStatus; assignedTo: string | null; dueAt: Timestamp | null };

export function validateSubtasks(value: unknown): Subtask[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SUBTASKS_PER_TASK) {
    throw new HttpsError('invalid-argument', `A task can have at most ${MAX_SUBTASKS_PER_TASK} subtasks.`);
  }
  const subtasks = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpsError('invalid-argument', 'Subtask is invalid.');
    const record = item as Record<string, unknown>;
    return {
      id: requireString(record.id, 'Subtask ID', 64),
      title: requireText(record.title, 'Subtask title', 160),
      status: enumValue(record.status, SUBTASK_STATUSES, 'Subtask status', 'todo'),
      assignedTo: optionalId(record.assignedTo, 'Subtask assignee'),
      dueAt: optionalTimestamp(record.dueAt, 'Subtask due date')
    };
  });
  if (new Set(subtasks.map((subtask) => subtask.id)).size !== subtasks.length) {
    throw new HttpsError('invalid-argument', 'Each subtask can appear only once.');
  }
  return subtasks;
}

export function readSubtasks(value: unknown): Subtask[] {
  return Array.isArray(value) ? validateSubtasks(value) : [];
}

/**
 * Who may flip one subtask's status without being able to edit the card: the
 * person the parent card is assigned to, and the person the subtask itself is
 * assigned to. Anyone else needs admin rights, which are checked separately.
 */
export function canUpdateSubtaskStatus(task: { assignedTo?: unknown }, subtask: Subtask, uid: string): boolean {
  return task.assignedTo === uid || subtask.assignedTo === uid;
}

export function applySubtaskStatus(subtasks: Subtask[], change: { id: string; status: SubtaskStatus }): Subtask[] {
  if (!subtasks.some((subtask) => subtask.id === change.id)) throw new HttpsError('not-found', 'Subtask not found on this task.');
  return subtasks.map((subtask) => subtask.id === change.id ? { ...subtask, status: change.status } : subtask);
}

export function requireSubtaskStatusInput(value: unknown): { id: string; status: SubtaskStatus } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Subtask status change is invalid.');
  const record = value as Record<string, unknown>;
  return { id: requireString(record.id, 'Subtask ID', 64), status: enumValue(record.status, SUBTASK_STATUSES, 'Subtask status') };
}

async function notificationSnapshots(
  transaction: Transaction,
  recipients: string[],
  teamId: string,
  type: string,
  dedupeKey: string
) {
  const db = getFirestore();
  const uniqueRecipients = [...new Set(recipients)].filter(Boolean);
  const refs = uniqueRecipients.map((recipient) => db.doc(`notifications/${Buffer.from(`${recipient}_${teamId}_${dedupeKey}`).toString('base64url')}`));
  const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
  return refs.map((ref, index) => ({ ref, exists: snapshots[index].exists, recipientUserId: uniqueRecipients[index], type }));
}

function writeNotifications(
  transaction: Transaction,
  records: Array<{ ref: FirebaseFirestore.DocumentReference; exists: boolean; recipientUserId: string; type: string }>,
  teamId: string,
  title: string,
  body: string,
  deepLink: string,
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
      type: record.type,
      title,
      body,
      deepLink,
      dedupeKey,
      mandatory: false,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
  }
}

async function validateTaskReferences(transaction: Transaction, teamId: string, taskIds: string[]) {
  const db = getFirestore();
  const snapshots = await Promise.all(taskIds.map((taskId) => transaction.get(db.doc(`tasks/${taskId}`))));
  if (snapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.teamId !== teamId)) throw new HttpsError('not-found', 'A linked task was not found in this team.');
}

export function validateTaskInput(input: Record<string, unknown>) {
  const title = requireText(input.title, 'Task title', 160);
  const description = input.description === undefined ? '' : requireText(input.description, 'Task description', 4000);
  const status = enumValue(input.status, ['todo', 'inProgress', 'review', 'completed'] as const, 'Task status', 'todo');
  const priority = enumValue(input.priority, ['low', 'medium', 'high', 'urgent'] as const, 'Task priority', 'medium');
  const labels = stringArray(input.labels, 'Task labels', 20, 40);
  const watcherUserIds = stringArray(input.watcherUserIds, 'Task watchers', 20);
  const checklist = validateChecklist(input.checklist);
  const assignedTo = optionalId(input.assignedTo, 'Assigned user ID');
  const goalId = optionalId(input.goalId, 'Goal ID');
  const dueAt = optionalTimestamp(input.dueAt, 'Task due date');
  const startAt = optionalTimestamp(input.startAt, 'Task start date');
  const endAt = optionalTimestamp(input.endAt, 'Task end date');
  return { title, description, status, priority, labels, watcherUserIds, checklist, assignedTo, goalId, dueAt, startAt, endAt };
}

export const createTask = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = requestRecord(request);
  const task = validateTaskInput(input);
  const db = getFirestore();
  const taskId = entityId(input, 'taskId', 'task', db.collection('tasks').doc().id);
  const taskRef = db.doc(`tasks/${taskId}`);
  const projectId = `default_${teamId}`;
  const projectRef = db.doc(`projects/${projectId}`);
  const opRef = operationRef(teamId, operationId(input, 'createTask'));
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const [existing, operation, project, lastCards] = await Promise.all([
      transaction.get(taskRef),
      opRef ? transaction.get(opRef) : Promise.resolve(null),
      transaction.get(projectRef),
      transaction.get(db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).where('columnId', '==', task.status).orderBy('orderKey', 'desc').limit(MAX_CARDS_PER_COLUMN_PAGE))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Task')) return;
    if (!columnHasCapacity(lastCards.size)) throw new HttpsError('resource-exhausted', 'This column is full. Archive completed work before adding more cards.');
    if (task.assignedTo) await assertAssignableMemberInTransaction(transaction, teamId, task.assignedTo);
    for (const watcherUserId of task.watcherUserIds) await assertTeamMemberInTransaction(transaction, teamId, watcherUserId);
    let goalRef: FirebaseFirestore.DocumentReference | null = null;
    if (task.goalId) {
      const goal = await transaction.get(db.doc(`goals/${task.goalId}`));
      if (!goal.exists || goal.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Goal not found in this team.');
      goalRef = goal.ref;
    }
    const recipients = [task.assignedTo, ...task.watcherUserIds].filter((uid): uid is string => Boolean(uid && uid !== admin.uid));
    const notifications = await notificationSnapshots(transaction, recipients, teamId, 'task.assigned', `task:${taskId}:assigned`);
    const now = FieldValue.serverTimestamp();
    if (!project.exists) {
      transaction.set(projectRef, {
        id: projectId,
        teamId,
        createdBy: admin.uid,
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
    }
    if (goalRef) {
      transaction.update(goalRef, {
        taskCount: FieldValue.increment(1),
        ...(task.status === 'completed' ? { completedTaskCount: FieldValue.increment(1) } : {}),
        updatedAt: now
      });
    }
    transaction.set(taskRef, {
      id: taskId, teamId, createdBy: admin.uid, ...task,
      projectId, columnId: task.status, orderKey: Number(lastCards.docs[0]?.data().orderKey ?? 0) + ORDER_STEP,
      version: 1, completedAt: task.status === 'completed' ? now : null,
      ...(task.dueAt === null ? {} : { dueAt: task.dueAt }),
      historyCount: 1, attachmentFileIds: [], createdAt: now, updatedAt: now
    });
    transaction.set(db.collection('taskHistory').doc(), { id: taskRef.id, teamId, createdBy: admin.uid, taskId, actorUserId: admin.uid, action: 'created', changedFields: ['created'], createdAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `tasks/${taskId}`, metadata: { action: 'task.created' } }));
    if (opRef) transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'task.create', createdAt: now });
    writeNotifications(transaction, notifications, teamId, 'New task assigned', task.title, `/coordination?project=${encodeURIComponent(projectId)}&task=${encodeURIComponent(taskId)}`, `task:${taskId}:assigned`);
  });
  return { taskId };
};

export const updateTask = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const taskId = requireString(getInput(request, 'taskId'), 'Task ID');
  const input = requestRecord(request);
  const db = getFirestore();
  const opRef = operationRef(teamId, operationId(input, 'updateTask'));
  // Coaches, team leaders and students edit any task's details. Any other
  // member may only progress work assigned to them.
  const editor = isTaskEditor(actor);
  const assigneeOnlyFields = new Set(['status', 'checklist', 'comment', 'subtaskStatus', 'expectedVersion', 'operationId', 'taskId', 'teamId']);
  for (const key of Object.keys(input)) if (!editor && !assigneeOnlyFields.has(key)) throw new HttpsError('permission-denied', 'Your role can update status, checklist, subtask status, and comments only.');
  const nextStatus = has(input, 'status') ? enumValue(input.status, ['todo', 'inProgress', 'review', 'completed'] as const, 'Task status') : undefined;
  const nextChecklist = has(input, 'checklist') ? validateChecklist(input.checklist) : undefined;
  const comment = has(input, 'comment') ? requireText(input.comment, 'Task comment', 2000) : undefined;
  const subtaskStatus = has(input, 'subtaskStatus') ? requireSubtaskStatusInput(input.subtaskStatus) : undefined;
  const adminFields: Record<string, unknown> = {};
  if (editor) {
    if (has(input, 'title')) adminFields.title = requireText(input.title, 'Task title', 160);
    if (has(input, 'description')) adminFields.description = requireText(input.description, 'Task description', 4000);
    if (has(input, 'priority')) adminFields.priority = enumValue(input.priority, ['low', 'medium', 'high', 'urgent'] as const, 'Task priority');
    if (has(input, 'assignedTo')) adminFields.assignedTo = optionalId(input.assignedTo, 'Assigned user ID');
    if (has(input, 'goalId')) adminFields.goalId = optionalId(input.goalId, 'Goal ID');
    if (has(input, 'labels')) adminFields.labels = stringArray(input.labels, 'Task labels', 20, 40);
    if (has(input, 'categoryId')) adminFields.categoryId = optionalId(input.categoryId, 'Category ID');
    if (has(input, 'watcherUserIds')) adminFields.watcherUserIds = stringArray(input.watcherUserIds, 'Task watchers', 20);
    if (has(input, 'dueAt')) adminFields.dueAt = optionalTimestamp(input.dueAt, 'Task due date');
    // Planned window, separate from the deadline: a card can start before it is
    // due and finish after it, and the board's timeline reads these first.
    if (has(input, 'startAt')) adminFields.startAt = optionalTimestamp(input.startAt, 'Task start date');
    if (has(input, 'endAt')) adminFields.endAt = optionalTimestamp(input.endAt, 'Task end date');
    if (has(input, 'subtasks')) adminFields.subtasks = validateSubtasks(input.subtasks);
  }
  const requiresExpectedVersion = Object.keys(adminFields).length > 0;
  if (requiresExpectedVersion && !has(input, 'expectedVersion')) {
    throw new HttpsError('invalid-argument', 'Expected version is required when editing task details.');
  }
  const expectedVersion = has(input, 'expectedVersion') ? mutationVersion(input.expectedVersion, 'Expected version') : undefined;
  const committedVersion = await db.runTransaction(async (transaction) => {
    const actorMembership = await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const taskRef = db.doc(`tasks/${taskId}`);
    const taskSnapshot = await transaction.get(taskRef);
    const operation = opRef ? await transaction.get(opRef) : null;
    const current = taskSnapshot.data();
    if (!taskSnapshot.exists || current?.teamId !== teamId) throw new HttpsError('not-found', 'Task not found.');
    if (operation?.exists) return taskOperationVersion(operation.data() ?? {}, { teamId, actorUserId: actor.uid, taskId });
    const nextVersion = nextTaskMutationVersion(current.version, expectedVersion);
    const currentEditor = actor.platformAdmin || TASK_EDITOR_ROLES.includes(String(actorMembership.role));
    // The editor-only field set was built from the role read BEFORE the
    // transaction. Re-check it against the in-transaction membership so a
    // member demoted in between cannot still apply editor-only edits.
    if (!currentEditor && Object.keys(adminFields).length > 0) {
      throw new HttpsError('permission-denied', 'Your role can update status, checklist, subtask status, and comments only.');
    }
    // Parents follow the board read-only. A task assigned to one before that
    // rule existed must not let them tick it off through the assignee path.
    if (!currentEditor && !isTaskAssignableRole(actorMembership.role)) {
      throw new HttpsError('permission-denied', 'Parents can view the tracker but cannot change it.');
    }
    const storedSubtasks = readSubtasks(current.subtasks);
    const targetSubtask = subtaskStatus ? storedSubtasks.find((entry) => entry.id === subtaskStatus.id) : undefined;
    if (subtaskStatus && !targetSubtask) throw new HttpsError('not-found', 'Subtask not found on this task.');
    // A student assigned only to one sub-item may tick that sub-item off, and
    // nothing else on the card. Any other edit still needs the card itself.
    const subtaskStatusOnly = subtaskStatus !== undefined
      && nextStatus === undefined
      && nextChecklist === undefined
      && comment === undefined
      && Object.keys(adminFields).length === 0;
    const mayEditAsAssignee = current.assignedTo === actor.uid
      || (subtaskStatusOnly && targetSubtask !== undefined && canUpdateSubtaskStatus(current, targetSubtask, actor.uid));
    if (!currentEditor && !mayEditAsAssignee) throw new HttpsError('permission-denied', 'Only the assignee can update this task.');
    const nextSubtasks = subtaskStatus ? applySubtaskStatus(storedSubtasks, subtaskStatus) : undefined;
    // Checked only when the assignee actually changes, so editing the title of
    // a card assigned to a parent before the rule existed still saves.
    if (adminFields.assignedTo && adminFields.assignedTo !== current.assignedTo) {
      await assertAssignableMemberInTransaction(transaction, teamId, String(adminFields.assignedTo));
    }
    if (Array.isArray(adminFields.subtasks)) {
      const previousAssignees = new Map(storedSubtasks.map((entry) => [entry.id, entry.assignedTo]));
      for (const subtask of adminFields.subtasks as Subtask[]) {
        if (subtask.assignedTo && subtask.assignedTo !== previousAssignees.get(subtask.id)) {
          await assertAssignableMemberInTransaction(transaction, teamId, subtask.assignedTo);
        }
      }
    }
    const nextWatcherUserIds = Array.isArray(adminFields.watcherUserIds) ? adminFields.watcherUserIds : Array.isArray(current.watcherUserIds) ? current.watcherUserIds : [];
    for (const watcherUserId of nextWatcherUserIds) await assertTeamMemberInTransaction(transaction, teamId, String(watcherUserId));
    if (adminFields.goalId) {
      const goal = await transaction.get(db.doc(`goals/${String(adminFields.goalId)}`));
      if (!goal.exists || goal.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Goal not found in this team.');
    }
    // A category belongs to one board, so it is checked against the board this
    // card is actually on rather than against anything the caller supplied.
    if (has(adminFields, 'categoryId')) {
      if (typeof current.projectId !== 'string') throw new HttpsError('failed-precondition', 'This task is not on a board yet.');
      const projectSnapshot = await transaction.get(db.doc(`projects/${current.projectId}`));
      const categories = projectCategories(requireProject(projectSnapshot, teamId));
      const nextCategoryId = adminFields.categoryId === null ? null : requireCategoryId(categories, adminFields.categoryId);
      // Moving a card to another work package moves it under that package's
      // milestone, unless this same edit named a milestone explicitly.
      if (!has(adminFields, 'goalId') && nextCategoryId !== (current.categoryId ?? null)) {
        adminFields.goalId = categoryGoalId(categories, nextCategoryId);
      }
    }
    let boardMoveFields: Record<string, unknown> = {};
    if (nextStatus !== undefined && nextStatus !== current.status && typeof current.projectId === 'string') {
      // The card's column used to be set to the status id outright. On a board
      // with custom columns ("Building", "Testing") no such column exists, so
      // the card moved into a column nothing renders and vanished from the
      // board. Resolve the status against this board's real workflow instead:
      // "completed" means the board's completion column, a status that names a
      // column moves there, and anything else changes the status while the card
      // stays where it is.
      const projectSnapshot = await transaction.get(db.doc(`projects/${current.projectId}`));
      const project = projectSnapshot.data();
      const columns = project?.archived === true || !projectSnapshot.exists ? [] : projectColumns(project ?? {});
      const completedColumnId = typeof project?.completedColumnId === 'string' ? project.completedColumnId : 'completed';
      const requested = nextStatus === 'completed' ? completedColumnId : nextStatus;
      const targetColumnId = columns.some((column) => column.id === requested) ? requested : String(current.columnId ?? requested);
      if (targetColumnId !== current.columnId) {
        const targetCards = await transaction.get(db.collection('tasks')
          .where('teamId', '==', teamId)
          .where('projectId', '==', current.projectId)
          .where('columnId', '==', targetColumnId)
          .orderBy('orderKey', 'desc')
          .limit(MAX_CARDS_PER_COLUMN_PAGE));
        if (!columnHasCapacity(targetCards.size)) {
          throw new HttpsError('resource-exhausted', 'That column is full. Archive completed work before moving more cards into it.');
        }
        boardMoveFields = {
          columnId: targetColumnId,
          orderKey: Number(targetCards.docs[0]?.data().orderKey ?? 0) + ORDER_STEP
        };
      }
      boardMoveFields.completedAt = targetColumnId === completedColumnId ? current.completedAt ?? FieldValue.serverTimestamp() : null;
    }
    const recipients = [String(adminFields.assignedTo ?? current.assignedTo ?? ''), ...(Array.isArray(adminFields.watcherUserIds) ? adminFields.watcherUserIds : Array.isArray(current.watcherUserIds) ? current.watcherUserIds : [])].filter((uid) => uid && uid !== actor.uid);
    const dedupe = taskNotificationDedupeKey(taskId, nextVersion);
    const notifications = await notificationSnapshots(transaction, recipients, teamId, 'task.updated', dedupe);
    const fields = {
      ...adminFields,
      ...(nextStatus === undefined ? {} : { status: nextStatus }),
      ...(nextChecklist === undefined ? {} : { checklist: nextChecklist }),
      ...(nextSubtasks === undefined ? {} : { subtasks: nextSubtasks }),
      ...boardMoveFields,
      version: nextVersion,
      updatedAt: FieldValue.serverTimestamp()
    };
    const changedFields = Object.keys(fields).filter((field) => field !== 'updatedAt' && field !== 'version');
    if (comment) changedFields.push('comment');
    const action = nextStatus === 'completed' ? 'completed' : nextStatus && nextStatus !== current.status ? 'status.changed' : 'updated';
    transaction.set(db.collection('taskHistory').doc(), { id: taskId, teamId, createdBy: actor.uid, taskId, actorUserId: actor.uid, action, changedFields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (comment) transaction.set(db.collection('taskComments').doc(), { id: taskId, teamId, createdBy: actor.uid, taskId, authorUserId: actor.uid, body: comment, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const currentGoalId = typeof current.goalId === 'string' ? current.goalId : null;
    const nextGoalId = has(adminFields, 'goalId') ? typeof adminFields.goalId === 'string' ? adminFields.goalId : null : currentGoalId;
    const wasCompleted = current.status === 'completed';
    const willBeCompleted = (nextStatus ?? current.status) === 'completed';
    if (currentGoalId !== nextGoalId) {
      if (currentGoalId) {
        transaction.update(db.doc(`goals/${currentGoalId}`), {
          taskCount: FieldValue.increment(-1),
          ...(wasCompleted ? { completedTaskCount: FieldValue.increment(-1) } : {}),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      if (nextGoalId) {
        transaction.update(db.doc(`goals/${nextGoalId}`), {
          taskCount: FieldValue.increment(1),
          ...(willBeCompleted ? { completedTaskCount: FieldValue.increment(1) } : {}),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    } else if (currentGoalId && wasCompleted !== willBeCompleted) {
      transaction.update(db.doc(`goals/${currentGoalId}`), { completedTaskCount: FieldValue.increment(willBeCompleted ? 1 : -1), updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `tasks/${taskId}`, metadata: { action } }));
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'task.update', taskId, version: nextVersion, createdAt: FieldValue.serverTimestamp() });
    const projectQuery = typeof current.projectId === 'string' ? `project=${encodeURIComponent(current.projectId)}&` : '';
    writeNotifications(transaction, notifications, teamId, 'Task updated', String(current.title), `/coordination?${projectQuery}task=${encodeURIComponent(taskId)}`, dedupe);
    transaction.update(taskRef, { ...fields, historyCount: FieldValue.increment(1) });
    return nextVersion;
  });
  return { taskId, version: committedVersion };
};

export const createGoal = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = requestRecord(request);
  const title = requireText(input.title, 'Goal title', 160);
  const description = input.description === undefined ? '' : requireText(input.description, 'Goal description', 4000);
  const dueAt = optionalTimestamp(input.dueAt, 'Goal due date');
  const db = getFirestore();
  const goalId = entityId(input, 'goalId', 'goal', db.collection('goals').doc().id);
  const opRef = operationRef(teamId, operationId(input, 'createGoal'));
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`goals/${goalId}`);
    const existing = await transaction.get(ref);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Goal')) return;
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: goalId, teamId, createdBy: admin.uid, title, description, status: 'active', version: 1, dueAt, taskCount: 0, completedTaskCount: 0, createdAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `goals/${goalId}`, metadata: { action: 'goal.created' } }));
    if (opRef) transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'goal.create', createdAt: now });
  });
  return { goalId };
};

export const updateGoal = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const goalId = requireString(getInput(request, 'goalId'), 'Goal ID');
  const input = requestRecord(request);
  const updates: Record<string, unknown> = {};
  if (has(input, 'title')) updates.title = requireText(input.title, 'Goal title', 160);
  if (has(input, 'description')) updates.description = requireText(input.description, 'Goal description', 4000);
  if (has(input, 'status')) updates.status = enumValue(input.status, ['active', 'completed', 'archived'] as const, 'Goal status');
  if (has(input, 'dueAt')) updates.dueAt = optionalTimestamp(input.dueAt, 'Goal due date');
  // Goals are edited by several coaches at once and used to carry no version at
  // all, so concurrent edits silently overwrote each other. Editing now follows
  // the same optimistic-concurrency contract as tasks.
  const expectedVersion = mutationVersion(input.expectedVersion, 'Expected version');
  const db = getFirestore();
  const opRef = operationRef(teamId, operationId(input, 'updateGoal'));
  const committedVersion = await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`goals/${goalId}`);
    const snapshot = await transaction.get(ref);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Goal not found.');
    if (operation?.exists) return goalOperationVersion(operation.data() ?? {}, { teamId, actorUserId: admin.uid, goalId });
    const nextVersion = nextGoalMutationVersion(snapshot.data()?.version, expectedVersion);
    const now = FieldValue.serverTimestamp();
    transaction.update(ref, { ...updates, version: nextVersion, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `goals/${goalId}`, metadata: { action: 'goal.updated' } }));
    if (opRef) transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'goal.update', goalId, version: nextVersion, createdAt: now });
    return nextVersion;
  });
  return { goalId, ...updates, version: committedVersion };
};

export const markNotificationRead = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const auth = await requireTeamMember(request, teamId);
  const notificationId = requireString(getInput(request, 'notificationId'), 'Notification ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`notifications/${notificationId}`);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.recipientUserId !== auth.uid || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Notification not found.');
    transaction.update(ref, { readAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { notificationId, read: true };
};

export const createFileMetadata = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const member = await requireTeamAdmin(request, teamId);
  const input = requestRecord(request);
  const name = requireString(input.name, 'File name', 180);
  if (name.includes('/') || name.includes('\\')) throw new HttpsError('invalid-argument', 'File name must not contain a path.');
  const contentType = validateContentType(input.contentType);
  if (!ALLOWED_FILE_TYPES.has(contentType)) throw new HttpsError('invalid-argument', 'This file type is not permitted.');
  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) throw new HttpsError('invalid-argument', 'File size must be between 1 byte and 10 MB.');
  const linkedTaskIds = stringArray(input.linkedTaskIds, 'Linked tasks', 20);
  const fileId = input.fileId === undefined ? getFirestore().collection('fileMetadata').doc().id : requireString(input.fileId, 'File ID');
  const storagePath = `teams/${teamId}/files/${fileId}/${name}`;
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, member);
    const policy = await transaction.get(db.doc(`teamPolicies/${teamId}`));
    if (policy.data()?.fileSharing !== 'teamOnly') throw new HttpsError('permission-denied', 'Team file sharing is disabled by policy.');
    await validateTaskReferences(transaction, teamId, linkedTaskIds);
    const folderId = optionalId(input.folderId, 'Folder ID');
    if (folderId) {
      const folder = await transaction.get(db.doc(`folders/${folderId}`));
      if (!folder.exists || folder.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Folder not found in this team.');
    }
    const ref = db.doc(`fileMetadata/${fileId}`);
    if ((await transaction.get(ref)).exists) return;
    const now = FieldValue.serverTimestamp();
    // The upload has not been verified yet, so it starts `pending` and is only
    // promoted to `clean` by completeFileUpload once the stored object matched
    // the approved name, type, and size. Consumers gate on this field.
    transaction.set(ref, { id: fileId, teamId, createdBy: member.uid, name, storagePath, contentType, sizeBytes, status: 'pending', scanStatus: 'pending', folderId, linkedTaskIds, uploadedBy: member.uid, createdAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: member.uid, teamId, targetResource: `fileMetadata/${fileId}`, metadata: { action: 'file.metadata.created' } }));
    for (const taskId of linkedTaskIds) transaction.update(db.doc(`tasks/${taskId}`), { attachmentFileIds: FieldValue.arrayUnion(fileId), updatedAt: now });
  });
  return { fileId, storagePath, maxBytes: MAX_FILE_BYTES };
};

export const completeFileUpload = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const member = await requireTeamMember(request, teamId);
  const fileId = requireString(getInput(request, 'fileId'), 'File ID');
  const db = getFirestore();
  const ref = db.doc(`fileMetadata/${fileId}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.teamId !== teamId || data.uploadedBy !== member.uid) throw new HttpsError('permission-denied', 'Only the uploader can complete this file.');
  // The default bucket comes from the runtime's FIREBASE_CONFIG. Deriving
  // `<project>.appspot.com` broke every upload on projects created after Firebase
  // moved default buckets to `<project>.firebasestorage.app`, where that name
  // does not exist. An explicit override is still honoured.
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  const file = (bucketName ? getStorage().bucket(bucketName) : getStorage().bucket()).file(String(data.storagePath));
  const [metadata] = await file.getMetadata();
  const actualSize = Number(metadata.size ?? 0);
  if (actualSize < 1 || actualSize > MAX_FILE_BYTES || actualSize !== Number(data.sizeBytes) || String(metadata.contentType ?? '') !== data.contentType) throw new HttpsError('failed-precondition', 'Uploaded file metadata does not match the approved file.');

  // Inspect the bytes before the file can ever be downloaded. A mismatch marks
  // the record blocked, which keeps the object unreadable under storage.rules
  // even though it is already in the bucket.
  const [head] = await file.download({ start: 0, end: Math.min(CONTENT_SNIFF_BYTES, actualSize) - 1 });
  const mismatch = detectContentMismatch(String(data.contentType), new Uint8Array(head));
  if (mismatch) {
    await ref.set({ scanStatus: 'blocked', status: 'blocked', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection('auditEvents').doc().set(auditRecord({
      type: 'administrative.action',
      actorUserId: member.uid,
      teamId,
      targetResource: `fileMetadata/${fileId}`,
      metadata: { action: 'file.upload.blocked' }
    }));
    throw new HttpsError('failed-precondition', `This file was rejected because its contents are ${mismatch}. Upload the original file without renaming it.`);
  }
  const auditEventId = `file-upload-completed_${fileId}`;
  const auditRef = db.doc(`auditEvents/${auditEventId}`);
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, member.uid);
    const [current, existingAudit] = await Promise.all([
      transaction.get(ref),
      transaction.get(auditRef)
    ]);
    const currentData = current.data();
    if (!current.exists || currentData?.teamId !== teamId || currentData.uploadedBy !== member.uid) {
      throw new HttpsError('permission-denied', 'Only the uploader can complete this file.');
    }
    if (currentData.storagePath !== data.storagePath
      || currentData.contentType !== data.contentType
      || Number(currentData.sizeBytes) !== Number(data.sizeBytes)) {
      throw new HttpsError('aborted', 'The approved file metadata changed. Restart the upload.');
    }
    if (!['pending', 'ready'].includes(String(currentData.status))) {
      throw new HttpsError('failed-precondition', 'This upload cannot be completed.');
    }
    if (String(currentData.status) === 'blocked' || String(currentData.scanStatus) === 'blocked') {
      throw new HttpsError('failed-precondition', 'This file was blocked and cannot be published.');
    }
    if (currentData.status === 'pending' || currentData.scanStatus !== 'clean') {
      transaction.update(ref, { status: 'ready', scanStatus: 'clean', updatedAt: FieldValue.serverTimestamp() });
    }
    if (!existingAudit.exists) {
      transaction.set(auditRef, auditRecord({ type: 'administrative.action', actorUserId: member.uid, teamId, targetResource: `fileMetadata/${fileId}`, metadata: { action: 'file.upload.completed' } }));
    }
  });
  return { fileId, status: 'ready' as const, scanStatus: 'clean' as const, auditEventId };
};

export const linkFileToTask = async (request: Phase3Request) => {
  const teamId = requireTeamId(request);
  const member = await requireTeamMember(request, teamId);
  const fileId = requireString(getInput(request, 'fileId'), 'File ID');
  const taskId = requireString(getInput(request, 'taskId'), 'Task ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const membership = await assertTeamMemberInTransaction(transaction, teamId, member.uid);
    const fileRef = db.doc(`fileMetadata/${fileId}`);
    const taskRef = db.doc(`tasks/${taskId}`);
    const [file, task] = await Promise.all([transaction.get(fileRef), transaction.get(taskRef)]);
    if (!file.exists || file.data()?.teamId !== teamId || !task.exists || task.data()?.teamId !== teamId) throw new HttpsError('not-found', 'File or task not found in this team.');
    if (file.data()?.uploadedBy !== member.uid && !['coach', 'teamLeader'].includes(String(membership.role))) throw new HttpsError('permission-denied', 'Only the uploader or a coach can link this file.');
    transaction.update(fileRef, { linkedTaskIds: FieldValue.arrayUnion(taskId), updatedAt: FieldValue.serverTimestamp() });
    transaction.update(taskRef, { attachmentFileIds: FieldValue.arrayUnion(fileId), updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: member.uid, teamId, targetResource: `fileMetadata/${fileId}`, metadata: { action: 'file.linked' } }));
  });
  return { fileId, taskId };
};
