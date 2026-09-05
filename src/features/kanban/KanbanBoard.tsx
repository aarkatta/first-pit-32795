import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { BoardTable, type BoardDirectory, type BoardTaskPatch } from './BoardTable';
import { BoardToolbar, type BoardView } from './BoardToolbar';
import {
  BOARD_FIELDS,
  boardLabels,
  boardPeople,
  defaultBoardSort,
  emptyBoardFilters,
  groupBoardTasks,
  matchesBoardFilters,
  sortBoardTasks,
  type BoardFieldId,
  type BoardFilters,
  type BoardGroupBy,
  type BoardSort
} from '@/lib/board-view';
import type { KanbanProject, ProjectColumn, TeamRole, TrackerTask } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import {
  addProjectColumn,
  archiveProject,
  updateProject,
  createKanbanTask,
  createProject,
  ensureDefaultProject,
  getProjects,
  isVersionConflict,
  moveTaskCard,
  projectVersion,
  removeProjectColumn,
  reorderProjectColumns,
  subscribeProjectTasks,
  updateProjectColumn
} from '@/lib/kanban-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import {
  formatFileSize,
  getTeamFilesByIds,
  linkFileToTask,
  listTeamFiles,
  updateTask,
  type TeamFile
} from '@/lib/phase3-service';
import { dateTimeInputValue, formatDueDate, toDate } from '@/lib/dates';
import { createOperationId } from '@/lib/ids';

type KanbanBoardProps = {
  teamId: string;
  canManage: boolean;
  actorRole: TeamRole;
  actorUserId: string;
  online: boolean;
};

const operationId = createOperationId;

const EMPTY_DIRECTORY: BoardDirectory = new Map();

const NO_ATTACHMENTS: TeamFile[] = [];

type BoardNotice = RequestState & { retry: 'subscription' | 'projects'; actionLabel?: string };

function dueLabel(value: unknown) {
  return formatDueDate(toDate(value)) || 'No due date';
}

const inputDate = dateTimeInputValue;

// Exported for focused authorization-alignment tests alongside the board component.
// eslint-disable-next-line react-refresh/only-export-components
export function canMoveKanbanTask(task: Pick<TrackerTask, 'assignedTo'>, actorRole: TeamRole, actorUserId: string) {
  return actorRole === 'coach'
    || actorRole === 'teamLeader'
    || (actorRole === 'student' && task.assignedTo === actorUserId);
}

function SortableCard({ task, columns, directory, canManage, canMove, busy, onMove, onOpen }: {
  task: TrackerTask;
  columns: ProjectColumn[];
  directory: BoardDirectory;
  canManage: boolean;
  canMove: boolean;
  busy: boolean;
  onMove: (task: TrackerTask, columnId: string, index?: number) => void;
  onOpen: (task: TrackerTask) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId: task.columnId },
    disabled: busy || !canMove
  });
  const complete = task.checklist.filter((item) => item.completed).length;
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card priority-${task.priority}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      id={`task-${task.id}`}
    >
      <div className="kanban-card-topline">
        <span className={`priority-chip priority-${task.priority}`}>{task.priority}</span>
        <button className="drag-handle" type="button" aria-label={`Move ${task.title}`} disabled={busy || !canMove} {...attributes} {...listeners}>⠿</button>
      </div>
      <button className="kanban-card-title" type="button" onClick={() => onOpen(task)}>{task.title}</button>
      {task.labels.length ? <div className="kanban-labels">{task.labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}</div> : null}
      <div className="kanban-card-meta">
        <span title={nameOf(directory, task.assignedTo)}>{nameOf(directory, task.assignedTo)}</span>
        <small>{dueLabel(task.dueAt)}</small>
        {task.checklist.length ? <small>{complete}/{task.checklist.length} ✓</small> : null}
      </div>
      <label className="card-move-menu">
        <span className="visually-hidden">Move {task.title} to</span>
        <select disabled={busy || !canMove} value={task.columnId} onChange={(event) => onMove(task, event.target.value)}>
          {columns.map((column) => <option value={column.id} key={column.id}>{column.name}</option>)}
        </select>
      </label>
      {canManage ? <small className="card-edit-hint">Open to edit details</small> : null}
    </article>
  );
}

