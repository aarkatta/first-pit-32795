import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BOARD_FIELDS,
  PRIORITY_META,
  avatarTone,
  boardColumn,
  dateInputToIso,
  dateInputValue,
  dueTone,
  formatDueDate,
  initials,
  summarizeGroup,
  timelineBounds,
  timelineOffsets,
  timelineSpan,
  toDate,
  type BoardFieldId,
  type BoardGroup,
  type BoardGroupBy
} from '@/lib/board-view';
import { initialsOf, nameOf, type TeamMember } from '@/lib/directory';
import type { KanbanProject, TaskPriority, TrackerTask } from '@/lib/domain';

/** Resolved team roster, keyed by user id. Empty until `listTeamMembers` returns. */
export type BoardDirectory = Map<string, TeamMember>;

const EMPTY_DIRECTORY: BoardDirectory = new Map();

export type BoardTaskPatch = {
  title?: string;
  assignedTo?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
};

type CellContext = {
  project: KanbanProject;
  people: string[];
  directory: BoardDirectory;
  now: Date;
  canManage: boolean;
  disabled: boolean;
  onPatch: (task: TrackerTask, patch: BoardTaskPatch) => void;
  onMove: (task: TrackerTask, columnId: string) => void;
  onOpen: (task: TrackerTask) => void;
};

/**
 * `users/{uid}` is private, so a raw `assignedTo` is a 28-character Firebase UID.
 * Every person on the board is rendered through the roster the `listTeamMembers`
 * callable resolves; a member who has left still needs a readable label, and an
 * unresolved roster falls back to the id-derived initials rather than to nothing.
 */
function personName(directory: BoardDirectory, userId: string | null | undefined): string {
  return nameOf(directory, userId);
}

function personInitials(directory: BoardDirectory, userId: string | null | undefined): string {
  if (!userId) return initials(null);
  return directory.get(userId)?.initials ?? initialsOf(directory, userId);
}

function Avatar({ userId, directory, title }: { userId: string | null; directory: BoardDirectory; title?: string }) {
  return (
    <span className={`mb-avatar mb-tone-${avatarTone(userId)}${userId ? '' : ' mb-avatar--empty'}`} title={title ?? personName(directory, userId)} aria-hidden="true">
      {personInitials(directory, userId)}
    </span>
  );
}

function PersonCell({ task, context }: { task: TrackerTask; context: CellContext }) {
  const options = useMemo(
    () => [...new Set([...context.people, ...(task.assignedTo ? [task.assignedTo] : [])])]
      .map((userId) => ({ userId, label: personName(context.directory, userId) }))
      .sort((first, second) => first.label.localeCompare(second.label)),
    [context.directory, context.people, task.assignedTo]
  );
  if (!context.canManage) {
    return <div className="mb-cell mb-cell--person"><Avatar userId={task.assignedTo} directory={context.directory} /><span className="visually-hidden">{personName(context.directory, task.assignedTo)}</span></div>;
  }
  return (
    <div className="mb-cell mb-cell--person">
      <Avatar userId={task.assignedTo} directory={context.directory} />
      <select
        className="mb-overlay-select"
        aria-label={`Person for ${task.title}`}
        value={task.assignedTo ?? ''}
        disabled={context.disabled}
        onChange={(event) => context.onPatch(task, { assignedTo: event.target.value || null })}
      >
        <option value="">Unassigned</option>
        {options.map((person) => <option key={person.userId} value={person.userId}>{person.label}</option>)}
      </select>
    </div>
  );
}

