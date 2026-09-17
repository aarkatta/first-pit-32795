import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scoreTrendPoints } from '@/lib/dashboard-view';
import { ScoreTrendChart } from './ScoreTrendChart';

const points = scoreTrendPoints([
  { id: 'a', title: 'First practice', scoreType: 'practice', totalPoints: 120, sessionDate: '2026-10-01T15:00:00.000Z' },
  { id: 'b', title: 'Second practice', scoreType: 'practice', totalPoints: 240, sessionDate: '2026-10-08T15:00:00.000Z' },
  { id: 'c', title: 'Qualifier', scoreType: 'match', totalPoints: 310, sessionDate: '2026-10-15T15:00:00.000Z' }
]);

describe('ScoreTrendChart', () => {
  it('labels only the latest value and offers every value as a table', () => {
    render(<ScoreTrendChart points={points} />);
    const chart = screen.getByRole('group', { name: /^Score trend/ });
    expect(within(chart).getByText('310')).toBeInTheDocument();
    expect(within(chart).queryByText('120')).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('First practice')).toBeInTheDocument();
  });

  it('reads sessions with the keyboard and clears the readout on blur', () => {
    render(<ScoreTrendChart points={points} />);
    const chart = screen.getByRole('group', { name: /^Score trend/ });
    fireEvent.focus(chart);
    expect(screen.getByText('310 points, Qualifier, Match, ' + new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(points[2].date))).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByText(/^240 points, Second practice, Practice/)).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByText(/^120 points, First practice/)).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByText(/^310 points/)).toBeInTheDocument();
    fireEvent.blur(chart);
    expect(screen.queryByText(/points, /)).not.toBeInTheDocument();
  });

  it('renders a single session without a line area', () => {
    const { container } = render(<ScoreTrendChart points={points.slice(0, 1)} />);
    expect(container.querySelector('.trend-chart__area')).toBeNull();
    expect(container.querySelectorAll('.trend-chart__dot')).toHaveLength(1);
  });

  it('renders nothing without sessions', () => {
    const { container } = render(<ScoreTrendChart points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
