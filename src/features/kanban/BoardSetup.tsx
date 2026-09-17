import { useState, type FormEvent } from 'react';
import {
  addProjectColumn,
  projectVersion,
  removeProjectColumn,
  reorderProjectColumns,
  updateProject,
  updateProjectCategories,
  updateProjectColumn,
  MAX_CATEGORIES_PER_PROJECT
} from '@/lib/kanban-service';
import { TASK_AREAS } from '@/lib/task-import';
import { createOperationId as operationId } from '@/lib/ids';
import type { KanbanProject, ProjectColumn, TeamGoal } from '@/lib/domain';

/**
 * Column and category editing for one board — the structure behind the table,
 * kept off the board's own screen so the page a team works in every day shows
 * work rather than configuration.
 */
export function BoardSetup({ teamId, project, goals, busy, onRun }: {
  teamId: string;
  project: KanbanProject;
  /** Milestones a category can roll up into. */
  goals: TeamGoal[];
  busy: boolean;
  onRun: (action: () => Promise<unknown>, refreshProjects?: boolean) => Promise<boolean>;
}) {
  const [columnName, setColumnName] = useState('');
  const [categoryName, setCategoryName] = useState('');
  /**
   * Every category edit sends the whole list, so add, rename, reorder and remove
   * all take one server round trip and one version check.
   */
  function saveCategories(categories: Array<{ id?: string | null; name: string; color?: ProjectColumn['color']; areaId?: string | null; goalId?: string | null }>) {
    return updateProjectCategories({ teamId, projectId: project.id, categories, expectedVersion: projectVersion(project) });
  }
  function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim()) return;
    void onRun(() => saveCategories([...project.categories, { name: categoryName.trim(), color: 'slate', areaId: null }]), true)
      .then((saved) => { if (saved) setCategoryName(''); });
  }
  function shiftCategory(index: number, amount: number) {
    const next = index + amount;
    if (next < 0 || next >= project.categories.length) return;
    const ordered = [...project.categories];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    void onRun(() => saveCategories(ordered), true);
  }
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
    <section className="project-settings" aria-labelledby="board-setup-heading">
      <h3 id="board-setup-heading">Board setup</h3>
      <h4>Workflow columns</h4>
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
      <div className="category-settings">
        <h4>Categories</h4>
        <p className="settings-note">Categories are the work packages of this board — "Problem research", "Drive base". Put one under a milestone and its cards roll up into that milestone; tie it to a judging area and its cards count toward that area on the dashboard.</p>
        <div className="column-settings-list">
          {project.categories.map((category, index) => (
            <form key={category.id} onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void onRun(() => saveCategories(project.categories.map((entry) => entry.id === category.id ? {
                id: entry.id,
                name: String(form.get('name') ?? '').trim(),
                color: String(form.get('color') ?? 'slate') as ProjectColumn['color'],
                areaId: String(form.get('area') ?? '') || null,
                goalId: String(form.get('milestone') ?? '') || null
              } : entry)), true);
            }}>
              <input name="name" aria-label={`Name for ${category.name}`} defaultValue={category.name} maxLength={60} required />
              <select name="color" aria-label={`Color for ${category.name}`} defaultValue={category.color}><option value="blue">Blue</option><option value="purple">Purple</option><option value="orange">Orange</option><option value="green">Green</option><option value="slate">Slate</option><option value="pink">Pink</option></select>
              <select name="milestone" aria-label={`Milestone for ${category.name}`} defaultValue={category.goalId ?? ''}>
                <option value="">No milestone</option>
                {[...goals, ...(category.goalId && !goals.some((goal) => goal.id === category.goalId) ? [{ id: category.goalId, title: 'Linked milestone' } as TeamGoal] : [])]
                  .map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>
              <select name="area" aria-label={`Judging area for ${category.name}`} defaultValue={category.areaId ?? ''}>
                <option value="">No judging area</option>
                {TASK_AREAS.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
              </select>
              <button type="button" aria-label={`Move ${category.name} up`} disabled={busy || index === 0} onClick={() => shiftCategory(index, -1)}>↑</button>
              <button type="button" aria-label={`Move ${category.name} down`} disabled={busy || index === project.categories.length - 1} onClick={() => shiftCategory(index, 1)}>↓</button>
              <button type="submit" disabled={busy}>Save</button>
              <button className="danger-text" type="button" disabled={busy} onClick={() => void onRun(() => saveCategories(project.categories.filter((entry) => entry.id !== category.id)), true)}>Remove</button>
            </form>
          ))}
          {!project.categories.length ? <p className="settings-note">This board has no categories yet.</p> : null}
        </div>
        <form className="add-column-form" onSubmit={addCategory}>
          <label>New category<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} maxLength={60} placeholder="Innovation project" /></label>
          <button className="button secondary" disabled={busy || project.categories.length >= MAX_CATEGORIES_PER_PROJECT} type="submit">Add category</button>
        </form>
      </div>
      <form className="add-column-form" onSubmit={addColumn}><label>New column<input value={columnName} onChange={(event) => setColumnName(event.target.value)} maxLength={40} placeholder="Testing" /></label><button className="button secondary" disabled={busy || project.columns.length >= 8} type="submit">Add column</button></form>
    </section>
  );
}
