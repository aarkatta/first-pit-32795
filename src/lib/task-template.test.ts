import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/node';
import { buildImportPreview, importableRows, importableTaskCount, toImportInput, type ImportContext } from './task-import';
import { pickTaskSheet } from '@/features/kanban/spreadsheet-reader';

/**
 * The template a coach downloads has to survive the importer that reads it
 * back. This parses the file actually shipped in `public/` — not a fixture —
 * so a change to either side that breaks the round trip fails here.
 */
const TEMPLATE_PATH = 'public/first-pit-task-template.xlsx';

const board: ImportContext = {
  columns: [
    { id: 'todo', name: 'To Do', color: 'blue' },
    { id: 'inProgress', name: 'In Progress', color: 'purple' },
    { id: 'review', name: 'Review', color: 'orange' },
    { id: 'completed', name: 'Completed', color: 'green' }
  ],
  categories: []
};

/**
 * The workbook goes through the same sheet choice the app makes, so a template
 * whose sheets get reordered — or one a team adds a notes tab to — is covered
 * here rather than discovered on upload.
 */
async function previewTemplate() {
  const sheets = await readXlsxFile(TEMPLATE_PATH) as unknown as Array<{ sheet: string; data: unknown[][] }>;
  const chosen = pickTaskSheet(sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
  })));
  if (!chosen) throw new Error('The shipped template has no sheets.');
  return { sheetName: chosen.name, preview: buildImportPreview(chosen.rows, board) };
}

describe('the shipped task template', () => {
  it('is read from the plan sheet, not the instructions sheet', async () => {
    const { sheetName } = await previewTemplate();
    expect(sheetName).toBe('FLL Project Plan');
  });

  it('imports every row with no blocking issue', async () => {
    const { preview } = await previewTemplate();
    expect(preview.missingTitleColumn).toBe(false);
    expect(preview.rows).toHaveLength(48);
    expect(importableTaskCount(preview)).toBe(48);
    // "Task ID" is the plan's own bookkeeping, recognised and skipped rather
    // than reported as an ignored column.
    expect(preview.unmappedHeaders).toEqual([]);
  });

  it('creates the four work packages the plan is built around', async () => {
    const { preview } = await previewTemplate();
    expect(preview.newCategories).toEqual([
      'Project Mgmt & Core Values',
      'Innovation Project',
      'Robot Design',
      'Robot Game'
    ]);
  });

  it('infers each judging area from the category, with no Area column in the sheet', async () => {
    const rows = toImportInput(importableRows((await previewTemplate()).preview));
    const areaOf = (title: string) => rows.find((row) => row.title.startsWith(title))?.area;
    expect(areaOf('Establish roles')).toBe('core-values');
    expect(areaOf('Brainstorm problems')).toBe('innovation-project');
    expect(areaOf('Sort parts')).toBe('robot-design');
    expect(areaOf('Build mission models')).toBe('robot-game');
  });

  it('keeps the week as a sortable label and maps "Not Started" to the first column', async () => {
    const rows = toImportInput(importableRows((await previewTemplate()).preview));
    // Zero-padded so week-02 sorts before week-10.
    expect(rows[0].labels).toContain('week-01');
    expect(rows.at(-1)?.labels).toContain('week-12');
    expect(rows.every((row) => row.columnId === 'todo')).toBe(true);
  });

  it('stays inside one import', async () => {
    const { preview } = await previewTemplate();
    expect(preview.rows.length).toBeLessThanOrEqual(200);
    expect(preview.truncated).toBe(false);
  });
});
