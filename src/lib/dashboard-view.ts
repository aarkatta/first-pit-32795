import { formatDueDate, toDate } from './dates';
import type { DashboardArea, DashboardResult } from './phase7-service';

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
