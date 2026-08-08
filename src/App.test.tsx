import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';

describe('AppRoutes', () => {
  it('renders the phase 0 overview', () => {
    render(
      <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /first pit is ready for the first real implementation pass/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /state lab/i })).toBeInTheDocument();
  });

  it('renders the state lab page', () => {
    render(
      <MemoryRouter initialEntries={['/states']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /loading, empty, error, permission, and offline/i })).toBeInTheDocument();
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
  });
});
