import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDueDate } from '@/lib/dates';
import { nearestPointIndex, trendGeometry, type TrendPoint } from '@/lib/dashboard-view';

const CHART_HEIGHT = 220;
const DEFAULT_WIDTH = 640;
const TOOLTIP_FLIP_MARGIN = 170;

function typeLabel(point: TrendPoint) {
  return point.scoreType === 'match' ? 'Match' : 'Practice';
}

/**
 * Single-series line chart of session totals. Hovering or arrowing through the
 * chart moves a crosshair that snaps to the nearest session; every value is
 * also in the table under the chart, so the tooltip never gates a number.
 */
export function ScoreTrendChart({ points }: { points: TrendPoint[] }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => {
      if (frame.clientWidth > 0) setWidth(Math.round(frame.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const geometry = trendGeometry(points, width, CHART_HEIGHT);
  const { plot } = geometry;
  const lastIndex = geometry.points.length - 1;
  const last = geometry.points[lastIndex];
  const active = activeIndex === null ? null : geometry.points[activeIndex] ?? null;
  const axisPoints = geometry.points.length > 2
    ? [geometry.points[0], geometry.points[Math.floor(lastIndex / 2)], last]
    : geometry.points;

  function track(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    setActiveIndex(nearestPointIndex(geometry.points, ((event.clientX - bounds.left) / bounds.width) * geometry.width));
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const current = activeIndex ?? lastIndex;
    const next = event.key === 'ArrowLeft' ? current - 1
      : event.key === 'ArrowRight' ? current + 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? lastIndex
            : null;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(Math.min(lastIndex, Math.max(0, next)));
  }

  if (!last) return null;

  return (
    <div className="trend-chart">
      <div className="trend-chart__frame" ref={frameRef}>
        <svg
          width={geometry.width}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${geometry.width} ${CHART_HEIGHT}`}
          role="group"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={track}
          onPointerLeave={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex((current) => current ?? lastIndex)}
          onBlur={() => setActiveIndex(null)}
          onKeyDown={step}
        >
          <title id={titleId}>Score trend. Use the left and right arrow keys to read each session.</title>
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line className="trend-chart__grid" x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />
              <text className="trend-chart__tick" x={plot.left - 8} y={tick.y} textAnchor="end" dominantBaseline="middle">{tick.value.toLocaleString()}</text>
            </g>
          ))}
          {axisPoints.map((point, index) => (
            <text
              key={point.id}
              className="trend-chart__tick"
              x={point.x}
              y={CHART_HEIGHT - 6}
              textAnchor={axisPoints.length === 1 ? 'middle' : index === 0 ? 'start' : point === last ? 'end' : 'middle'}
            >
              {formatDueDate(point.date)}
            </text>
          ))}
          {geometry.areaPath ? <path className="trend-chart__area" d={geometry.areaPath} /> : null}
          <path className="trend-chart__line" d={geometry.linePath} />
          {active ? <line className="trend-chart__crosshair" x1={active.x} x2={active.x} y1={plot.top} y2={plot.bottom} /> : null}
          <circle className="trend-chart__dot" cx={last.x} cy={last.y} r={4} />
          <text className="trend-chart__value" x={last.x - 8} y={last.y < plot.top + 16 ? last.y + 18 : last.y - 10} textAnchor="end">{last.points.toLocaleString()}</text>
          {active && active !== last ? <circle className="trend-chart__dot" cx={active.x} cy={active.y} r={4} /> : null}
        </svg>
        {active ? (
          <div
            className={`trend-tooltip${active.x > geometry.width - TOOLTIP_FLIP_MARGIN ? ' trend-tooltip--flip' : ''}`}
            style={{ left: active.x, top: active.y }}
            aria-hidden="true"
          >
            <strong>{active.points.toLocaleString()} pts</strong>
            <span>{active.title}</span>
            <small>{typeLabel(active)} · {formatDueDate(active.date)}</small>
          </div>
        ) : null}
      </div>
      <p className="dash-sr-only" aria-live="polite">
        {active ? `${active.points} points, ${active.title}, ${typeLabel(active)}, ${formatDueDate(active.date)}` : ''}
      </p>
      <details className="trend-table">
        <summary>Show as a table</summary>
        <table className="score-table">
          <thead><tr><th scope="col">Session</th><th scope="col">Type</th><th scope="col">Date</th><th scope="col" className="num">Points</th></tr></thead>
          <tbody>
            {geometry.points.map((point) => (
              <tr key={point.id}><td>{point.title}</td><td>{typeLabel(point)}</td><td>{formatDueDate(point.date)}</td><td className="num">{point.points.toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
