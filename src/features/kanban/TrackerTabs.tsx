import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * The tracker is one place with five views: the board, the same work by date,
 * the milestones above it, the spreadsheet import that fills it, and the setup
 * behind it. They are
 * separate routes so each keeps its own deep links and loads only its own data,
 * but they read as tabs of one screen rather than four sidebar destinations.
 */
export type TrackerTab = 'board' | 'calendar' | 'milestones' | 'import' | 'setup';

const TABS: Array<{ id: TrackerTab; to: string; label: string; coachOnly?: boolean }> = [
  { id: 'board', to: '/coordination', label: 'Board' },
  { id: 'calendar', to: '/calendar', label: 'Calendar' },
  { id: 'milestones', to: '/milestones', label: 'Milestones' },
  { id: 'import', to: '/import', label: 'Import tasks', coachOnly: true },
  { id: 'setup', to: '/board-setup', label: 'Board setup', coachOnly: true }
];

export function TrackerTabs({ canManage, children }: { canManage: boolean; children: ReactNode }) {
  const visible = TABS.filter((tab) => !tab.coachOnly || canManage);
  return (
    <div className="reference-page monday">
      <nav className="mb-views tracker-tabs" aria-label="Tracker views">
        {visible.map((tab) => (
          <NavLink key={tab.id} to={tab.to} className={({ isActive }) => (isActive ? 'is-active' : '')} end>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
