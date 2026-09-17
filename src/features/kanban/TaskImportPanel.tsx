import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { StatePanel } from '@/components/StatePanel';
import type { KanbanProject } from '@/lib/domain';
import { importProjectTasks, resolveImportAssignees } from '@/lib/kanban-service';
import {
  IMPORT_FIELDS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_ROWS,
  applyAssigneeMatches,
  areaLabel,
  assigneeLookups,
  buildImportPreview,
  importableRows,
  importableTaskCount,
  toImportInput,
  type ImportPreview
} from '@/lib/task-import';
import { nameOf, type TeamMember } from '@/lib/directory';
import { formatDateLabel } from '@/lib/dates';
import { readSpreadsheet } from './spreadsheet-reader';
import '@/styles/task-import.css';

/**
 * The standard template is a fixed file in `public/`, authored by
 * `npm run template:build` from the team's own 12-week plan. Serving it
 * statically means every team starts from the same sheet and no spreadsheet
 * library ships to the browser.
 */
const TEMPLATE_HREF = '/first-pit-task-template.xlsx';

const STARTER_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE_CSV)}`;

/**
 * Coach-only spreadsheet import. The file is parsed and previewed entirely in
 * the browser; only the rows that pass the preview reach `importProjectTasks`,
 * which validates them again. One operation id is minted per chosen file, so a
 * retried import of the same preview replays instead of doubling the cards.
 */
export function TaskImportPanel({ teamId, project, busy, online, directory, onRun, newOperationId }: {
  teamId: string;
  project: KanbanProject;
  busy: boolean;
  online: boolean;
  /** Resolved roster, so the preview shows matched assignees by name. */
  directory: Map<string, TeamMember>;
  onRun: (action: () => Promise<unknown>, refreshProjects?: boolean) => Promise<boolean>;
  newOperationId: () => string;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [columnId, setColumnId] = useState('');
  const [operation, setOperation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);


  useEffect(() => {
    setPreview(null);
    setFileName('');
    setReadError(null);
    setNotice(null);
    setColumnId('');
  }, [teamId, project.id]);

  const defaultColumnId = (project.columns.find((column) => column.id !== project.completedColumnId) ?? project.columns[0])?.id ?? '';
  const targetColumnId = project.columns.some((column) => column.id === columnId) ? columnId : defaultColumnId;
  const targetColumnName = project.columns.find((column) => column.id === targetColumnId)?.name ?? 'the board';
  const ready = preview ? importableRows(preview) : [];
  const readyTasks = preview ? importableTaskCount(preview) : 0;
  const readySubtasks = ready.length - readyTasks;
  const blocked = preview ? preview.rows.length - ready.length : 0;
  const tooMany = readyTasks > MAX_IMPORT_ROWS;

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input lets a coach re-choose the same file after fixing it.
    event.target.value = '';
    if (!file) return;
    setReading(true);
    setReadError(null);
    setNotice(null);
    setPreview(null);
    setFileName(file.name);
    try {
      const parsed = buildImportPreview(await readSpreadsheet(file), { columns: project.columns, categories: project.categories });
      setOperation(newOperationId());
      const lookups = assigneeLookups(parsed);
      if (!lookups.length || !online) {
        setPreview(parsed);
        return;
      }
      // Names and emails only resolve on the server; a lookup failure leaves the
      // rows unassigned rather than blocking the import.
      try {
        const { matches } = await resolveImportAssignees(teamId, lookups.slice(0, 60));
        setPreview(applyAssigneeMatches(parsed, matches));
      } catch {
        setPreview(applyAssigneeMatches(parsed, []));
      }
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'The file could not be read.');
    } finally {
      setReading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready.length || tooMany) return;
    const rows = toImportInput(ready);
    const columnName = targetColumnName;
    const subtaskCount = rows.reduce((sum, row) => sum + (row.subtasks?.length ?? 0), 0);
    const newCategories = preview?.newCategories ?? [];
    void onRun(() => importProjectTasks({ teamId, projectId: project.id, operationId: operation, columnId: targetColumnId, rows }), newCategories.length > 0).then((done) => {
      if (!done) return;
      setNotice([
        `Imported ${rows.length} task${rows.length === 1 ? '' : 's'} into ${columnName}`,
        subtaskCount ? ` with ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}` : '',
        newCategories.length ? `, and created ${newCategories.length} categor${newCategories.length === 1 ? 'y' : 'ies'}` : '',
        '.'
      ].join(''));
      setPreview(null);
      setFileName('');
    });
  }

  return (
    <section className="project-templates task-import" aria-labelledby="task-import-heading">
      <h3 id="task-import-heading">Import tasks from a spreadsheet</h3>
      <p className="template-note">
        Upload a .xlsx or .csv file with a header row. Recognised columns: {IMPORT_FIELDS.map((field) => `${field.label}${field.required ? ' (required)' : ''}`).join(', ')}.
        A row with Type “Subtask” becomes a step of the task above it. Category is your own grouping and is created if this board does not have it;
        Area is one of the four judging areas. Dates can be yyyy-mm-dd or month/day/year.
      </p>
      <p className="task-import__template-actions">
        <a className="button secondary" href={TEMPLATE_HREF} download>Download Excel template</a>
        <a href={STARTER_HREF} download="first-pit-task-import.csv">or a plain CSV starter file</a>
      </p>
      <p className="template-note">
        The template is the standard 12-week FLL plan: 48 tasks across Project Mgmt &amp; Core Values, Innovation Project,
        Robot Design and Robot Game. Edit it for your team — delete what you will not do, add what you will — then upload it here.
      </p>
      <label className="task-import__file">
        Spreadsheet
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={reading || busy} onChange={(event) => void chooseFile(event)} />
      </label>

      {notice ? <p className="task-import__notice" role="status">{notice}</p> : null}
      {reading ? <StatePanel variant="loading" title="Reading the spreadsheet" message={`Checking ${fileName} in your browser. Nothing is uploaded yet.`} /> : null}
      {readError ? <StatePanel variant="error" title="That file could not be read" message={readError} /> : null}
      {preview?.missingTitleColumn ? (
        <StatePanel
          variant="error"
          title="No Title column found"
          message={`The first row of ${fileName} needs a column named Title (or Task).${preview.unmappedHeaders.length ? ` Found: ${preview.unmappedHeaders.slice(0, 6).join(', ')}.` : ''}`}
        />
      ) : null}
      {preview && !preview.missingTitleColumn && !preview.rows.length ? <StatePanel variant="empty" title="No tasks in this file" message="The header was found, but every row below it is blank." /> : null}

      {preview && preview.rows.length ? (
        <form className="task-import__form" onSubmit={submit}>
          <p className="task-import__summary" aria-live="polite">
            <strong>{readyTasks} task{readyTasks === 1 ? '' : 's'} ready to import</strong>
            {readySubtasks ? ` · ${readySubtasks} subtask${readySubtasks === 1 ? '' : 's'}` : ''}
            {preview.newCategories.length ? ` · new categories: ${preview.newCategories.slice(0, 5).join(', ')}` : ''}
            {blocked ? ` · ${blocked} need fixing and will be skipped` : ''}
            {preview.truncated ? ' · only the first 500 rows were read' : ''}
            {preview.unmappedHeaders.length ? ` · ignored columns: ${preview.unmappedHeaders.slice(0, 6).join(', ')}` : ''}
          </p>
          {tooMany ? <p className="task-import__problem">One import can add at most {MAX_IMPORT_ROWS} tasks. Split the spreadsheet and import it in parts.</p> : null}
          <div className="task-import__table" tabIndex={0} role="region" aria-label={`Preview of ${fileName}`}>
            <table>
              <thead><tr><th scope="col">Row</th><th scope="col">Title</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Person</th><th scope="col">Area</th><th scope="col">Priority</th><th scope="col">Due</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className={`${row.issues.length ? 'is-blocked' : ''}${row.kind === 'subtask' ? ' is-subtask' : ''}`.trim() || undefined}>
                    <td>{row.line}</td>
                    <td>{row.kind === 'subtask' ? <span className="task-import__branch" aria-hidden="true">↳ </span> : null}{row.title || <em>No title</em>}{row.kind === 'subtask' ? <span className="visually-hidden"> (subtask)</span> : null}</td>
                    <td>{row.kind === 'subtask' ? '—' : row.category || '—'}</td>
                    <td>{row.kind === 'subtask' ? row.subtaskStatus : row.columnName || targetColumnName}</td>
                    <td>{row.assignedTo ? nameOf(directory, row.assignedTo) : row.assignee ? <em>unmatched</em> : '—'}</td>
                    <td>{row.kind === 'subtask' ? '—' : areaLabel(row.area)}</td>
                    <td>{row.kind === 'subtask' ? '—' : row.priority}</td>
                    <td>{formatDateLabel(row.dueAt, '—')}</td>
                    <td>
                      {row.issues.map((issue) => <span key={issue} className="task-import__issue">Skipped: {issue}</span>)}
                      {row.warnings.map((warning) => <span key={warning} className="task-import__warning">{warning}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="task-import__actions">
            <label>
              Default column (rows with no Status)
              <select value={targetColumnId} onChange={(event) => setColumnId(event.target.value)}>
                {project.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
              </select>
            </label>
            <button className="button" type="submit" disabled={busy || !online || !readyTasks || tooMany}>
              Import {readyTasks} task{readyTasks === 1 ? '' : 's'}
            </button>
            <button className="text-button" type="button" disabled={busy} onClick={() => { setPreview(null); setFileName(''); }}>Cancel</button>
          </div>
          {!online ? <p className="task-import__problem">You are offline. Reconnect to import.</p> : null}
        </form>
      ) : null}
    </section>
  );
}