function StatusCell({ task, context, canMove }: { task: TrackerTask; context: CellContext; canMove: boolean }) {
  const column = boardColumn(context.project, task.columnId);
  const color = column?.color ?? 'gray';
  const name = column?.name ?? 'Unassigned status';
  return (
    <div className={`mb-cell mb-cell--status mb-fill mb-color-${color}`}>
      <span>{name}</span>
      {canMove ? (
        <select
          className="mb-overlay-select"
          aria-label={`Status for ${task.title}`}
          value={column?.id ?? ''}
          disabled={context.disabled}
          onChange={(event) => context.onMove(task, event.target.value)}
        >
          {column ? null : <option value="">Unassigned status</option>}
          {context.project.columns.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      ) : null}
    </div>
  );
}

function PriorityCell({ task, context }: { task: TrackerTask; context: CellContext }) {
  const meta = PRIORITY_META[task.priority];
  return (
    <div className={`mb-cell mb-cell--status mb-fill mb-color-${meta.color}`}>
      <span>{meta.label}</span>
      {context.canManage ? (
        <select
          className="mb-overlay-select"
          aria-label={`Priority for ${task.title}`}
          value={task.priority}
          disabled={context.disabled}
          onChange={(event) => context.onPatch(task, { priority: event.target.value as TaskPriority })}
        >
          {(Object.keys(PRIORITY_META) as TaskPriority[]).map((option) => <option key={option} value={option}>{PRIORITY_META[option].label}</option>)}
        </select>
      ) : null}
    </div>
  );
}

function DateCell({ task, context }: { task: TrackerTask; context: CellContext }) {
  const due = toDate(task.dueAt);
  const tone = dueTone(due, context.now);
  if (!context.canManage) {
    return <div className={`mb-cell mb-cell--date mb-due-${tone}`}>{due ? formatDueDate(due) : <span className="mb-muted">—</span>}</div>;
  }
  return (
    <div className={`mb-cell mb-cell--date mb-due-${tone}`}>
      <input
        type="date"
        aria-label={`Due date for ${task.title}`}
        value={dateInputValue(task.dueAt)}
        disabled={context.disabled}
        onChange={(event) => context.onPatch(task, { dueAt: dateInputToIso(event.target.value) })}
      />
    </div>
  );
}

function TimelineCell({ task, bounds }: { task: TrackerTask; bounds: ReturnType<typeof timelineBounds> }) {
  const span = timelineSpan(task);
  if (!span || !bounds) return <div className="mb-cell mb-cell--timeline"><span className="mb-muted">—</span></div>;
  const { left, width } = timelineOffsets(span, bounds);
  return (
    <div className="mb-cell mb-cell--timeline">
      <span className="mb-timeline-track">
        <span className="mb-timeline-bar" style={{ marginInlineStart: `${left}%`, width: `${width}%` }}>{span.label}</span>
      </span>
    </div>
  );
}

function LabelsCell({ task }: { task: TrackerTask }) {
  if (!task.labels.length) return <div className="mb-cell mb-cell--labels"><span className="mb-muted">—</span></div>;
  return (
    <div className="mb-cell mb-cell--labels">
      {task.labels.slice(0, 2).map((label) => <span className="mb-tag" key={label}>{label}</span>)}
      {task.labels.length > 2 ? <span className="mb-tag mb-tag--more">+{task.labels.length - 2}</span> : null}
    </div>
  );
}

function FilesCell({ task, context }: { task: TrackerTask; context: CellContext }) {
  const count = task.attachmentFileIds.length;
  return (
    <div className="mb-cell mb-cell--files">
      <button type="button" className="mb-file-chip" onClick={() => context.onOpen(task)} aria-label={`${count} file${count === 1 ? '' : 's'} on ${task.title}`}>
        <span aria-hidden="true">🗎</span>{count || ''}
      </button>
    </div>
  );
}

function BoardRow({ task, fields, context, canMove, draggable, selected, onSelect, bounds }: {
  task: TrackerTask;
  fields: BoardFieldId[];
  context: CellContext;
  canMove: boolean;
  draggable: boolean;
  selected: boolean;
  onSelect: (taskId: string, next: boolean) => void;
  bounds: ReturnType<typeof timelineBounds>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId: task.columnId },
    disabled: !draggable || !canMove || context.disabled
  });
  const column = boardColumn(context.project, task.columnId);
  const checklistDone = task.checklist.filter((item) => item.completed).length;
  return (
    <tr
      ref={setNodeRef}
      id={`task-${task.id}`}
      className={`mb-row${isDragging ? ' is-dragging' : ''}${selected ? ' is-selected' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <td className="mb-td mb-td--select">
        <span className={`mb-row-stripe mb-color-${column?.color ?? 'gray'}`} aria-hidden="true" />
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${task.title}`}
          onChange={(event) => onSelect(task.id, event.target.checked)}
        />
      </td>
      <td className="mb-td mb-td--item">
        <div className="mb-item">
          {draggable ? (
            <button className="mb-drag" type="button" aria-label={`Reorder ${task.title}`} disabled={!canMove || context.disabled} {...attributes} {...listeners}>⠿</button>
          ) : <span className="mb-drag mb-drag--static" aria-hidden="true" />}
          <button className="mb-item-title" type="button" onClick={() => context.onOpen(task)}>{task.title}</button>
          {task.checklist.length ? <span className="mb-item-meta" title="Checklist progress">{checklistDone}/{task.checklist.length}</span> : null}
          {task.description ? <span className="mb-item-meta" title="Has a description" aria-hidden="true">≡</span> : null}
        </div>
      </td>
      {fields.map((field) => (
        <td className="mb-td" key={field}>
          {field === 'person' ? <PersonCell task={task} context={context} /> : null}
          {field === 'status' ? <StatusCell task={task} context={context} canMove={canMove} /> : null}
          {field === 'priority' ? <PriorityCell task={task} context={context} /> : null}
          {field === 'dueAt' ? <DateCell task={task} context={context} /> : null}
          {field === 'timeline' ? <TimelineCell task={task} bounds={bounds} /> : null}
          {field === 'labels' ? <LabelsCell task={task} /> : null}
          {field === 'files' ? <FilesCell task={task} context={context} /> : null}
        </td>
      ))}
    </tr>
  );
}

