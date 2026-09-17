import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore';
import type { KanbanProject, ProjectCategory, ProjectColumn, ProjectTemplate, ProjectTemplateCard, Subtask, SubtaskStatus, TrackerTask } from './domain';
import { MAX_SUBTASKS_PER_TASK } from './domain';
import { call } from './callable';

export const KANBAN_COLUMN_PAGE_SIZE = 50;


function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseColumn(value: unknown): ProjectColumn | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const color = ['blue', 'purple', 'orange', 'green', 'slate', 'pink'].includes(String(record.color))
    ? String(record.color) as ProjectColumn['color']
    : 'slate';
  const id = text(record.id);
  const name = text(record.name);
  return id && name ? { id, name, color } : null;
}

export const MAX_CATEGORIES_PER_PROJECT = 20;

export function parseCategory(value: unknown): ProjectCategory | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const name = text(record.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    color: ['blue', 'purple', 'orange', 'green', 'slate', 'pink'].includes(String(record.color)) ? String(record.color) as ProjectCategory['color'] : 'slate',
    areaId: typeof record.areaId === 'string' && record.areaId ? record.areaId : null,
    goalId: typeof record.goalId === 'string' && record.goalId ? record.goalId : null
  };
}

export function parseKanbanProject(id: string, data: Record<string, unknown>): KanbanProject {
  return {
    id,
    teamId: text(data.teamId),
    createdBy: text(data.createdBy),
    name: text(data.name, 'Untitled project'),
    description: text(data.description),
    columns: Array.isArray(data.columns) ? data.columns.map(parseColumn).filter((column): column is ProjectColumn => Boolean(column)).slice(0, 8) : [],
    categories: Array.isArray(data.categories)
      ? data.categories.map(parseCategory).filter((category): category is ProjectCategory => Boolean(category)).slice(0, MAX_CATEGORIES_PER_PROJECT)
      : [],
    completedColumnId: text(data.completedColumnId, 'completed'),
    version: Math.max(1, Math.trunc(finiteNumber(data.version, 1))),
    archived: data.archived === true,
    archivedAt: data.archivedAt ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export function parseSubtask(value: unknown): Subtask | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const title = text(record.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    status: ['todo', 'inProgress', 'done'].includes(String(record.status)) ? record.status as Subtask['status'] : 'todo',
    assignedTo: typeof record.assignedTo === 'string' && record.assignedTo ? record.assignedTo : null,
    dueAt: record.dueAt ?? null
  };
}

export function parseKanbanTask(id: string, data: Record<string, unknown>): TrackerTask {
  const status = ['todo', 'inProgress', 'review', 'completed'].includes(String(data.status)) ? data.status as TrackerTask['status'] : 'todo';
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(data.priority)) ? data.priority as TrackerTask['priority'] : 'medium';
  const version = finiteNumber(data.version, 1);
  return {
    id,
    teamId: text(data.teamId),
    createdBy: text(data.createdBy),
    title: text(data.title, 'Untitled task'),
    description: text(data.description),
    status,
    priority,
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : null,
    watcherUserIds: Array.isArray(data.watcherUserIds) ? data.watcherUserIds.map(String) : [],
    goalId: typeof data.goalId === 'string' ? data.goalId : null,
    categoryId: typeof data.categoryId === 'string' && data.categoryId ? data.categoryId : null,
    labels: Array.isArray(data.labels) ? data.labels.map(String) : [],
    checklist: Array.isArray(data.checklist) ? data.checklist as TrackerTask['checklist'] : [],
    subtasks: Array.isArray(data.subtasks)
      ? data.subtasks.map(parseSubtask).filter((subtask): subtask is Subtask => Boolean(subtask)).slice(0, MAX_SUBTASKS_PER_TASK)
      : [],
    attachmentFileIds: Array.isArray(data.attachmentFileIds) ? data.attachmentFileIds.map(String) : [],
    dueAt: data.dueAt ?? null,
    startAt: data.startAt ?? null,
    endAt: data.endAt ?? null,
    historyCount: Number(data.historyCount ?? 0),
    projectId: text(data.projectId),
    columnId: text(data.columnId),
    orderKey: finiteNumber(data.orderKey, 0),
    version: Number.isInteger(version) && version >= 1 ? version : 1,
    completedAt: data.completedAt ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

/**
 * A team with a pre-Kanban tracker is migrated one page at a time. The cap stops a
 * server that keeps handing back a cursor from looping forever, and the signal lets
 * the caller stop the walk when the active team changes — the `teamId` in this
 * closure is fixed for the whole loop, so an un-abortable loop keeps migrating a
 * team the user has already left.
 */
export const MAX_MIGRATION_PAGES = 20;

export type MigrationProgress = { page: number; migratedTaskCount: number };

export type EnsureDefaultProjectResult = {
  projectId: string;
  created: boolean;
  migratedTaskCount: number;
  /** False when the walk stopped early because it was aborted or hit the page cap. */
  complete: boolean;
  pages: number;
};

export async function ensureDefaultProject(
  teamId: string,
  options: { signal?: AbortSignal; onProgress?: (progress: MigrationProgress) => void } = {}
): Promise<EnsureDefaultProjectResult> {
  let cursor: string | null = null;
  let projectId = '';
  let created = false;
  let migratedTaskCount = 0;
  let pages = 0;
  do {
    if (options.signal?.aborted) return { projectId, created, migratedTaskCount, complete: false, pages };
    const result: { projectId: string; created: boolean; migratedTaskCount: number; nextCursor?: string | null } = await call<
      { teamId: string; cursor?: string },
      { projectId: string; created: boolean; migratedTaskCount: number; nextCursor?: string | null }
    >('ensureDefaultProject', { teamId, ...(cursor ? { cursor } : {}) });
    projectId = result.projectId;
    created ||= result.created;
    migratedTaskCount += Number(result.migratedTaskCount ?? 0);
    pages += 1;
    cursor = result.nextCursor ?? null;
    if (cursor && !options.signal?.aborted) options.onProgress?.({ page: pages, migratedTaskCount });
  } while (cursor && pages < MAX_MIGRATION_PAGES);
  return { projectId, created, migratedTaskCount, complete: !cursor, pages };
}

export function createProject(input: { teamId: string; operationId: string; name: string; description?: string }) {
  return call<typeof input, { projectId: string }>('createProject', input);
}

export function updateProject(input: { teamId: string; projectId: string; name?: string; description?: string }) {
  return call<typeof input, { projectId: string }>('updateProject', input);
}

export function archiveProject(teamId: string, projectId: string) {
  return call<{ teamId: string; projectId: string }, { projectId: string; archived: true }>('archiveProject', { teamId, projectId });
}

/**
 * Every column mutation rewrites the project's whole `columns` array, so the server
 * enforces optimistic concurrency: the caller sends the version the board was read
 * at, and a mismatch is an `aborted` conflict rather than a silent overwrite of the
 * other coach's rename or reorder. `projectVersion` normalises a project written
 * before the field existed to 1.
 */
export function projectVersion(project: Pick<KanbanProject, 'version'> | null | undefined): number {
  const version = Math.trunc(Number(project?.version ?? 1));
  return Number.isSafeInteger(version) && version >= 1 ? version : 1;
}

/** Adding a column is append-only, so the version check is optional here alone. */
export function addProjectColumn(input: { teamId: string; projectId: string; operationId: string; name: string; color?: ProjectColumn['color']; expectedVersion?: number }) {
  return call<typeof input, { projectId: string; columnId: string; version: number }>('addProjectColumn', input);
}

export function updateProjectColumn(input: { teamId: string; projectId: string; columnId: string; expectedVersion: number; name?: string; color?: ProjectColumn['color']; isCompleted?: boolean }) {
  return call<typeof input, { projectId: string; columnId: string; version: number }>('updateProjectColumn', input);
}

export function reorderProjectColumns(teamId: string, projectId: string, columnIds: string[], expectedVersion: number) {
  return call<{ teamId: string; projectId: string; columnIds: string[]; expectedVersion: number }, { projectId: string; columnIds: string[]; version: number }>('reorderProjectColumns', { teamId, projectId, columnIds, expectedVersion });
}

/**
 * Categories are sent as the complete list, in the order the board should show
 * them: one call covers add, rename, recolor, retag, reorder and remove, and
 * `expectedVersion` makes two coaches editing at once a conflict rather than a
 * silent overwrite. An entry without an `id` is created by the server.
 */
export type ProjectCategoryInput = { id?: string | null; name: string; color?: ProjectCategory['color']; areaId?: string | null; goalId?: string | null };

export function updateProjectCategories(input: { teamId: string; projectId: string; categories: ProjectCategoryInput[]; expectedVersion: number }) {
  return call<typeof input, { projectId: string; categories: ProjectCategory[]; version: number }>('updateProjectCategories', input);
}

export function removeProjectColumn(teamId: string, projectId: string, columnId: string, expectedVersion: number) {
  return call<{ teamId: string; projectId: string; columnId: string; expectedVersion: number }, { projectId: string; columnId: string; removed: true; version: number }>('removeProjectColumn', { teamId, projectId, columnId, expectedVersion });
}

/** A version mismatch comes back as `aborted`, through the callable prefix or without it. */
export function isVersionConflict(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  return code === 'aborted' || code === 'functions/aborted';
}

/**
 * Templates are bounded the same way boards are: a team keeps a small named set,
 * and a template seeds a starting board rather than a whole season of work.
 */
export const MAX_TEMPLATES_PER_TEAM = 12;
export const MAX_TEMPLATE_CARDS = 40;

function parseTemplateCard(value: unknown, columnIds: Set<string>, categoryIds: Set<string>): ProjectTemplateCard | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const columnId = text(record.columnId);
  const title = text(record.title);
  if (!columnId || !columnIds.has(columnId) || !title) return null;
  return {
    columnId,
    categoryId: categoryIds.has(text(record.categoryId)) ? text(record.categoryId) : null,
    title,
    description: text(record.description),
    priority: ['low', 'medium', 'high', 'urgent'].includes(String(record.priority)) ? record.priority as ProjectTemplateCard['priority'] : 'medium',
    labels: Array.isArray(record.labels) ? record.labels.map(String).slice(0, 20) : []
  };
}

export function parseProjectTemplate(value: unknown): ProjectTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const columns = Array.isArray(record.columns)
    ? record.columns.map(parseColumn).filter((column): column is ProjectColumn => Boolean(column)).slice(0, 8)
    : [];
  if (!id || columns.length < 2) return null;
  const columnIds = new Set(columns.map((column) => column.id));
  const categories = Array.isArray(record.categories)
    ? record.categories.map(parseCategory).filter((category): category is ProjectCategory => Boolean(category)).slice(0, MAX_CATEGORIES_PER_PROJECT)
    : [];
  const categoryIds = new Set(categories.map((category) => category.id));
  const completedColumnId = columnIds.has(text(record.completedColumnId)) ? text(record.completedColumnId) : columns[columns.length - 1].id;
  return {
    id,
    source: record.source === 'builtIn' ? 'builtIn' : 'team',
    name: text(record.name, 'Untitled template'),
    description: text(record.description),
    columns,
    categories,
    completedColumnId,
    cards: Array.isArray(record.cards)
      ? record.cards.map((card) => parseTemplateCard(card, columnIds, categoryIds)).filter((card): card is ProjectTemplateCard => Boolean(card)).slice(0, MAX_TEMPLATE_CARDS)
      : []
  };
}

