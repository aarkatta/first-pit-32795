#!/usr/bin/env node
/**
 * Authors the standard task template that coaches download from the Tracker.
 *
 * This runs at authoring time, not in the app: the workbook is committed to
 * `public/` and served as a static file, so no spreadsheet library ships to the
 * browser and every team starts from the same sheet. Re-run it after editing
 * `scripts/data/fll-standard-task-list.json`:
 *
 *   npm run template:build
 *
 * The task list is the team's own 12-week plan. The column names are the ones
 * that plan already used, so a team that has been keeping it in Excel can
 * upload what they have without rearranging anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(join(here, 'data', 'fll-standard-task-list.json'), 'utf8'));
const output = join(here, '..', 'public', 'first-pit-task-template.xlsx');

const HEADERS = ['Task ID', 'Week', 'Category', 'Task Description', 'Assignee', 'Status', 'Notes', 'Type', 'Priority', 'Start date', 'End date', 'Due date'];
const STATUSES = ['Not Started', 'In Progress', 'Review', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const TYPES = ['Task', 'Subtask'];
/** Dropdowns cover the shipped rows plus room for a season's worth of additions. */
const VALIDATED_ROWS = 200;

const INSTRUCTIONS = [
  ['First Pit — standard FLL task template'],
  [''],
  ['This is the starting plan, not a rulebook: delete what your team will not do, and add what it will.'],
  [''],
  ['How to use it'],
  ['1. Fill in Assignee and Status as the season runs. Everything else can stay as it is.'],
  ['2. Upload it in the app: Tracker → Import from Excel. The preview shows exactly what will be created before anything is saved.'],
  ['3. Category becomes a work package on your board. The four here map to the four judging areas, so dashboard progress fills in by itself.'],
  ['4. Week is kept as a label (week-01, week-02 …), so you can group or filter the board by week.'],
  ['5. Status maps to a board column. Not Started, In Progress, Review and Done are understood; so is any column name your board uses.'],
  ['6. Assignee is a teammate’s name or the email they sign in with. A name that matches nobody imports unassigned, and the preview says so.'],
  ['7. Set Type to Subtask to make a row a step of the task above it.'],
  ['8. Notes becomes the card description.'],
  ['9. Start date and End date are the planned window; Due date is the deadline. All three are optional and read best as yyyy-mm-dd. The board draws its timeline from the window.'],
  [''],
  ['Limits: 200 tasks per upload, 30 subtasks per task, 160 characters per title.'],
  [''],
  [`Task list source: ${source.source}`]
];

const workbook = new ExcelJS.Workbook();
workbook.creator = 'First Pit';
workbook.created = new Date();

// The plan leads the workbook: an importer that reads the first sheet must
// find tasks, not instructions.
const tasks = workbook.addWorksheet(source.sheetName ?? 'Tasks');
tasks.columns = [
  { header: HEADERS[0], width: 14 },
  { header: HEADERS[1], width: 7 },
  { header: HEADERS[2], width: 26 },
  { header: HEADERS[3], width: 50 },
  { header: HEADERS[4], width: 20 },
  { header: HEADERS[5], width: 14 },
  { header: HEADERS[6], width: 28 },
  { header: HEADERS[7], width: 10 },
  { header: HEADERS[8], width: 10 },
  { header: HEADERS[9], width: 13 },
  { header: HEADERS[10], width: 13 },
  { header: HEADERS[11], width: 13 }
];
tasks.getRow(1).font = { bold: true };
tasks.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2EC' } };
tasks.views = [{ state: 'frozen', ySplit: 1 }];
for (const row of source.rows) {
  tasks.addRow([row.taskId, row.week, row.category, row.title, '', row.status, row.notes ?? '', 'Task', '', '', '', '']);
}

const guide = workbook.addWorksheet('How to use');
guide.columns = [{ width: 120 }];
guide.addRows(INSTRUCTIONS);
guide.getRow(1).font = { bold: true, size: 14 };
guide.getRow(5).font = { bold: true };

const lists = workbook.addWorksheet('Lists');
lists.state = 'veryHidden';
const columns = [
  { letter: 'A', values: source.categories },
  { letter: 'B', values: STATUSES },
  { letter: 'C', values: TYPES },
  { letter: 'D', values: PRIORITIES }
];
for (const column of columns) {
  column.values.forEach((value, index) => {
    lists.getCell(`${column.letter}${index + 1}`).value = value;
  });
}

// Excel rejects an inline list over 255 characters, so every dropdown points at
// the hidden sheet instead.
const validation = [
  { letter: 'C', list: columns[0] },
  { letter: 'F', list: columns[1] },
  { letter: 'H', list: columns[2] },
  { letter: 'I', list: columns[3] }
];
for (const entry of validation) {
  for (let row = 2; row <= VALIDATED_ROWS; row += 1) {
    tasks.getCell(`${entry.letter}${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      // Not `showErrorMessage`: a team may legitimately invent a category, and
      // the import preview is where anything unexpected gets caught anyway.
      formulae: [`'Lists'!$${entry.list.letter}$1:$${entry.list.letter}$${entry.list.values.length}`]
    };
  }
}

await workbook.xlsx.writeFile(output);
console.log(`Wrote ${output} — ${source.rows.length} tasks, ${source.categories.length} categories.`);