function SummaryRow({ group, fields, context }: { group: BoardGroup; fields: BoardFieldId[]; context: CellContext }) {
  const summary = summarizeGroup(group.tasks, context.project);
  const people = [...new Set(group.tasks.map((task) => task.assignedTo).filter((person): person is string => Boolean(person)))];
  const overdue = group.tasks.filter((task) => dueTone(toDate(task.dueAt), context.now) === 'overdue').length;
  const files = group.tasks.reduce((sum, task) => sum + task.attachmentFileIds.length, 0);
  const labels = new Set(group.tasks.flatMap((task) => task.labels)).size;
  const bounds = timelineBounds(group.tasks);
  const priorities = (Object.keys(PRIORITY_META) as TaskPriority[])
    .map((priority) => ({ priority, count: group.tasks.filter((task) => task.priority === priority).length }))
    .filter((entry) => entry.count > 0);

  return (
    <tr className="mb-summary">
      <td className="mb-td mb-td--select" aria-hidden="true" />
      <td className="mb-td mb-td--item"><span className="mb-summary-label">{summary.done}/{summary.total} done</span></td>
      {fields.map((field) => (
        <td className="mb-td" key={field}>
          {field === 'person' ? (
            <div className="mb-cell mb-avatar-stack">
              {people.slice(0, 3).map((person) => <Avatar key={person} userId={person} directory={context.directory} />)}
              {people.length > 3 ? <span className="mb-avatar mb-avatar--more" aria-hidden="true">+{people.length - 3}</span> : null}
              <span className="visually-hidden">{people.length} people assigned</span>
            </div>
          ) : null}
          {field === 'status' ? (
            <div className="mb-cell mb-stack-bar" title={summary.segments.map((segment) => `${segment.label}: ${segment.count}`).join(', ')}>
              {summary.segments.map((segment) => <span key={segment.id} className={`mb-color-${segment.color}`} style={{ width: `${segment.percent}%` }} />)}
            </div>
          ) : null}
          {field === 'priority' ? (
            <div className="mb-cell mb-stack-bar" title={priorities.map((entry) => `${PRIORITY_META[entry.priority].label}: ${entry.count}`).join(', ')}>
              {priorities.map((entry) => <span key={entry.priority} className={`mb-color-${PRIORITY_META[entry.priority].color}`} style={{ width: `${(entry.count / summary.total) * 100}%` }} />)}
            </div>
          ) : null}
          {field === 'dueAt' ? <div className="mb-cell mb-summary-text">{overdue ? `${overdue} overdue` : '—'}</div> : null}
          {field === 'timeline' ? (
            <div className="mb-cell mb-cell--timeline">
              {bounds ? <span className="mb-timeline-track"><span className="mb-timeline-bar mb-timeline-bar--summary" style={{ width: '100%' }}>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(bounds.start))} – {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(bounds.end))}</span></span> : <span className="mb-muted">—</span>}
            </div>
          ) : null}
          {field === 'labels' ? <div className="mb-cell mb-summary-text">{labels ? `${labels} label${labels === 1 ? '' : 's'}` : '—'}</div> : null}
          {field === 'files' ? <div className="mb-cell mb-summary-text">{files || '—'}</div> : null}
        </td>
      ))}
    </tr>
  );
}

