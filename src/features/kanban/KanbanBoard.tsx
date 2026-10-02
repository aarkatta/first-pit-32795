import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { BoardTable, type BoardDirectory, type BoardTaskPatch } from './BoardTable';
import { BoardToolbar } from './BoardToolbar';
import {
  BOARD_FIELDS,
  boardLabels,
  boardPeople,
  defaultBoardSort,
  emptyBoardFilters,
  groupBoardTasks,
  groupByMilestone,
  matchesBoardFilters,
  sortBoardTasks,
  SUBTASK_STATUS_META,
  SUBTASK_STATUS_OPTIONS,
  type BoardFieldId,
  type BoardFilters,
  type BoardGroupBy,
  type BoardSort
} from '@/lib/board-view';
import type { KanbanProject, ProjectCategory, SubtaskStatus, TeamGoal, TeamRole, TrackerTask } from '@/lib/domain';
import { canBeAssignedTasks, MAX_SUBTASKS_PER_TASK } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import {
  createKanbanTask,
  ensureDefaultProject,
  getProjects,
  isVersionConflict,
  moveTaskCard,
  subscribeProjectTasks
} from '@/lib/kanban-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import {
  MAX_TASK_ATTACHMENTS,
  UploadAbortedError,
  formatFileSize,
  getTeamFilesByIds,
  linkFileToTask,
  listActiveTeamGoals,
  listTeamFiles,
  updateTask,
  uploadTeamFile,
  type SubtaskInput,
  type TeamFile
} from '@/lib/phase3-service';
import { loadFileSharing, type FileSharing } from '@/lib/coordination-data';
import { ATTACHMENT_ACCEPT, attachmentProblem } from '@/lib/task-attachments';
import { dateTimeInputValue, formatDueDate, toDate } from '@/lib/dates';
import { createOperationId } from '@/lib/ids';

type KanbanBoardProps = {
  teamId: string;
  /** Board setup, import and file attachments: coaches and team leaders. */
  canManage: boolean;
  /** Adding, editing and moving any task: coaches, team leaders and students. */
  canEditTasks: boolean;
  actorRole: TeamRole;
  actorUserId: string;
  online: boolean;
};

const operationId = createOperationId;

const EMPTY_DIRECTORY: BoardDirectory = new Map();

const NO_ATTACHMENTS: TeamFile[] = [];
const NO_CATEGORIES: ProjectCategory[] = [];
const NO_GOALS: TeamGoal[] = [];



type BoardNotice = RequestState & { retry: 'subscription' | 'projects'; actionLabel?: string };

function dueLabel(value: unknown) {
  return formatDueDate(toDate(value)) || 'No due date';
}

const inputDate = dateTimeInputValue;

