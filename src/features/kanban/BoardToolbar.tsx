import { useEffect, useRef } from 'react';
import {
  BOARD_FIELDS,
  BOARD_GROUP_OPTIONS,
  BOARD_SORT_OPTIONS,
  PRIORITY_META,
  activeFilterCount,
  avatarTone,
  initials,
  type BoardFieldId,
  type BoardFilters,
  type BoardGroupBy,
  type BoardSort,
  type BoardSortKey
} from '@/lib/board-view';
import { nameOf, type TeamMember } from '@/lib/directory';
import type { TaskPriority } from '@/lib/domain';

const EMPTY_DIRECTORY: Map<string, TeamMember> = new Map();

type BoardToolbarProps = {
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  sort: BoardSort;
  onSortChange: (sort: BoardSort) => void;
  groupBy: BoardGroupBy;
  onGroupByChange: (groupBy: BoardGroupBy) => void;
  hiddenFields: BoardFieldId[];
  onHiddenFieldsChange: (fields: BoardFieldId[]) => void;
  people: string[];
  /** Resolved roster so the person filter lists names instead of Firebase UIDs. */
  directory?: Map<string, TeamMember>;
  labels: string[];
  /** Board categories, in board order, for the category filter. */
  categories: { id: string; name: string }[];
  /** Import and board setup: coaches and team leaders. */
  canManage: boolean;
  /** Adding items: coaches, team leaders and students. */
  canEditTasks?: boolean;
  disabled: boolean;
  onNewItem: () => void;
  /** Opens the spreadsheet import panel; coach-only, like creating an item. */
  onImport: () => void;
  /** Board setup is its own screen; the toolbar is the way in. */
  onOpenSetup: () => void;
};