function GroupSection({ group, groupTitle, fields, context, groupBy, canMoveTask, selectedIds, onSelect, onSelectGroup, onCreate, autoFocus }: {
  group: BoardGroup;
  groupTitle: string;
  fields: BoardFieldId[];
  context: CellContext;
  groupBy: BoardGroupBy;
  canMoveTask: (task: TrackerTask) => boolean;
  selectedIds: Set<string>;
  onSelect: (taskId: string, next: boolean) => void;
  onSelectGroup: (taskIds: string[], next: boolean) => void;
  onCreate: (columnId: string, title: string) => void;
  autoFocus: boolean;
}) {
  const draggable = groupBy === 'column';
  const { setNodeRef, isOver } = useDroppable({ id: `column:${group.id}`, data: { type: 'column', columnId: group.id }, disabled: !draggable });
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const bounds = useMemo(() => timelineBounds(group.tasks), [group.tasks]);
  const groupIds = group.tasks.map((task) => task.id);
  const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    if (autoFocus) addRef.current?.focus();
  }, [autoFocus]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(group.id, title.trim());
    setTitle('');
  }

  return (
    <section className={`mb-group mb-color-${group.color}${isOver ? ' is-over' : ''}`} aria-labelledby={`group-${group.id}`}>
      <header className="mb-group-head">
        <button
          className="mb-collapse"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`group-body-${group.id}`}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span className="visually-hidden">{collapsed ? 'Expand' : 'Collapse'} {groupTitle}</span>
        </button>
        <h3 className="mb-group-title" id={`group-${group.id}`}>{groupTitle}</h3>
        <span className="mb-group-count">{group.tasks.length} item{group.tasks.length === 1 ? '' : 's'}</span>
      </header>

      {collapsed ? null : (
        <div className="mb-table-wrap" id={`group-body-${group.id}`} ref={setNodeRef}>
          <table className="mb-table">
            <caption className="visually-hidden">{groupTitle} — {group.tasks.length} items</caption>
            <thead>
              <tr>
                <th className="mb-th mb-th--select" scope="col">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={!groupIds.length}
                    aria-label={`Select all items in ${groupTitle}`}
                    onChange={(event) => onSelectGroup(groupIds, event.target.checked)}
                  />
                </th>
                <th className="mb-th mb-th--item" scope="col">Item</th>
                {fields.map((field) => <th className="mb-th" scope="col" key={field}>{BOARD_FIELDS.find((entry) => entry.id === field)?.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
                {group.tasks.map((task) => (
                  <BoardRow
                    key={task.id}
                    task={task}
                    fields={fields}
                    context={context}
                    canMove={canMoveTask(task)}
                    draggable={draggable}
                    selected={selectedIds.has(task.id)}
                    onSelect={onSelect}
                    bounds={bounds}
                  />
                ))}
              </SortableContext>
              {!group.tasks.length ? (
                <tr className="mb-empty-row">
                  <td className="mb-td" colSpan={fields.length + 2}>{draggable ? 'No items yet. Add one below or drag a row here.' : 'No items in this group.'}</td>
                </tr>
              ) : null}
              {context.canManage && draggable ? (
                <tr className="mb-add-row">
                  <td className="mb-td" colSpan={fields.length + 2}>
                    <form onSubmit={submit}>
                      <span className="mb-add-plus" aria-hidden="true">+</span>
                      <input
                        ref={addRef}
                        value={title}
                        maxLength={160}
                        placeholder="Add item"
                        aria-label={`Add an item to ${groupTitle}`}
                        disabled={context.disabled}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                      <button className="mb-add-submit" type="submit" disabled={context.disabled || !title.trim()}>Add</button>
                    </form>
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot><SummaryRow group={group} fields={fields} context={context} /></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function BoardTable({ groups, fields, groupBy, project, people, directory = EMPTY_DIRECTORY, now, canManage, canMoveTask, disabled, selectedIds, focusGroupId, onSelect, onSelectGroup, onCreate, onOpen, onMove, onPatch }: {
  groups: BoardGroup[];
  fields: BoardFieldId[];
  groupBy: BoardGroupBy;
  project: KanbanProject;
  people: string[];
  directory?: BoardDirectory;
  now: Date;
  canManage: boolean;
  canMoveTask: (task: TrackerTask) => boolean;
  disabled: boolean;
  selectedIds: Set<string>;
  focusGroupId: string | null;
  onSelect: (taskId: string, next: boolean) => void;
  onSelectGroup: (taskIds: string[], next: boolean) => void;
  onCreate: (columnId: string, title: string) => void;
  onOpen: (task: TrackerTask) => void;
  onMove: (task: TrackerTask, columnId: string) => void;
  onPatch: (task: TrackerTask, patch: BoardTaskPatch) => void;
}) {
  const context: CellContext = { project, people, directory, now, canManage, disabled, onPatch, onMove, onOpen };
  if (!groups.length) {
    return <p className="mb-board-empty">No items match the current filters. Clear a filter to see the rest of the board.</p>;
  }
  return (
    <div className="mb-board">
      {groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          groupTitle={groupBy === 'person' && group.id !== 'unassigned' ? personName(directory, group.id) : group.title}
          fields={fields}
          context={context}
          groupBy={groupBy}
          canMoveTask={canMoveTask}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onSelectGroup={onSelectGroup}
          onCreate={onCreate}
          autoFocus={focusGroupId === group.id}
        />
      ))}
    </div>
  );
}
