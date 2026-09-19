import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useTeamContext: vi.fn() }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('./TeamHubPage', () => ({ TeamHubPage: ({ children }: { children?: ReactNode }) => <div><p>Team overview</p>{children}<p>Leave and join</p></div> }));
vi.mock('./TeamAdminPage', () => ({ TeamAdminPage: () => <p>Team administration</p> }));

import { ManageTeamPage } from './ManageTeamPage';

function team(role: string) {
  return { status: 'ready', teams: [{ teamId: 'team-1' }], activeTeam: { teamId: 'team-1', role, status: 'active' } };
}

describe('ManageTeamPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['coach', 'teamLeader'])('shows a %s the overview followed by administration, with no tabs', (role) => {
    mocks.useTeamContext.mockReturnValue(team(role));
    render(<ManageTeamPage />);
    expect(screen.getByText('Team overview')).toBeInTheDocument();
    expect(screen.getByText('Team administration')).toBeInTheDocument();
    // Leave this team and Joining another team stay below administration.
    expect(screen.getByText('Team administration').compareDocumentPosition(screen.getByText('Leave and join')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it.each(['student', 'mentor', 'parent'])('shows a %s only the overview', (role) => {
    mocks.useTeamContext.mockReturnValue(team(role));
    render(<ManageTeamPage />);
    expect(screen.getByText('Team overview')).toBeInTheDocument();
    expect(screen.queryByText('Team administration')).not.toBeInTheDocument();
  });

  it('leaves administration out while memberships load or when there is no team', () => {
    mocks.useTeamContext.mockReturnValue({ status: 'loading', teams: [], activeTeam: null });
    const { rerender } = render(<ManageTeamPage />);
    expect(screen.queryByText('Team administration')).not.toBeInTheDocument();
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    rerender(<ManageTeamPage />);
    expect(screen.queryByText('Team administration')).not.toBeInTheDocument();
  });
});
