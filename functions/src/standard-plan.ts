import fllTaskList from './data/fll-standard-task-list.json' with { type: 'json' };
import ftcTaskList from './data/ftc-standard-task-list.json' with { type: 'json' };
import type { ProjectCategory } from './kanban.js';
import type { TeamProgram } from './programs.js';

/**
 * A program's standard season plan — the 12-week FLL plan or the 8-week FTC
 * one, the same lists the downloadable Excel templates are built from
 * (`npm run template:build`) — as the cards a new team's first board starts
 * with. Kept free of runtime imports from `kanban.ts`, which imports this
 * module, so neither side can observe the other half-initialised.
 */

type StandardTaskRow = {
  taskId: string;
  week: number;
  category: string;
  title: string;
  status: string;
  notes?: string;
};

export type StandardPlanCard = {
  title: string;
  description: string;
  categoryId: string | null;
  labels: string[];
};

type CategoryDefinition = { id: string; color: string; areaId: string | null };

/**
 * Each template category maps onto one of its program's dashboard areas
 * (`PROGRAM_AREAS` in `programs.ts`), so area progress fills in from the
 * seeded cards; FTC's "General" is the one category with no area. The order
 * here is the board's category order. Colors come from the board palette
 * (`COLUMN_COLORS` in `kanban.ts`).
 */
const CATEGORY_DEFINITIONS: Record<TeamProgram, Record<string, CategoryDefinition>> = {
  fll: {
    'project mgmt & core values': { id: 'standard-core-values', color: 'pink', areaId: 'core-values' },
    'innovation project': { id: 'standard-innovation-project', color: 'blue', areaId: 'innovation-project' },
    'robot design': { id: 'standard-robot-design', color: 'purple', areaId: 'robot-design' },
    'robot game': { id: 'standard-robot-game', color: 'orange', areaId: 'robot-game' }
  },
  ftc: {
    think: { id: 'standard-ftc-think', color: 'green', areaId: 'think' },
    control: { id: 'standard-ftc-control', color: 'blue', areaId: 'control' },
    design: { id: 'standard-ftc-design', color: 'purple', areaId: 'design' },
    innovate: { id: 'standard-ftc-innovate', color: 'orange', areaId: 'innovate' },
    connect: { id: 'standard-ftc-connect', color: 'pink', areaId: 'connect' },
    sustain: { id: 'standard-ftc-sustain', color: 'green', areaId: 'sustain' },
    reach: { id: 'standard-ftc-reach', color: 'orange', areaId: 'reach' },
    general: { id: 'standard-ftc-general', color: 'slate', areaId: null }
  }
};

const TASK_LISTS: Record<TeamProgram, readonly StandardTaskRow[]> = {
  fll: (fllTaskList as { rows: StandardTaskRow[] }).rows,
  ftc: (ftcTaskList as { rows: StandardTaskRow[] }).rows
};

const FALLBACK_COLORS = ['slate', 'green', 'blue', 'purple', 'orange', 'pink'];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'category';
}

/** Same `week-01` form the spreadsheet importer writes, so both paths group alike. */
export function standardWeekLabel(week: unknown): string | null {
  const value = Number(week);
  if (!Number.isInteger(value) || value < 1 || value > 99) return null;
  return `week-${String(value).padStart(2, '0')}`;
}

/** Categories and cards for a fresh board, the cards in the plan's own week-by-week order. */
export function buildStandardPlan(program: TeamProgram = 'fll', rows: readonly StandardTaskRow[] = TASK_LISTS[program]) {
  const definitions = CATEGORY_DEFINITIONS[program];
  const categories: ProjectCategory[] = [];
  const byName = new Map<string, ProjectCategory>();
  const cards: StandardPlanCard[] = [];
  for (const row of rows) {
    const name = String(row.category ?? '').trim();
    let category: ProjectCategory | null = null;
    if (name) {
      const key = name.toLowerCase();
      category = byName.get(key) ?? null;
      if (!category) {
        // A category added to the list later still seeds, just without an area.
        const known = definitions[key];
        category = {
          id: known?.id ?? `standard-${slug(name)}`,
          name: name.slice(0, 60),
          color: known?.color ?? FALLBACK_COLORS[categories.length % FALLBACK_COLORS.length],
          areaId: known?.areaId ?? null,
          goalId: null
        };
        byName.set(key, category);
        categories.push(category);
      }
    }
    const week = standardWeekLabel(row.week);
    cards.push({
      title: String(row.title).trim().slice(0, 160),
      description: String(row.notes ?? '').trim().slice(0, 4000),
      categoryId: category?.id ?? null,
      // The area label leads: the dashboard counts it.
      labels: [...(category?.areaId ? [category.areaId] : []), ...(week ? [week] : [])]
    });
  }
  // Known categories in their defined order, then any the list added later.
  const rank = Object.keys(definitions);
  const position = (category: ProjectCategory) => {
    const index = rank.indexOf(category.name.toLowerCase());
    return index < 0 ? rank.length : index;
  };
  categories.sort((a, b) => position(a) - position(b));
  return { categories, cards };
}