export type ProjectTemplateCatalogue = { builtIn: ProjectTemplate[]; team: ProjectTemplate[] };

/**
 * Read-only callable rather than a Firestore query: the built-in presets live in
 * server code and have no documents to read, so serving both catalogues from one
 * place is what keeps the client from carrying a second copy of the definitions.
 */
export async function listProjectTemplates(teamId: string): Promise<ProjectTemplateCatalogue> {
  const result = await call<{ teamId: string }, { builtIn?: unknown; team?: unknown }>('listProjectTemplates', { teamId });
  const parse = (value: unknown) => (Array.isArray(value) ? value : [])
    .map(parseProjectTemplate)
    .filter((template): template is ProjectTemplate => Boolean(template));
  return { builtIn: parse(result.builtIn), team: parse(result.team).slice(0, MAX_TEMPLATES_PER_TEAM) };
}

export type CreateProjectFromTemplateInput = {
  teamId: string;
  operationId: string;
  templateId: string;
  name?: string;
  includeCards?: boolean;
};

export function createProjectFromTemplate(input: CreateProjectFromTemplateInput) {
  return call<CreateProjectFromTemplateInput, { projectId: string; templateId: string; cardCount: number }>('createProjectFromTemplate', input);
}

export type SaveProjectAsTemplateInput = {
  teamId: string;
  operationId: string;
  projectId: string;
  name: string;
  description?: string;
  includeCards?: boolean;
};

