import { formatDueDate, toDate } from './dates';
import type { DashboardArea, DashboardResult } from './phase7-service';
import { AREA_GROUP_HEADINGS, type AreaGroup } from './programs';

/**
 * Pure derivations for the dashboard page. The callable returns bounded raw
 * slices; everything that turns them into percentages and highlight copy
 * lives here so it is unit-tested rather than buried in JSX.
 */

export function percentOf(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, done / total)) * 100);
}

export type AreaRow = DashboardArea & { percent: number };

export function areaRows(areas: DashboardArea[] | undefined): AreaRow[] {
  return (areas ?? []).map((area) => ({ ...area, percent: percentOf(area.completedTaskCount, area.taskCount) }));
}

export type AreaGroupSection = { group: AreaGroup; heading: string; areas: AreaRow[] };

/**
 * FTC's awards come in groups (Think stands alone; Control, Design and
 * Innovate are the MCI awards; Connect, Sustain and Reach the Team Attribute
 * awards). FLL's areas have no group, so they all come back standalone and the
 * dashboard draws them as it always has.
 */
export function groupAreas(rows: AreaRow[]): { standalone: AreaRow[]; groups: AreaGroupSection[] } {
  const groups: AreaGroupSection[] = [];
  const standalone: AreaRow[] = [];
  for (const row of rows) {
    const group = row.group && row.group in AREA_GROUP_HEADINGS ? row.group : null;
    if (!group) {
      standalone.push(row);
      continue;
    }
    let section = groups.find((entry) => entry.group === group);
    if (!section) {
      section = { group, heading: AREA_GROUP_HEADINGS[group], areas: [] };
      groups.push(section);
    }
    section.areas.push(row);
  }
  return { standalone, groups };
}

export type Highlight = { id: string; title: string; detail: string };

/**
 * "Top achievements" is derived, never stored: the milestones the team has
 * finished most recently. Nothing here is invented when the team has no data —
 * an empty list renders the empty state.
 */
export function dashboardHighlights(dashboard: Pick<DashboardResult, 'completedGoals'>, limit = 4): Highlight[] {
  return (dashboard.completedGoals ?? []).slice(0, limit).map((goal) => ({
    id: `goal:${goal.id}`,
    title: goal.title || 'Milestone',
    detail: `Milestone achieved${toDate(goal.updatedAt) ? ` · ${formatDueDate(toDate(goal.updatedAt))}` : ''}`
  }));
}
