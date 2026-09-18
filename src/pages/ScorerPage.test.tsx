import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_SCORESHEET_URL, ScorerPage } from './ScorerPage';

describe('ScorerPage', () => {
  it('links to the official FIRST scoresheet in a new tab', () => {
    render(<ScorerPage />);
    const link = screen.getByRole('link', { name: /official scoresheet/i });
    expect(link).toHaveAttribute('href', OFFICIAL_SCORESHEET_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('announces manage scoring as coming soon, with no controls yet', () => {
    render(<ScorerPage />);
    expect(screen.getByRole('heading', { name: 'Manage scoring' })).toBeInTheDocument();
    expect(screen.getByText(/this feature is coming soon/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
