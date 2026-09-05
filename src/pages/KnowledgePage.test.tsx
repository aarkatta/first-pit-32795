import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PollListItem } from '@/lib/phase5-service';
import { KnowledgeTargetMismatch, PollCard } from './KnowledgePage';

const poll: PollListItem = {
  id: 'poll-1',
  teamId: 'team-1',
  visibility: 'team',
  createdBy: 'coach-1',
  question: 'Which mission next?',
  options: [{ id: 'option-1', label: 'Blue mission' }, { id: 'option-2', label: 'Red mission' }],
  selection: 'single',
  anonymous: true,
  audienceRoles: ['student'],
  resultsVisibility: 'afterClose',
  resultsVisible: false,
  expiresAt: null,
  status: 'open'
};

describe('PollCard protected results', () => {
  it('does not render hidden aggregates', () => {
    render(<PollCard poll={poll} result={null} busy={false} canManage={false} submitted={false} onClose={vi.fn()} onVote={vi.fn()} onResults={vi.fn()} />);
    expect(screen.getByText(/results are hidden/i)).toBeInTheDocument();
    expect(screen.queryByText(/authorized vote/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /results/i })).not.toBeInTheDocument();
  });

  it('renders authorized option totals and disables a submitted vote', () => {
    render(<PollCard poll={{ ...poll, resultsVisible: true }} result={{ totalVotes: 3, optionVoteCounts: { 'option-1': 2, 'option-2': 1 }, anonymous: true }} busy={false} canManage={false} submitted onClose={vi.fn()} onVote={vi.fn()} onResults={vi.fn()} />);
    expect(screen.getByText('3 authorized votes')).toBeInTheDocument();
    expect(screen.getByText('Blue mission: 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote submitted' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /refresh authorized results/i }));
  });
});

describe('Knowledge direct-target context', () => {
  it('shows a clear team mismatch without offering an automatic switch', () => {
    render(<KnowledgeTargetMismatch targetType="question" />);
    expect(screen.getByText('Linked question belongs to another team')).toBeInTheDocument();
    expect(screen.getByText(/active team was not changed automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
