import standardTaskList from './data/fll-standard-task-list.json' with { type: 'json' };
import type { ProjectCategory } from './kanban.js';

/**
 * The team's standard 12-week FLL plan — the same list the downloadable Excel
 * template is built from (`npm run template:build`) — as the cards a new team's
 * first board starts with. Kept free of runtime imports from `kanban.ts`, which
 * imports this module, so neither side can observe the other half-initialised.
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

/**
 * The template's four categories map one-to-one onto the judging areas, so the
 * dashboard's area progress fills in from the seeded cards. Colors come from the
 * board palette (`COLUMN_COLORS` in `kanban.ts`).
 */
const CATEGORY_DEFINITIONS: Record<string, { id: string; color: string; areaId: string }> = {
  'project mgmt & core values': { id: 'standard-core-values', color: 'pink', areaId: 'core-values' },
  'innovation project': { id: 'standard-innovation-project', color: 'blue', areaId: 'innovation-project' },
  'robot design': { id: 'standard-robot-design', color: 'purple', areaId: 'robot-design' },
  'robot game': { id: 'standard-robot-game', color: 'orange', areaId: 'robot-game' }
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

/** Categories and cards for a fresh board, in the plan's own week-by-week order. */
export function buildStandardPlan(rows: readonly StandardTaskRow[] = (standardTaskList as { rows: StandardTaskRow[] }).rows) {
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
        const known = CATEGORY_DEFINITIONS[key];
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
  return { categories, cards };
}
