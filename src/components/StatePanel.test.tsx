import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatePanel } from './StatePanel';

describe('StatePanel', () => {
  it('calls the supplied action handler', () => {
    const onAction = vi.fn();

    render(
      <StatePanel
        variant="error"
        title="Could not load scores"
        message="Try again."
        actionLabel="Try again"
        onAction={onAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onAction).toHaveBeenCalledOnce();
  });

  it('identifies an action without a handler as an inactive example', () => {
    render(
      <StatePanel
        variant="empty"
        title="No teams yet"
        message="There are no teams."
        actionLabel="Create team"
      />
    );

    expect(screen.queryByRole('button', { name: 'Create team' })).not.toBeInTheDocument();
    expect(screen.getByText(/example action/i)).toHaveTextContent(/create team.*not active/i);
  });

  it('labels a success as done rather than empty', () => {
    render(<StatePanel variant="success" title="Profile saved" message="Your preferences are saved." />);

    expect(screen.getByText('DONE')).toBeInTheDocument();
    expect(screen.queryByText('EMPTY')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('announces errors and moves focus to an explicitly retryable state', () => {
    render(<StatePanel variant="permission" title="Access denied" message="Ask a coach." autoFocus />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('heading', { name: 'Access denied' })).toHaveFocus();
  });
});