export function saveProjectAsTemplate(input: SaveProjectAsTemplateInput) {
  return call<SaveProjectAsTemplateInput, { templateId: string; projectId: string; cardCount: number }>('saveProjectAsTemplate', input);
}

export function deleteProjectTemplate(teamId: string, templateId: string) {
  return call<{ teamId: string; templateId: string }, { templateId: string; deleted: true }>('deleteProjectTemplate', { teamId, templateId });
}

export type CreateKanbanTaskInput = {
  teamId: string;
  projectId: string;
  columnId: string;
  operationId: string;
  title: string;
  description?: string;
  priority?: TrackerTask['priority'];
  assignedTo?: string | null;
  watcherUserIds?: string[];
  labels?: string[];
  goalId?: string | null;
  categoryId?: string | null;
};

export function createKanbanTask(input: CreateKanbanTaskInput) {
  return call<CreateKanbanTaskInput, { taskId: string; projectId: string; columnId: string }>('createKanbanTask', input);
}

export type ImportTaskRowInput = {
  title: string;
  description?: string;
  priority?: TrackerTask['priority'];
  /** A judging-area id; the server adds it as the task's first label. */
  area?: string | null;
  labels?: string[];
  dueAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  /** Resolved by `resolveImportAssignees`; the server re-checks membership. */
  assignedTo?: string | null;
  /** The board column this row asked for by name, matched in the preview. */
  columnId?: string | null;
  /** Matched case-insensitively against the board; a new name is created on import. */
  categoryName?: string | null;
  subtasks?: Array<{ id: string; title: string; status: SubtaskStatus; assignedTo: string | null; dueAt: string | null }>;
};

