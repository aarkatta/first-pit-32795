import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenChild(): ReactElement {
  throw new Error('broken child');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('renders a recovery action when a child throws', () => {
    render(<AppErrorBoundary><BrokenChild /></AppErrorBoundary>);
    expect(screen.getByText(/could not render this screen/i)).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });
});