/** Closes an open popover when focus or a click lands outside it. */
function useDismissOnOutside(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    function close(event: Event) {
      if (root && !root.contains(event.target as Node)) {
        for (const menu of root.querySelectorAll('details[open]')) menu.removeAttribute('open');
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !root) return;
      for (const menu of root.querySelectorAll('details[open]')) {
        menu.removeAttribute('open');
        menu.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('focusin', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('focusin', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref]);
}

export function BoardToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  groupBy,
  onGroupByChange,
  hiddenFields,
  onHiddenFieldsChange,
  people,
  directory = EMPTY_DIRECTORY,
  labels,
  categories,
  canManage,
  canEditTasks = canManage,
  disabled,
  onNewItem,
  onImport,
  onOpenSetup
}: BoardToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  useDismissOnOutside(root);
  const filterCount = activeFilterCount(filters);
  const personLabel = filters.person === 'unassigned' ? 'Unassigned' : filters.person ? nameOf(directory, filters.person) : 'Person';
  const roster = [...people]
    .map((userId) => ({ userId, label: nameOf(directory, userId), initials: directory.get(userId)?.initials ?? initials(userId) }))
    .sort((first, second) => first.label.localeCompare(second.label));

  function toggleField(field: BoardFieldId, hidden: boolean) {
    onHiddenFieldsChange(hidden ? [...new Set([...hiddenFields, field])] : hiddenFields.filter((entry) => entry !== field));
  }

  return (
    <div className="mb-toolbar" ref={root}>
      <div className="mb-toolbar-actions">
        {canEditTasks ? <button className="mb-new-item" type="button" disabled={disabled} onClick={onNewItem}>New item</button> : null}
        {canManage ? (
          <>
            <button className="mb-import-item" type="button" disabled={disabled} onClick={onImport}>
              <span aria-hidden="true">⭳</span> Import from Excel
            </button>
            <button className="mb-import-item" type="button" onClick={onOpenSetup}>
              <span aria-hidden="true">⚙</span> Board setup
            </button>
          </>
        ) : null}

        <label className="mb-search">
          <span aria-hidden="true">⌕</span>
          <span className="visually-hidden">Search items</span>
          <input type="search" value={filters.query} placeholder="Search" onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} />
        </label>

        <details className="mb-menu">
          <summary className={filters.person ? 'is-on' : ''}>
            <span aria-hidden="true">◍</span> {personLabel}
          </summary>
          <div className="mb-menu-panel">
            <p className="mb-menu-title">Filter by person</p>
            <button type="button" className={!filters.person ? 'is-on' : ''} onClick={() => onFiltersChange({ ...filters, person: '' })}>Anyone</button>
            <button type="button" className={filters.person === 'unassigned' ? 'is-on' : ''} onClick={() => onFiltersChange({ ...filters, person: 'unassigned' })}>Unassigned</button>
            {roster.map((person) => (
              <button key={person.userId} type="button" className={filters.person === person.userId ? 'is-on' : ''} onClick={() => onFiltersChange({ ...filters, person: person.userId })}>
                <span className={`mb-avatar mb-tone-${avatarTone(person.userId)}`} aria-hidden="true">{person.initials}</span>
                {person.label}
              </button>
            ))}
            {!roster.length ? <p className="mb-menu-empty">No teammates to filter by yet.</p> : null}
          </div>
        </details>

        <details className="mb-menu">
          <summary className={filterCount ? 'is-on' : ''}>
            <span aria-hidden="true">▽</span> Filter{filterCount ? ` / ${filterCount}` : ''}
          </summary>
          <div className="mb-menu-panel">
            <label className="mb-menu-field">Priority
              <select value={filters.priority} onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value })}>
                <option value="">All priorities</option>
                {(Object.keys(PRIORITY_META) as TaskPriority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>)}
              </select>
            </label>
            <label className="mb-menu-field">Due
              <select value={filters.due} onChange={(event) => onFiltersChange({ ...filters, due: event.target.value })}>
                <option value="">Any date</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due today</option>
                <option value="week">Next 7 days</option>
                <option value="none">No due date</option>
              </select>
            </label>
            <label className="mb-menu-field">Category
              <select value={filters.category} onChange={(event) => onFiltersChange({ ...filters, category: event.target.value })}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                <option value="uncategorised">No category</option>
              </select>
            </label>
            <label className="mb-menu-field">Label
              <select value={filters.label} onChange={(event) => onFiltersChange({ ...filters, label: event.target.value })}>
                <option value="">All labels</option>
                {labels.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
            <button className="mb-menu-clear" type="button" disabled={!filterCount && !filters.query} onClick={() => onFiltersChange({ query: '', person: '', priority: '', label: '', due: '', category: '' })}>Clear all</button>
          </div>
        </details>

        <details className="mb-menu">
          <summary className={sort.key !== 'manual' ? 'is-on' : ''}>
            <span aria-hidden="true">↕</span> Sort
          </summary>
          <div className="mb-menu-panel">
            <label className="mb-menu-field">Sort by
              <select value={sort.key} onChange={(event) => onSortChange({ ...sort, key: event.target.value as BoardSortKey })}>
                {BOARD_SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="mb-menu-field">Direction
              <select value={sort.direction} onChange={(event) => onSortChange({ ...sort, direction: event.target.value as BoardSort['direction'] })}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </div>
        </details>

        <details className="mb-menu">
          <summary className={hiddenFields.length ? 'is-on' : ''}>
            <span aria-hidden="true">◎</span> Hide{hiddenFields.length ? ` / ${hiddenFields.length}` : ''}
          </summary>
          <div className="mb-menu-panel">
            <p className="mb-menu-title">Columns</p>
            {BOARD_FIELDS.map((field) => (
              <label className="mb-menu-check" key={field.id}>
                <input
                  type="checkbox"
                  checked={!hiddenFields.includes(field.id)}
                  onChange={(event) => toggleField(field.id, !event.target.checked)}
                />
                {field.label}
              </label>
            ))}
          </div>
        </details>

        <details className="mb-menu">
          <summary className={groupBy !== 'column' ? 'is-on' : ''}>
            <span aria-hidden="true">▤</span> Group by
          </summary>
          <div className="mb-menu-panel">
            {BOARD_GROUP_OPTIONS.map((option) => (
              <button key={option.id} type="button" className={groupBy === option.id ? 'is-on' : ''} onClick={() => onGroupByChange(option.id)}>{option.label}</button>
            ))}
            <p className="mb-menu-note">Dragging rows between groups is available when grouping by status group.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