function KanbanColumnView({ projectColumn, tasks, allColumns, directory, canManage, canMoveTask, busy, onMove, onOpen, onCreate }: {
  projectColumn: ProjectColumn;
  tasks: TrackerTask[];
  allColumns: ProjectColumn[];
  directory: BoardDirectory;
  canManage: boolean;
  canMoveTask: (task: TrackerTask) => boolean;
  busy: boolean;
  onMove: (task: TrackerTask, columnId: string, index?: number) => void;
  onOpen: (task: TrackerTask) => void;
  onCreate: (columnId: string, title: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${projectColumn.id}`, data: { type: 'column', columnId: projectColumn.id } });
  const [title, setTitle] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(projectColumn.id, title.trim());
    setTitle('');
  }
  return (
    <section ref={setNodeRef} className={`kanban-column color-${projectColumn.color}${isOver ? ' is-over' : ''}`} aria-labelledby={`column-${projectColumn.id}`}>
      <header><div><i /><h3 id={`column-${projectColumn.id}`}>{projectColumn.name}</h3></div><span>{tasks.length}</span></header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-card-list">
          {tasks.map((task) => <SortableCard key={task.id} task={task} columns={allColumns} directory={directory} canManage={canManage} canMove={canMoveTask(task)} busy={busy} onMove={onMove} onOpen={onOpen} />)}
          {!tasks.length ? <p className="empty-column">Drop a card here</p> : null}
        </div>
      </SortableContext>
      {canManage ? <form className="kanban-quick-add" onSubmit={submit}><input aria-label={`New task in ${projectColumn.name}`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task" /><button aria-label={`Add task to ${projectColumn.name}`} disabled={busy} type="submit">＋</button></form> : null}
    </section>
  );
}

/** Card attachments and the team-file picker share one presentation. */
function AttachmentList({ files, status, onRetry }: { files: TeamFile[]; status: AttachmentsStatus; onRetry: () => void }) {
  if (status === 'loading') return <p className="mb-attachment-note" role="status">Loading attachments…</p>;
  if (status === 'error') {
    return (
      <p className="mb-attachment-note" role="alert">
        The attachments on this card could not be read. <button className="text-button" type="button" onClick={onRetry}>Retry</button>
      </p>
    );
  }
  if (!files.length) return <p className="mb-attachment-note">No files are attached to this card.</p>;
  return (
    <ul className="mb-attachment-list">
      {files.map((file) => (
        <li key={file.id}>
          {file.downloadUrl
            ? <a href={file.downloadUrl} target="_blank" rel="noreferrer">{file.name}</a>
            : <span>{file.name}</span>}
          <small>{formatFileSize(file.sizeBytes)}{file.downloadUrl ? '' : ' · download unavailable'}</small>
        </li>
      ))}
    </ul>
  );
}

export type AttachmentsStatus = 'loading' | 'ready' | 'error';

export function TaskDetails({
  task,
  canManage,
  busy,
  conflict = false,
  people = [],
  directory = EMPTY_DIRECTORY,
  attachments = NO_ATTACHMENTS,
  attachmentsStatus = 'ready',
  attachableFiles = NO_ATTACHMENTS,
  onReloadAttachments,
  onAttachFile,
  onConflictResolved,
  onClose,
  onSave
}: {
  task: TrackerTask;
  canManage: boolean;
  busy: boolean;
  conflict?: boolean;
  /** Assignable teammates. The picker replaces a raw-UID text box. */
  people?: string[];
  directory?: BoardDirectory;
  attachments?: TeamFile[];
  attachmentsStatus?: AttachmentsStatus;
  /** Team files not already on this card; empty when file sharing is off or unreadable. */
  attachableFiles?: TeamFile[];
  onReloadAttachments?: () => void;
  onAttachFile?: (fileId: string) => void;
  onConflictResolved?: () => void;
  onClose: () => void;
  onSave: (changes: { title: string; description: string; priority: TrackerTask['priority']; assignedTo: string | null; labels: string[]; dueAt: string | null }, expectedVersion: number) => void;
}) {
  const [fileToAttach, setFileToAttach] = useState('');
  const assignableOptions = useMemo(
    () => [...new Set([...people, ...(task.assignedTo ? [task.assignedTo] : [])])]
      .map((userId) => ({ userId, label: nameOf(directory, userId) }))
      .sort((first, second) => first.label.localeCompare(second.label)),
    [directory, people, task.assignedTo]
  );
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const taskForm = (value: TrackerTask) => ({
    title: value.title,
    description: value.description,
    priority: value.priority,
    assignedTo: value.assignedTo ?? '',
    labels: value.labels.join(', '),
    dueAt: inputDate(value.dueAt)
  });
  const [form, setForm] = useState(() => taskForm(task));
  const [baseVersion, setBaseVersion] = useState(Number(task.version ?? 1));
  const hasRemoteChange = Number(task.version ?? 1) !== baseVersion;
  useEffect(() => {
    const dialog = dialogRef.current;
    const focusToRestore = previousFocus.current;
    if (!dialog) return undefined;
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      focusToRestore?.focus();
    };
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      assignedTo: form.assignedTo.trim() || null,
      labels: [...new Set(form.labels.split(',').map((label) => label.trim()).filter(Boolean))].slice(0, 20),
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null
    }, baseVersion);
  }
  function reloadLatest() {
    setForm(taskForm(task));
    setBaseVersion(Number(task.version ?? 1));
    onConflictResolved?.();
  }
  return (
    <div className="kanban-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="kanban-modal" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" aria-describedby="task-dialog-description">
        <div className="modal-heading"><div><span className="eyebrow">TASK CARD</span><h2 id="task-dialog-title">{task.title}</h2></div><button type="button" onClick={onClose} aria-label="Close task details">×</button></div>
        <p className="visually-hidden" id="task-dialog-description">{canManage ? 'Review or edit this task, then save or cancel.' : 'Review this task. Close the dialog to return to the board.'}</p>
        {canManage ? <form className="kanban-details-form" onSubmit={submit}>
          {conflict || hasRemoteChange ? <div role="alert"><p>This task changed while you were editing it. Your draft is preserved until you choose to load the latest saved task.</p><button type="button" onClick={reloadLatest} disabled={!hasRemoteChange}>{hasRemoteChange ? 'Load latest task' : 'Waiting for latest task…'}</button></div> : null}
          <label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Description<textarea maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="details-grid">
            <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TrackerTask['priority'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label>Due date<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label>
            <label>Assignee<select value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}>
              <option value="">Unassigned</option>
              {assignableOptions.map((person) => <option key={person.userId} value={person.userId}>{person.label}</option>)}
            </select></label>
            <label>Labels<input value={form.labels} onChange={(event) => setForm({ ...form, labels: event.target.value })} placeholder="robot, outreach" /></label>
          </div>
          <div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={busy || !form.title.trim() || conflict || hasRemoteChange} type="submit">{busy ? 'Saving…' : 'Save task'}</button></div>
        </form> : <div className="task-readonly-details"><p>{task.description || 'No description.'}</p><dl><div><dt>Priority</dt><dd>{task.priority}</dd></div><div><dt>Assignee</dt><dd>{nameOf(directory, task.assignedTo)}</dd></div><div><dt>Due</dt><dd>{dueLabel(task.dueAt)}</dd></div></dl></div>}
        <section className="task-attachments" aria-labelledby="task-attachments-heading">
          <h3 id="task-attachments-heading">Attachments</h3>
          <AttachmentList files={attachments} status={attachmentsStatus} onRetry={() => onReloadAttachments?.()} />
          {canManage && onAttachFile && attachableFiles.length ? (
            <form className="inline-create" onSubmit={(event) => { event.preventDefault(); if (!fileToAttach) return; onAttachFile(fileToAttach); setFileToAttach(''); }}>
              <label>Attach a team file
                <select value={fileToAttach} disabled={busy} onChange={(event) => setFileToAttach(event.target.value)}>
                  <option value="">Choose a file…</option>
                  {attachableFiles.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                </select>
              </label>
              <button className="button secondary" type="submit" disabled={busy || !fileToAttach}>Attach</button>
            </form>
          ) : null}
        </section>
      </section>
    </div>
  );
}

function ProjectSettings({ teamId, project, busy, onRun }: {
  teamId: string;
  project: KanbanProject;
  busy: boolean;
  onRun: (action: () => Promise<unknown>, refreshProjects?: boolean) => Promise<boolean>;
}) {
  const [columnName, setColumnName] = useState('');
  function renameProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('projectName') ?? '').trim();
    if (!name) return;
    void onRun(() => updateProject({ teamId, projectId: project.id, name, description: String(form.get('projectDescription') ?? '').trim() }), true);
  }
  function addColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!columnName.trim()) return;
    void onRun(() => addProjectColumn({ teamId, projectId: project.id, operationId: operationId(), name: columnName.trim(), expectedVersion: projectVersion(project) }), true).then((saved) => { if (saved) setColumnName(''); });
  }
  function shift(columnId: string, amount: number) {
    const ids = project.columns.map((column) => column.id);
    const index = ids.indexOf(columnId);
    const next = index + amount;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void onRun(() => reorderProjectColumns(teamId, project.id, ids, projectVersion(project)), true);
  }
  return (
    <details className="project-settings">
      <summary>Configure workflow</summary>
      <div className="column-settings-list">
        {project.columns.map((column, index) => <form key={column.id} onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onRun(() => updateProjectColumn({ teamId, projectId: project.id, columnId: column.id, expectedVersion: projectVersion(project), name: String(form.get('name') ?? '').trim(), color: String(form.get('color') ?? 'slate') as ProjectColumn['color'], isCompleted: form.get('completed') === 'on' }), true);
        }}>
          <input name="name" aria-label={`Name for ${column.name}`} defaultValue={column.name} maxLength={40} required />
          <select name="color" aria-label={`Color for ${column.name}`} defaultValue={column.color}><option value="blue">Blue</option><option value="purple">Purple</option><option value="orange">Orange</option><option value="green">Green</option><option value="slate">Slate</option><option value="pink">Pink</option></select>
          <label className="completed-choice"><input name="completed" type="checkbox" defaultChecked={project.completedColumnId === column.id} disabled={project.completedColumnId === column.id} /> Done</label>
          <button type="button" aria-label={`Move ${column.name} left`} disabled={busy || index === 0} onClick={() => shift(column.id, -1)}>←</button>
          <button type="button" aria-label={`Move ${column.name} right`} disabled={busy || index === project.columns.length - 1} onClick={() => shift(column.id, 1)}>→</button>
          <button type="submit" disabled={busy}>Save</button>
          <button className="danger-text" type="button" disabled={busy || project.completedColumnId === column.id || project.columns.length <= 2} onClick={() => void onRun(() => removeProjectColumn(teamId, project.id, column.id, projectVersion(project)), true)}>Remove</button>
        </form>)}
      </div>
      <form className="rename-project-form" onSubmit={renameProject}>
        <label>Project name<input name="projectName" defaultValue={project.name} maxLength={80} required /></label>
        <label>Description<input name="projectDescription" defaultValue={project.description ?? ''} maxLength={1000} /></label>
        <button className="button secondary" type="submit" disabled={busy}>Save project</button>
      </form>
      <form className="add-column-form" onSubmit={addColumn}><label>New column<input value={columnName} onChange={(event) => setColumnName(event.target.value)} maxLength={40} placeholder="Testing" /></label><button className="button secondary" disabled={busy || project.columns.length >= 8} type="submit">Add column</button></form>
    </details>
  );
}

export function KanbanBoard({ teamId, canManage, actorRole, actorUserId, online }: KanbanBoardProps) {
  const firestore = getFirebaseServices().firestore;
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<KanbanProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') ?? '');
  const [tasks, setTasks] = useState<TrackerTask[]>([]);
  const confirmedTasks = useRef<TrackerTask[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TrackerTask | null>(null);
  const [taskConflict, setTaskConflict] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(emptyBoardFilters);
  const [view, setView] = useState<BoardView>('table');
  const [groupBy, setGroupBy] = useState<BoardGroupBy>('column');
  const [sort, setSort] = useState<BoardSort>(defaultBoardSort);
  const [hiddenFields, setHiddenFields] = useState<BoardFieldId[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  // A column edit refreshes the project list without unmounting the board, so the
  // reader keeps their scroll position and collapsed groups.
  const [refreshing, setRefreshing] = useState(false);
  const [migration, setMigration] = useState<string | null>(null);
  // A non-fatal problem beside the board — one failing column, or an unfinished
  // migration — instead of a full-page error that unmounts everything.
  const [boardNotice, setBoardNotice] = useState<BoardNotice | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);
  const [attachments, setAttachments] = useState<TeamFile[]>([]);
  const [attachmentsStatus, setAttachmentsStatus] = useState<AttachmentsStatus>('ready');
  const [attachmentsAttempt, setAttachmentsAttempt] = useState(0);
  const [teamFiles, setTeamFiles] = useState<TeamFile[]>([]);
  // A single clock keeps every overdue/today badge in a render consistent, and the
  // minute tick keeps them honest during a long working session.
  const [now, setNow] = useState(() => new Date());
  const [projectName, setProjectName] = useState('');
  const activeTeamRef = useRef(teamId);
  // Read through a ref: a network flap must not re-identify the loaders and reset
  // the board the reader is looking at.
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const projectsRequest = useRef(0);
  const migrationAbort = useRef<AbortController | null>(null);
  const activeBoardKeyRef = useRef('');
  const requestedProjectIdRef = useRef(searchParams.get('project') ?? '');
  activeTeamRef.current = teamId;
  requestedProjectIdRef.current = searchParams.get('project') ?? '';
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const openTaskId = selectedTask?.id ?? '';
  const attachmentKey = (selectedTask?.attachmentFileIds ?? []).join(',');
  activeBoardKeyRef.current = `${teamId}:${selectedProject?.id ?? ''}`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refreshProjects = useCallback(async (mode: 'initial' | 'background' = 'initial') => {
    if (activeTeamRef.current !== teamId) return;
    const requestId = ++projectsRequest.current;
    const controller = new AbortController();
    migrationAbort.current?.abort();
    migrationAbort.current = controller;
    if (mode === 'initial') setStatus('loading');
    else setRefreshing(true);
    setError(null);
    try {
      const migrated = await ensureDefaultProject(teamId, {
        signal: controller.signal,
        onProgress: ({ migratedTaskCount }) => {
          if (activeTeamRef.current === teamId && requestId === projectsRequest.current) setMigration(`Moving ${migratedTaskCount} existing task${migratedTaskCount === 1 ? '' : 's'} onto the board…`);
        }
      });
      if (activeTeamRef.current !== teamId || requestId !== projectsRequest.current) return;
      setMigration(null);
      const nextProjects = await getProjects(firestore, teamId);
      if (activeTeamRef.current !== teamId || requestId !== projectsRequest.current) return;
      setProjects(nextProjects);
      setSelectedProjectId((current) => nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? '');
      setStatus('ready');
      setBoardNotice((current) => (migrated.complete || controller.signal.aborted
        ? (current?.retry === 'projects' ? null : current)
        : {
          variant: 'error',
          title: 'Some older tasks are still being moved',
          message: 'This board reached the migration page limit. Retry to continue moving the remaining tracker tasks onto the board.',
          retry: 'projects'
        }));
    } catch (nextError) {
      if (activeTeamRef.current !== teamId || requestId !== projectsRequest.current) return;
      setMigration(null);
      if (mode === 'background') {
        setBoardNotice({ ...getRequestState(nextError, onlineRef.current), retry: 'projects' });
        return;
      }
      setError(nextError instanceof Error ? nextError : new Error('Project boards could not load.'));
      setStatus('error');
    } finally {
      if (activeTeamRef.current === teamId && requestId === projectsRequest.current) setRefreshing(false);
    }
  }, [firestore, teamId]);

  useEffect(() => {
    projectsRequest.current += 1;
    setProjects([]);
    setSelectedProjectId(requestedProjectIdRef.current);
    setTasks([]);
    confirmedTasks.current = [];
    setSelectedTask(null);
    setTaskConflict(false);
    setActiveTaskId(null);
    setFilters(emptyBoardFilters);
    setProjectName('');
    setBusy(false);
    setRequestState(null);
    setBoardNotice(null);
    setMigration(null);
    setTeamFiles([]);
    setAttachments([]);
    void refreshProjects();
  }, [refreshProjects, teamId]);
  useEffect(() => () => migrationAbort.current?.abort(), []);
  useEffect(() => {
    if (!selectedProject) return;
    let active = true;
    setTasks([]);
    confirmedTasks.current = [];
    setBoardNotice((current) => (current?.retry === 'subscription' ? null : current));
    const unsubscribe = subscribeProjectTasks(firestore, teamId, selectedProject, (nextTasks) => {
      if (!active) return;
      confirmedTasks.current = nextTasks;
      setTasks(nextTasks);
    }, (nextError) => {
      // One column can fail while the rest load. The board keeps the cards it has and
      // says which part is missing instead of replacing everything with an error page.
      if (!active) return;
      setBoardNotice({ ...getRequestState(nextError, onlineRef.current), title: 'Part of this board could not load', retry: 'subscription' });
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // `subscriptionAttempt` is the retry handle for the notice above: bumping it
    // tears down and rebuilds the per-column listeners.
  }, [firestore, selectedProject, subscriptionAttempt, teamId]);
  useEffect(() => {
    setSelectedTask(null);
    setTaskConflict(false);
    setActiveTaskId(null);
    setFilters(emptyBoardFilters);
    setSelectedIds(new Set());
    setFocusGroupId(null);
  }, [selectedProject?.id, teamId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // `users/{uid}` is private, so the roster with display names comes from the
    // `listTeamMembers` callable rather than from a client-side join.
    let active = true;
    setMembers([]);
    void listTeamMembers(teamId)
      .then((roster) => { if (active) setMembers(roster.members.filter((member) => member.status === 'active')); })
      .catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [teamId]);
  useEffect(() => {
    if (!selectedTask) return;
    const latest = tasks.find((task) => task.id === selectedTask.id);
    if (latest && latest !== selectedTask) setSelectedTask(latest);
  }, [selectedTask, tasks]);
  useEffect(() => {
    // Attachment ids on a card mean nothing until they resolve to a name and a
    // download link, so the open dialog reads each referenced file document.
    if (!attachmentKey) {
      setAttachments([]);
      setAttachmentsStatus('ready');
      return undefined;
    }
    let active = true;
    setAttachmentsStatus('loading');
    void getTeamFilesByIds(firestore, teamId, attachmentKey.split(','))
      .then((files) => { if (!active) return; setAttachments(files); setAttachmentsStatus('ready'); })
      .catch(() => { if (!active) return; setAttachments([]); setAttachmentsStatus('error'); });
    return () => { active = false; };
  }, [attachmentKey, attachmentsAttempt, firestore, teamId]);
  useEffect(() => {
    // The attach picker only appears when the team can actually list files; a team
    // with file sharing off is denied here and simply gets no picker.
    if (!openTaskId || !canManage) return undefined;
    let active = true;
    void listTeamFiles(firestore, teamId)
      .then((page) => { if (active) setTeamFiles(page.files); })
      .catch(() => { if (active) setTeamFiles([]); });
    return () => { active = false; };
  }, [canManage, firestore, openTaskId, teamId]);
  useEffect(() => {
    if (!selectedProject) return;
    const next = new URLSearchParams(searchParams);
    next.set('project', selectedProject.id);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, selectedProject, setSearchParams]);
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (!taskId) return;
    const task = tasks.find((entry) => entry.id === taskId);
    if (task) {
      setSelectedTask(task);
      document.getElementById(`task-${task.id}`)?.scrollIntoView({ block: 'center', inline: 'center' });
    }
  }, [searchParams, tasks]);

  async function run(action: () => Promise<unknown>, shouldRefreshProjects = false) {
    const actionTeamId = teamId;
    if (activeTeamRef.current !== actionTeamId) return false;
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      if (activeTeamRef.current !== actionTeamId) return false;
      if (shouldRefreshProjects) await refreshProjects('background');
      return true;
    } catch (nextError) {
      if (activeTeamRef.current !== actionTeamId) return false;
      // Every workflow mutation rewrites the whole column array against a version.
      // A losing race is two coaches editing one board, not a broken request.
      if (shouldRefreshProjects && isVersionConflict(nextError)) {
        setBoardNotice({
          variant: 'error',
          title: 'Another coach changed this board',
          message: 'The workflow columns changed while you were editing them. Refresh the board, then make the change again.',
          actionLabel: 'Refresh board',
          retry: 'projects'
        });
        return false;
      }
      setRequestState(getRequestState(nextError, online));
      return false;
    } finally {
      if (activeTeamRef.current === actionTeamId) setBusy(false);
    }
  }

  const filteredTasks = useMemo(() => tasks.filter((task) => matchesBoardFilters(task, filters, now)), [filters, now, tasks]);
  const sortedTasks = useMemo(() => sortBoardTasks(filteredTasks, sort), [filteredTasks, sort]);
  const groups = useMemo(() => groupBoardTasks(sortedTasks, groupBy, selectedProject, now), [groupBy, now, selectedProject, sortedTasks]);
  const visibleFields = useMemo(() => BOARD_FIELDS.map((field) => field.id).filter((field) => !hiddenFields.includes(field)), [hiddenFields]);
  const tasksByColumn = useMemo(() => new Map((selectedProject?.columns ?? []).map((column) => [column.id, sortedTasks.filter((task) => task.columnId === column.id)])), [selectedProject, sortedTasks]);
  const assignees = useMemo(() => boardPeople(tasks), [tasks]);
  const labels = useMemo(() => boardLabels(tasks), [tasks]);
  const directory = useMemo(() => memberMap(members), [members]);
  const roster = useMemo(() => members.map((member) => member.userId), [members]);
  const people = useMemo(() => [...new Set([...roster, ...assignees])].sort(), [assignees, roster]);
  const attachableFiles = useMemo(
    () => teamFiles.filter((file) => !(selectedTask?.attachmentFileIds ?? []).includes(file.id)),
    [selectedTask, teamFiles]
  );
  const selectedTasks = useMemo(() => tasks.filter((task) => selectedIds.has(task.id)), [selectedIds, tasks]);
  const canMoveTask = useCallback((task: TrackerTask) => canMoveKanbanTask(task, actorRole, actorUserId), [actorRole, actorUserId]);

  function targetPlacement(task: TrackerTask, columnId: string, index?: number) {
    const target = tasks.filter((entry) => entry.columnId === columnId && entry.id !== task.id).sort((a, b) => Number(a.orderKey) - Number(b.orderKey));
    const insertion = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
    return { beforeTaskId: target[insertion - 1]?.id ?? null, afterTaskId: target[insertion]?.id ?? null, insertion };
  }

  function move(task: TrackerTask, columnId: string, index?: number) {
    if (!selectedProject || !canMoveTask(task) || busy || !online) return;
    const placement = targetPlacement(task, columnId, index);
    const boardKey = activeBoardKeyRef.current;
    const rollbackTasks = confirmedTasks.current;
    const target = tasks.filter((entry) => entry.columnId === columnId && entry.id !== task.id).sort((a, b) => Number(a.orderKey) - Number(b.orderKey));
    const optimistic = [...target];
    const beforeOrder = Number(target[placement.insertion - 1]?.orderKey);
    const afterOrder = Number(target[placement.insertion]?.orderKey);
    const optimisticOrder = placement.insertion > 0 && placement.insertion < target.length
      ? beforeOrder + (afterOrder - beforeOrder) / 2
      : placement.insertion > 0
        ? beforeOrder + 1024
        : target.length
          ? afterOrder - 1024
          : 1024;
    optimistic.splice(placement.insertion, 0, { ...task, columnId, orderKey: optimisticOrder, version: Number(task.version ?? 1) + 1 });
    const other = tasks.filter((entry) => entry.columnId !== columnId && entry.id !== task.id);
    setTasks([...other, ...optimistic]);
    void run(() => moveTaskCard({
      teamId,
      projectId: selectedProject.id,
      taskId: task.id,
      columnId,
      beforeTaskId: placement.beforeTaskId,
      afterTaskId: placement.afterTaskId,
      expectedVersion: Number(task.version ?? 1),
      operationId: operationId()
    })).then((saved) => { if (!saved && activeBoardKeyRef.current === boardKey) setTasks(rollbackTasks); });
  }

  function patch(task: TrackerTask, changes: BoardTaskPatch) {
    if (!canManage || busy || !online) return;
    void run(() => updateTask({
      teamId,
      taskId: task.id,
      operationId: operationId(),
      expectedVersion: Number(task.version ?? 1),
      ...changes
    }));
  }

  function selectTask(taskId: string, next: boolean) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (next) updated.add(taskId);
      else updated.delete(taskId);
      return updated;
    });
  }

  function selectGroup(taskIds: string[], next: boolean) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      for (const taskId of taskIds) {
        if (next) updated.add(taskId);
        else updated.delete(taskId);
      }
      return updated;
    });
  }

  /** Bulk status change walks the selection one card at a time so each move keeps its own version check. */
  async function moveSelection(columnId: string) {
    if (!selectedProject || !columnId) return;
    const movable = selectedTasks.filter((task) => canMoveTask(task) && task.columnId !== columnId);
    if (!movable.length) return;
    const moved = await run(async () => {
      for (const task of movable) {
        await moveTaskCard({
          teamId,
          projectId: selectedProject.id,
          taskId: task.id,
          columnId,
          beforeTaskId: null,
          afterTaskId: null,
          expectedVersion: Number(task.version ?? 1),
          operationId: operationId()
        });
      }
    });
    if (moved) setSelectedIds(new Set());
  }

  function dragStart(event: DragStartEvent) {
    const task = tasks.find((entry) => entry.id === String(event.active.id));
    setActiveTaskId(task && canMoveTask(task) ? task.id : null);
  }

  function dragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const active = tasks.find((task) => task.id === String(event.active.id));
    if (!active || !event.over) return;
    const overId = String(event.over.id);
    const overTask = tasks.find((task) => task.id === overId);
    const columnId = overTask?.columnId ?? (overId.startsWith('column:') ? overId.slice('column:'.length) : String(event.over.data.current?.columnId ?? ''));
    if (!columnId) return;
    const target = tasks.filter((task) => task.columnId === columnId && task.id !== active.id).sort((a, b) => Number(a.orderKey) - Number(b.orderKey));
    const index = overTask ? Math.max(0, target.findIndex((task) => task.id === overTask.id)) : target.length;
    const currentColumn = tasks.filter((task) => task.columnId === active.columnId).sort((a, b) => Number(a.orderKey) - Number(b.orderKey));
    if (columnId === active.columnId && currentColumn.findIndex((task) => task.id === active.id) === index) return;
    move(active, columnId, index);
  }

  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim()) return;
    void run(async () => {
      const result = await createProject({ teamId, operationId: operationId(), name: projectName.trim() });
      setProjectName('');
      await refreshProjects('background');
      setSelectedProjectId(result.projectId);
    });
  }

  if (status === 'loading') return <StatePanel variant="loading" title="Loading project boards" message={migration ?? 'Preparing private team projects and bounded Kanban columns.'} />;
  if (status === 'error') return <StatePanel variant="error" title="Project boards could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refreshProjects()} autoFocus />;
  if (!selectedProject) return <StatePanel variant="empty" title="No project board" message="A coach can create the first private team project." />;

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) ?? null : null;
  return (
    <section className="kanban-shell" aria-labelledby="kanban-heading">
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      {boardNotice ? <StatePanel
        variant={boardNotice.variant}
        title={boardNotice.title}
        message={boardNotice.message}
        actionLabel={boardNotice.actionLabel ?? 'Retry'}
        onAction={() => {
          setBoardNotice(null);
          if (boardNotice.retry === 'projects') void refreshProjects('background');
          else setSubscriptionAttempt((attempt) => attempt + 1);
        }}
      /> : null}
      <div className="mb-board-head">
        <div className="mb-board-identity">
          <h2 id="kanban-heading">
            {selectedProject.name}
            <label className="mb-project-switch">
              <span className="visually-hidden">Switch project board</span>
              <select value={selectedProject.id} onChange={(event) => setSelectedProjectId(event.target.value)}>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
              <span aria-hidden="true">▾</span>
            </label>
          </h2>
          <p>{selectedProject.description || 'Move work from idea to completion.'}</p>
        </div>
        <div className="mb-board-stats">
          <span><strong>{tasks.length}</strong> item{tasks.length === 1 ? '' : 's'}</span>
          {filteredTasks.length !== tasks.length ? <span className="mb-board-stats__filtered">{filteredTasks.length} shown</span> : null}
          {refreshing ? <span className="mb-board-stats__busy" role="status">{migration ?? 'Updating the board…'}</span> : null}
        </div>
      </div>

      <BoardToolbar
        view={view}
        onViewChange={setView}
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        hiddenFields={hiddenFields}
        onHiddenFieldsChange={setHiddenFields}
        people={people}
        directory={directory}
        labels={labels}
        canManage={canManage}
        disabled={busy || !online}
        onNewItem={() => {
          setGroupBy('column');
          setView('table');
          setFocusGroupId(selectedProject.columns[0]?.id ?? null);
        }}
      />

      {!online ? <p className="kanban-offline" role="status">Reconnect before moving or editing cards. The current board remains available to review.</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={dragStart} onDragCancel={() => setActiveTaskId(null)} onDragEnd={dragEnd}>
        {view === 'table' ? (
          <BoardTable
            groups={groups}
            fields={visibleFields}
            groupBy={groupBy}
            project={selectedProject}
            people={people}
            directory={directory}
            now={now}
            canManage={canManage}
            canMoveTask={canMoveTask}
            disabled={busy || !online}
            selectedIds={selectedIds}
            focusGroupId={focusGroupId}
            onSelect={selectTask}
            onSelectGroup={selectGroup}
            onOpen={(task) => { setTaskConflict(false); setSelectedTask(task); }}
            onMove={(task, columnId) => move(task, columnId)}
            onPatch={patch}
            onCreate={(columnId, title) => {
              setFocusGroupId(null);
              void run(() => createKanbanTask({ teamId, projectId: selectedProject.id, columnId, operationId: operationId(), title }));
            }}
          />
        ) : (
          <div className="kanban-board" aria-label={`${selectedProject.name} Kanban board`}>
            {selectedProject.columns.map((column) => <KanbanColumnView
              key={column.id}
              projectColumn={column}
              tasks={tasksByColumn.get(column.id) ?? []}
              allColumns={selectedProject.columns}
              directory={directory}
              canManage={canManage}
              canMoveTask={canMoveTask}
              busy={busy || !online}
              onMove={move}
              onOpen={(task) => { setTaskConflict(false); setSelectedTask(task); }}
              onCreate={(columnId, title) => void run(() => createKanbanTask({ teamId, projectId: selectedProject.id, columnId, operationId: operationId(), title }))}
            />)}
          </div>
        )}
        <DragOverlay>{activeTask ? <article className="kanban-card drag-overlay"><strong>{activeTask.title}</strong></article> : null}</DragOverlay>
      </DndContext>

      {selectedIds.size ? (
        <div className="mb-batch-bar" role="region" aria-label="Selected items">
          <strong>{selectedIds.size}</strong>
          <span>item{selectedIds.size === 1 ? '' : 's'} selected</span>
          <label>
            <span className="visually-hidden">Move selected items to</span>
            <select value="" disabled={busy || !online} onChange={(event) => void moveSelection(event.target.value)}>
              <option value="">Move to…</option>
              {selectedProject.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
          </label>
          <button className="text-button" type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      ) : null}

      {canManage ? <div className="project-admin-panel">
        <form className="new-project-form" onSubmit={submitProject}><label>New project<input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={80} placeholder="Innovation project" /></label><button className="button" type="submit" disabled={busy || projects.length >= 10}>Create project</button></form>
        <ProjectSettings teamId={teamId} project={selectedProject} busy={busy} onRun={run} />
        {projects.length > 1 ? <button className="danger-text archive-project" type="button" disabled={busy} onClick={() => void run(() => archiveProject(teamId, selectedProject.id), true)}>Archive this project</button> : null}
      </div> : <p className="board-permission-note">{actorRole === 'student' ? 'Students can move only cards assigned to them. Project setup and card details remain coach-managed.' : 'Your role has view-only access to project boards.'}</p>}

      {selectedTask ? <TaskDetails
        task={selectedTask}
        canManage={canManage}
        busy={busy}
        conflict={taskConflict}
        people={people}
        directory={directory}
        attachments={attachments}
        attachmentsStatus={attachmentsStatus}
        attachableFiles={attachableFiles}
        onReloadAttachments={() => setAttachmentsAttempt((attempt) => attempt + 1)}
        onAttachFile={(fileId) => void run(() => linkFileToTask(teamId, fileId, selectedTask.id)).then((linked) => { if (linked) setAttachmentsAttempt((attempt) => attempt + 1); })}
        onConflictResolved={() => setTaskConflict(false)}
        onClose={() => { setSelectedTask(null); setTaskConflict(false); }}
        onSave={(changes, expectedVersion) => void run(() => updateTask({ teamId, taskId: selectedTask.id, operationId: operationId(), expectedVersion, ...changes }).catch((nextError) => {
          const code = String((nextError as { code?: unknown }).code ?? '');
          if ((code === 'aborted' || code === 'functions/aborted') && activeTeamRef.current === teamId) setTaskConflict(true);
          throw nextError;
        })).then((saved) => { if (saved) { setSelectedTask(null); setTaskConflict(false); } })}
      /> : null}
    </section>
  );
}
