import { formatDueDate, toDate } from './dates';
import type { DashboardArea, DashboardResult, DashboardScore } from './phase7-service';

/**
 * Pure derivations for the dashboard page. The callable returns bounded raw
 * slices; everything that turns them into percentages, chart geometry, and
 * highlight copy lives here so it is unit-tested rather than buried in JSX.
 */

export function percentOf(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, done / total)) * 100);
}

export type AreaRow = DashboardArea & { percent: number };

export function areaRows(areas: DashboardArea[] | undefined): AreaRow[] {
  return (areas ?? []).map((area) => ({ ...area, percent: percentOf(area.completedTaskCount, area.taskCount) }));
}

export type TrendPoint = {
  id: string;
  date: Date;
  points: number;
  title: string;
  scoreType: 'practice' | 'match';
};

/** Sessions in chronological order; a session without a usable date or total is skipped. */
export function scoreTrendPoints(scores: DashboardScore[] | undefined): TrendPoint[] {
  return (scores ?? [])
    .map((score) => ({ score, date: toDate(score.sessionDate) }))
    .filter((entry): entry is { score: DashboardScore; date: Date } => Boolean(entry.date) && Number.isFinite(entry.score.totalPoints))
    .map(({ score, date }) => ({
      id: score.id,
      date,
      points: Math.max(0, Number(score.totalPoints)),
      title: score.title || (score.scoreType === 'match' ? 'Match session' : 'Practice session'),
      scoreType: score.scoreType === 'match' ? 'match' as const : 'practice' as const
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Rounds an axis ceiling up to 1, 2, 2.5, or 5 × 10ⁿ so ticks land on clean numbers. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

export function axisTicks(ceiling: number, intervals = 4): number[] {
  return Array.from({ length: intervals + 1 }, (_, index) => Math.round((ceiling / intervals) * index));
}

export type Highlight = { id: string; kind: 'score' | 'goal'; title: string; detail: string };

function bestOf(points: TrendPoint[], scoreType: TrendPoint['scoreType']) {
  return points
    .filter((point) => point.scoreType === scoreType)
    .reduce<TrendPoint | null>((best, point) => (!best || point.points > best.points ? point : best), null);
}

/**
 * "Top achievements" is derived, never stored: the best recent match and
 * practice runs, then goals the team has finished. Nothing here is invented
 * when the team has no data — an empty list renders the empty state.
 */
export function dashboardHighlights(dashboard: Pick<DashboardResult, 'scores' | 'completedGoals'>, limit = 4): Highlight[] {
  const points = scoreTrendPoints(dashboard.scores);
  const highlights: Highlight[] = [];
  for (const [scoreType, label] of [['match', 'Best recent match'], ['practice', 'Best recent practice']] as const) {
    const best = bestOf(points, scoreType);
    if (best) highlights.push({ id: `score:${best.id}`, kind: 'score', title: `${best.points} pts · ${label}`, detail: `${best.title} · ${formatDueDate(best.date)}` });
  }
  for (const goal of dashboard.completedGoals ?? []) {
    highlights.push({ id: `goal:${goal.id}`, kind: 'goal', title: goal.title || 'Milestone', detail: `Milestone achieved${toDate(goal.updatedAt) ? ` · ${formatDueDate(toDate(goal.updatedAt))}` : ''}` });
  }
  return highlights.slice(0, limit);
}

export type ChartGeometry = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  ceiling: number;
  ticks: Array<{ value: number; y: number }>;
  points: Array<TrendPoint & { x: number; y: number }>;
  linePath: string;
  areaPath: string;
};

/**
 * Lays sessions out evenly along x (sessions are irregular in time, and even
 * spacing keeps a burst of same-week practice runs from overlapping), with y
 * on a zero-based clean-number scale.
 */
export function trendGeometry(points: TrendPoint[], width: number, height: number): ChartGeometry {
  const plot = { left: 40, right: Math.max(41, width - 16), top: 12, bottom: Math.max(13, height - 26) };
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.points)));
  const yFor = (value: number) => plot.bottom - (value / ceiling) * (plot.bottom - plot.top);
  const span = plot.right - plot.left;
  const placed = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? plot.left + span / 2 : plot.left + (span * index) / (points.length - 1),
    y: yFor(point.points)
  }));
  const linePath = placed.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const areaPath = placed.length > 1
    ? `${linePath} L${placed[placed.length - 1].x.toFixed(1)},${plot.bottom} L${placed[0].x.toFixed(1)},${plot.bottom} Z`
    : '';
  return {
    width,
    height,
    plot,
    ceiling,
    ticks: axisTicks(ceiling).map((value) => ({ value, y: yFor(value) })),
    points: placed,
    linePath,
    areaPath
  };
}

/** Index of the plotted point nearest an x position — the crosshair snaps to it. */
export function nearestPointIndex(points: Array<{ x: number }>, x: number): number {
  if (!points.length) return -1;
  return points.reduce((nearest, point, index) => (Math.abs(point.x - x) < Math.abs(points[nearest].x - x) ? index : nearest), 0);
}