export type ImportAssigneeMatch = { value: string; userId: string | null; displayName: string | null; reason: 'matched' | 'unknown' | 'ambiguous' };

/**
 * Names and email addresses from the sheet are matched on the server: profile
 * documents are readable only by their owner, so the browser cannot do it, and
 * only the resolved id and display name come back.
 */
export function resolveImportAssignees(teamId: string, values: string[]) {
  return call<{ teamId: string; values: string[] }, { matches: ImportAssigneeMatch[] }>('resolveImportAssignees', { teamId, values });
}

export type ImportProjectTasksInput = {
  teamId: string;
  projectId: string;
  operationId: string;
  columnId?: string;
  rows: ImportTaskRowInput[];
};

export function importProjectTasks(input: ImportProjectTasksInput) {
  return call<ImportProjectTasksInput, { projectId: string; columnId: string; taskIds: string[]; importedCount: number; createdCategories: string[] }>('importProjectTasks', input);
}

export type MoveTaskCardInput = {
  teamId: string;
  projectId: string;
  taskId: string;
  columnId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
  expectedVersion: number;
  operationId: string;
};

export function moveTaskCard(input: MoveTaskCardInput) {
  return call<MoveTaskCardInput, { taskId: string; projectId: string; columnId: string; version: number }>('moveTaskCard', input);
}

export function buildProjectsQuery(firestore: Firestore, teamId: string) {
  return query(collection(firestore, 'projects'), where('teamId', '==', teamId), where('archived', '==', false), orderBy('createdAt', 'asc'), limit(10));
}

export async function getProjects(firestore: Firestore, teamId: string) {
  const snapshot = await getDocs(buildProjectsQuery(firestore, teamId));
  return snapshot.docs.map((document) => parseKanbanProject(document.id, document.data() as Record<string, unknown>));
}

export function buildProjectColumnQuery(firestore: Firestore, teamId: string, projectId: string, columnId: string) {
  return query(
    collection(firestore, 'tasks'),
    where('teamId', '==', teamId),
    where('projectId', '==', projectId),
    where('columnId', '==', columnId),
    orderBy('orderKey', 'asc'),
    limit(KANBAN_COLUMN_PAGE_SIZE)
  );
}

export function subscribeProjectTasks(
  firestore: Firestore,
  teamId: string,
  project: KanbanProject,
  onChange: (tasks: TrackerTask[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const byColumn = new Map<string, TrackerTask[]>();
  const initialized = new Set<string>();
  const emit = () => onChange(project.columns.flatMap((column) => byColumn.get(column.id) ?? []));
  if (project.columns.length === 0) {
    emit();
    return () => undefined;
  }
  // One failing column must not hold the whole board on its loading spinner, so a
  // failed listener counts as initialized with no cards and the board renders the
  // columns that did load. N columns failing is still one problem, not N.
  let reportedError = false;
  const subscriptions = project.columns.map((column) => onSnapshot(
    buildProjectColumnQuery(firestore, teamId, project.id, column.id),
    (snapshot) => {
      byColumn.set(column.id, snapshot.docs.map((document) => parseKanbanTask(document.id, document.data() as Record<string, unknown>)));
      initialized.add(column.id);
      if (initialized.size === project.columns.length) emit();
    },
    (error) => {
      byColumn.set(column.id, []);
      initialized.add(column.id);
      if (initialized.size === project.columns.length) emit();
      if (reportedError) return;
      reportedError = true;
      onError(error);
    }
  ));
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}