// Exported for focused authorization-alignment tests alongside the board component.
// eslint-disable-next-line react-refresh/only-export-components
export function canMoveKanbanTask(actorRole: TeamRole) {
  return actorRole === 'coach' || actorRole === 'teamLeader' || actorRole === 'student';
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
  canEdit = canManage,
  busy,
  conflict = false,
  categories = NO_CATEGORIES,
  goals = NO_GOALS,
  actorUserId = '',
  onSubtaskStatus,
  people = [],
  directory = EMPTY_DIRECTORY,
  attachments = NO_ATTACHMENTS,
  attachmentsStatus = 'ready',
  attachableFiles = NO_ATTACHMENTS,
  onReloadAttachments,
  onAttachFile,
  fileSharing = 'unknown',
  onUploadFile,
  uploadProgress = null,
  uploadError = null,
  onConflictResolved,
  onClose,
  onSave
}: {
  task: TrackerTask;
  /** Coach/team-leader actions on the card, such as attaching team files. */
  canManage: boolean;
  /** Editing the card's details and subtasks; students have this too. Defaults to `canManage`. */
  canEdit?: boolean;
  busy: boolean;
  conflict?: boolean;
  /** Board categories, in board order, for the category picker. */
  categories?: ProjectCategory[];
  /** Active team goals a card can be linked to; linking is what feeds their counters. */
  goals?: TeamGoal[];
  /** Who is looking: decides which sub-items they may tick off. */
  actorUserId?: string;
  /** Status-only subtask change, the one subtask edit a student may make. */
  onSubtaskStatus?: (subtaskId: string, status: SubtaskStatus) => void;
  /** Assignable teammates. The picker replaces a raw-UID text box. */
  people?: string[];
  directory?: BoardDirectory;
  attachments?: TeamFile[];
  attachmentsStatus?: AttachmentsStatus;
  /** Team files not already on this card; empty when file sharing is off or unreadable. */
  attachableFiles?: TeamFile[];
  onReloadAttachments?: () => void;
  onAttachFile?: (fileId: string) => void;
  /** The team's file-sharing policy; 'unknown' until it has been read. */
  fileSharing?: FileSharing | 'unknown';
  /** Uploads a new file and attaches it to this card (coaches and team leaders). */
  onUploadFile?: (file: File) => void;
  /** 0–1 while an upload is running, otherwise null. */
  uploadProgress?: number | null;
  uploadError?: string | null;
  onConflictResolved?: () => void;
  onClose: () => void;
  onSave: (changes: { title: string; description: string; priority: TrackerTask['priority']; assignedTo: string | null; labels: string[]; dueAt: string | null; startAt: string | null; endAt: string | null; categoryId: string | null; goalId: string | null; subtasks: SubtaskInput[] }, expectedVersion: number) => void;
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
    categoryId: value.categoryId ?? '',
    goalId: value.goalId ?? '',
    labels: value.labels.join(', '),
    dueAt: inputDate(value.dueAt),
    startAt: inputDate(value.startAt),
    endAt: inputDate(value.endAt),
    subtasks: value.subtasks.map((subtask) => ({ ...subtask, dueAt: inputDate(subtask.dueAt) }))
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
      categoryId: form.categoryId || null,
      goalId: form.goalId || null,
      subtasks: form.subtasks
        .filter((subtask) => subtask.title.trim())
        .map((subtask) => ({ ...subtask, title: subtask.title.trim(), dueAt: subtask.dueAt ? new Date(subtask.dueAt).toISOString() : null })),
      labels: [...new Set(form.labels.split(',').map((label) => label.trim()).filter(Boolean))].slice(0, 20),
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
      endAt: form.endAt ? new Date(form.endAt).toISOString() : null
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
        <p className="visually-hidden" id="task-dialog-description">{canEdit ? 'Review or edit this task, then save or cancel.' : 'Review this task. Close the dialog to return to the board.'}</p>
        {canEdit ? <form className="kanban-details-form" onSubmit={submit}>
          {conflict || hasRemoteChange ? <div role="alert"><p>This task changed while you were editing it. Your draft is preserved until you choose to load the latest saved task.</p><button type="button" onClick={reloadLatest} disabled={!hasRemoteChange}>{hasRemoteChange ? 'Load latest task' : 'Waiting for latest task…'}</button></div> : null}
          <label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Description<textarea maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="details-grid">
            <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TrackerTask['priority'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label>Start date<input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
            <label>End date<input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label>
            <label>Due date<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label>
            <label>Assignee<select value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}>
              <option value="">Unassigned</option>
              {assignableOptions.map((person) => <option key={person.userId} value={person.userId}>{person.label}</option>)}
            </select></label>
            <label>Category<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">No category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label>Milestone<select value={form.goalId} onChange={(event) => setForm({ ...form, goalId: event.target.value })}>
              <option value="">No milestone</option>
              {/* A milestone the card already belongs to stays selectable even
                  once it is achieved, so saving an edit cannot silently unlink it. */}
              {[...goals, ...(task.goalId && !goals.some((goal) => goal.id === task.goalId) ? [{ id: task.goalId, title: 'Linked milestone' } as TeamGoal] : [])]
                .map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select></label>
            <label>Labels<input value={form.labels} onChange={(event) => setForm({ ...form, labels: event.target.value })} placeholder="robot, outreach" /></label>
          </div>
          <div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={busy || !form.title.trim() || conflict || hasRemoteChange} type="submit">{busy ? 'Saving…' : 'Save task'}</button></div>
        </form> : <div className="task-readonly-details"><p>{task.description || 'No description.'}</p><dl><div><dt>Priority</dt><dd>{task.priority}</dd></div><div><dt>Category</dt><dd>{categories.find((category) => category.id === task.categoryId)?.name ?? 'No category'}</dd></div><div><dt>Milestone</dt><dd>{goals.find((goal) => goal.id === task.goalId)?.title ?? (task.goalId ? 'Linked milestone' : 'No milestone')}</dd></div><div><dt>Assignee</dt><dd>{nameOf(directory, task.assignedTo)}</dd></div><div><dt>Start</dt><dd>{dueLabel(task.startAt)}</dd></div><div><dt>End</dt><dd>{dueLabel(task.endAt)}</dd></div><div><dt>Due</dt><dd>{dueLabel(task.dueAt)}</dd></div></dl></div>}
        <section className="task-subtasks" aria-labelledby="task-subtasks-heading">
          <h3 id="task-subtasks-heading">Subtasks{task.subtasks.length ? ` · ${task.subtasks.filter((subtask) => subtask.status === 'done').length}/${task.subtasks.length}` : ''}</h3>
          {canEdit ? (
            <>
              <ul className="subtask-editor">
                {form.subtasks.map((subtask, index) => (
                  <li key={subtask.id}>
                    <input
                      aria-label={`Subtask ${index + 1} title`}
                      value={subtask.title}
                      maxLength={160}
                      onChange={(event) => setForm({ ...form, subtasks: form.subtasks.map((entry) => entry.id === subtask.id ? { ...entry, title: event.target.value } : entry) })}
                    />
                    <select
                      aria-label={`Status for ${subtask.title || `subtask ${index + 1}`}`}
                      value={subtask.status}
                      onChange={(event) => setForm({ ...form, subtasks: form.subtasks.map((entry) => entry.id === subtask.id ? { ...entry, status: event.target.value as SubtaskStatus } : entry) })}
                    >
                      {SUBTASK_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    <select
                      aria-label={`Assignee for ${subtask.title || `subtask ${index + 1}`}`}
                      value={subtask.assignedTo ?? ''}
                      onChange={(event) => setForm({ ...form, subtasks: form.subtasks.map((entry) => entry.id === subtask.id ? { ...entry, assignedTo: event.target.value || null } : entry) })}
                    >
                      <option value="">Unassigned</option>
                      {assignableOptions.map((person) => <option key={person.userId} value={person.userId}>{person.label}</option>)}
                    </select>
                    <input
                      type="date"
                      aria-label={`Due date for ${subtask.title || `subtask ${index + 1}`}`}
                      value={typeof subtask.dueAt === 'string' ? subtask.dueAt.slice(0, 10) : ''}
                      onChange={(event) => setForm({ ...form, subtasks: form.subtasks.map((entry) => entry.id === subtask.id ? { ...entry, dueAt: event.target.value } : entry) })}
                    />
                    <button className="danger-text" type="button" aria-label={`Remove ${subtask.title || `subtask ${index + 1}`}`} onClick={() => setForm({ ...form, subtasks: form.subtasks.filter((entry) => entry.id !== subtask.id) })}>Remove</button>
                  </li>
                ))}
              </ul>
              {!form.subtasks.length ? <p className="mb-attachment-note">No subtasks yet. Break this card into steps if it helps.</p> : null}
              <button
                className="button secondary"
                type="button"
                disabled={form.subtasks.length >= MAX_SUBTASKS_PER_TASK}
                onClick={() => setForm({ ...form, subtasks: [...form.subtasks, { id: createOperationId('sub'), title: '', status: 'todo' as SubtaskStatus, assignedTo: null, dueAt: '' }] })}
              >Add subtask</button>
              <p className="mb-attachment-note">Subtasks save with the card, up to {MAX_SUBTASKS_PER_TASK} per task.</p>
            </>
          ) : (
            <ul className="subtask-list">
              {task.subtasks.map((subtask) => {
                const mayTick = Boolean(onSubtaskStatus) && (task.assignedTo === actorUserId || subtask.assignedTo === actorUserId);
                return (
                  <li key={subtask.id}>
                    <span className={`subtask-status subtask-status--${subtask.status}`}>{SUBTASK_STATUS_META[subtask.status].label}</span>
                    <span className="subtask-title">{subtask.title}</span>
                    <small>{subtask.assignedTo ? nameOf(directory, subtask.assignedTo) : 'Unassigned'}{subtask.dueAt ? ` · ${dueLabel(subtask.dueAt)}` : ''}</small>
                    {mayTick ? (
                      <select
                        aria-label={`Status for ${subtask.title}`}
                        value={subtask.status}
                        disabled={busy}
                        onChange={(event) => onSubtaskStatus?.(subtask.id, event.target.value as SubtaskStatus)}
                      >
                        {SUBTASK_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    ) : null}
                  </li>
                );
              })}
              {!task.subtasks.length ? <p className="mb-attachment-note">This card has no subtasks.</p> : null}
            </ul>
          )}
        </section>
        <section className="task-attachments" aria-labelledby="task-attachments-heading">
          <h3 id="task-attachments-heading">Attachments</h3>
          <AttachmentList files={attachments} status={attachmentsStatus} onRetry={() => onReloadAttachments?.()} />
          {canManage && onUploadFile && fileSharing === 'disabled' ? (
            <p className="mb-attachment-note">Team files are turned off for this team. Turn them on in <strong>Administration → Team settings</strong> to attach files.</p>
          ) : null}
          {canManage && onUploadFile && fileSharing === 'teamOnly' ? (
            attachments.length >= MAX_TASK_ATTACHMENTS ? <p className="mb-attachment-note">This card has the most files it can hold ({MAX_TASK_ATTACHMENTS}).</p> : (
              <div className="mb-attachment-upload">
                <label className={`button secondary${uploadProgress !== null || busy ? ' is-disabled' : ''}`}>
                  Upload a file
                  <input className="visually-hidden" type="file" accept={ATTACHMENT_ACCEPT} disabled={busy || uploadProgress !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUploadFile(file); }} />
                </label>
                <small>{uploadProgress !== null ? `Uploading… ${Math.round(uploadProgress * 100)}%` : 'PDF, image (PNG, JPG, WebP), text, CSV or ZIP · up to 10 MB'}</small>
              </div>
            )
          ) : null}
          {uploadError ? <p className="mb-attachment-note" role="alert">{uploadError}</p> : null}
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



export function KanbanBoard({ teamId, canManage, canEditTasks, actorRole, actorUserId, online }: KanbanBoardProps) {
  const firestore = getFirebaseServices().firestore;
  const navigate = useNavigate();
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
  const [groupBy, setGroupBy] = useState<BoardGroupBy>('milestone');
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
  const [fileSharing, setFileSharing] = useState<FileSharing | 'unknown'>('unknown');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  // A single clock keeps every overdue/today badge in a render consistent, and the
  // minute tick keeps them honest during a long working session.
  const [now, setNow] = useState(() => new Date());
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
    setBusy(false);
    setRequestState(null);
    setBoardNotice(null);
    setMigration(null);
    setTeamFiles([]);
    setGoals([]);
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
    setUploadError(null);
    void loadFileSharing(firestore, teamId)
      .then((sharing) => { if (active) setFileSharing(sharing); })
      .catch(() => { if (active) setFileSharing('unknown'); });
    void listTeamFiles(firestore, teamId)
      .then((page) => { if (active) setTeamFiles(page.files); })
      .catch(() => { if (active) setTeamFiles([]); });
    return () => { active = false; };
  }, [canManage, firestore, openTaskId, teamId]);
  useEffect(() => {
    // Closing the card, or switching team, stops an upload that is still running.
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    setUploadProgress(null);
  }, [openTaskId, teamId]);
  useEffect(() => () => { uploadAbort.current?.abort(); }, []);

  function uploadToTask(task: TrackerTask, file: File) {
    const problem = attachmentProblem(file);
    if (problem) { setUploadError(problem); return; }
    const controller = new AbortController();
    uploadAbort.current?.abort();
    uploadAbort.current = controller;
    setUploadError(null);
    setUploadProgress(0);
    void uploadTeamFile({
      teamId,
      fileId: createOperationId(),
      file,
      linkedTaskIds: [task.id],
      signal: controller.signal,
      activeTeamId: () => activeTeamRef.current,
      onProgress: (value) => { if (!controller.signal.aborted) setUploadProgress(value); }
    })
      .then(() => { if (!controller.signal.aborted) setAttachmentsAttempt((attempt) => attempt + 1); })
      .catch((uploadFailure: unknown) => {
        if (uploadFailure instanceof UploadAbortedError || controller.signal.aborted) return;
        setUploadError(getRequestState(uploadFailure, onlineRef.current).message);
      })
      .finally(() => {
        if (uploadAbort.current === controller) { uploadAbort.current = null; setUploadProgress(null); }
      });
  }
  useEffect(() => {
    // Milestones are the top of the work-breakdown tree, so the board itself
    // needs them — for the grouping bands, the Board setup picker and the card
    // dialog alike. A team with no milestones, or a rules denial, simply gets a
    // flat board rather than a broken one.
    if (!teamId) return undefined;
    let active = true;
    void listActiveTeamGoals(firestore, teamId)
      .then((teamGoals) => { if (active) setGoals(teamGoals); })
      .catch(() => { if (active) setGoals([]); });
    return () => { active = false; };
  }, [firestore, teamId]);
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
  const groups = useMemo(
    () => groupBy === 'milestone'
      ? groupByMilestone(sortedTasks, selectedProject, goals)
      : groupBoardTasks(sortedTasks, groupBy, selectedProject, now),
    [goals, groupBy, now, selectedProject, sortedTasks]
  );
  const visibleFields = useMemo(() => BOARD_FIELDS.map((field) => field.id).filter((field) => !hiddenFields.includes(field)), [hiddenFields]);
  const assignees = useMemo(() => boardPeople(tasks), [tasks]);
  const labels = useMemo(() => boardLabels(tasks), [tasks]);
  const directory = useMemo(() => memberMap(members), [members]);
  const roster = useMemo(() => members.map((member) => member.userId), [members]);
  const people = useMemo(() => [...new Set([...roster, ...assignees])].sort(), [assignees, roster]);
  // Who work can be given to: everyone above except parents, who follow the
  // board read-only. `people` stays the wider set for the assignee filter, so a
  // card assigned before the rule existed can still be found. Each picker adds
  // its card's current assignee back, so such a card still shows who has it.
  const assignablePeople = useMemo(
    () => members.filter((member) => canBeAssignedTasks(member.role)).map((member) => member.userId).sort(),
    [members]
  );
  // A parent never gets the assignee-only controls (ticking off a subtask); the
  // server refuses them too.
  const mayWorkAsAssignee = canBeAssignedTasks(actorRole);
  const attachableFiles = useMemo(
    () => teamFiles.filter((file) => !(selectedTask?.attachmentFileIds ?? []).includes(file.id)),
    [selectedTask, teamFiles]
  );
  const selectedTasks = useMemo(() => tasks.filter((task) => selectedIds.has(task.id)), [selectedIds, tasks]);
  // Any task editor may move any card, so the rule no longer depends on the card.
  const canMoveTask: (task: TrackerTask) => boolean = useCallback(() => canMoveKanbanTask(actorRole), [actorRole]);

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
    if (!canEditTasks || busy || !online) return;
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
        categories={selectedProject.categories}
        canManage={canManage}
        canEditTasks={canEditTasks}
        disabled={busy || !online}
        onNewItem={() => {
          setGroupBy('column');
          setFocusGroupId(selectedProject.columns[0]?.id ?? null);
        }}
        onOpenSetup={() => navigate('/board-setup')}
        onImport={() => navigate('/import')}
      />

      {!online ? <p className="kanban-offline" role="status">Reconnect before moving or editing cards. The current board remains available to review.</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={dragStart} onDragCancel={() => setActiveTaskId(null)} onDragEnd={dragEnd}>
        <BoardTable
            groups={groups}
            fields={visibleFields}
            groupBy={groupBy}
            project={selectedProject}
            people={assignablePeople}
            directory={directory}
            now={now}
            canManage={canEditTasks}
            canMoveTask={canMoveTask}
            disabled={busy || !online}
            selectedIds={selectedIds}
            focusGroupId={focusGroupId}
            actorUserId={actorUserId}
            mayWorkAsAssignee={mayWorkAsAssignee}
            onSelect={selectTask}
            onSelectGroup={selectGroup}
            onOpen={(task) => { setTaskConflict(false); setSelectedTask(task); }}
            onMove={(task, columnId) => move(task, columnId)}
            onPatch={patch}
            onSubtaskStatus={(task, subtaskId, status) => {
              if (busy || !online) return;
              void run(() => updateTask({ teamId, taskId: task.id, operationId: operationId(), subtaskStatus: { id: subtaskId, status } }));
            }}
          onCreate={(columnId, title) => {
            setFocusGroupId(null);
            void run(() => createKanbanTask({ teamId, projectId: selectedProject.id, columnId, operationId: operationId(), title }));
          }}
        />
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

      {canManage ? null : <p className="board-permission-note">{canEditTasks ? 'You can add, edit and move tasks. Board setup and importing stay with your coach.' : 'Your role has view-only access to project boards.'}</p>}

      {selectedTask ? <TaskDetails
        task={selectedTask}
        canManage={canManage}
        canEdit={canEditTasks}
        busy={busy}
        conflict={taskConflict}
        categories={selectedProject.categories}
        goals={goals}
        actorUserId={actorUserId}
        onSubtaskStatus={mayWorkAsAssignee ? (subtaskId, status) => void run(() => updateTask({ teamId, taskId: selectedTask.id, operationId: operationId(), subtaskStatus: { id: subtaskId, status } })) : undefined}
        people={assignablePeople}
        directory={directory}
        attachments={attachments}
        attachmentsStatus={attachmentsStatus}
        attachableFiles={attachableFiles}
        onReloadAttachments={() => setAttachmentsAttempt((attempt) => attempt + 1)}
        onAttachFile={(fileId) => void run(() => linkFileToTask(teamId, fileId, selectedTask.id)).then((linked) => { if (linked) setAttachmentsAttempt((attempt) => attempt + 1); })}
        fileSharing={fileSharing}
        onUploadFile={(file) => uploadToTask(selectedTask, file)}
        uploadProgress={uploadProgress}
        uploadError={uploadError}
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
