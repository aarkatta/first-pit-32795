import { call } from './callable';
import type { TeamGoal, TrackerTask } from './domain';

/**
 * The dashboard callable returns bounded slices of several collections. These
 * shapes are deliberately partial — the server projects a subset of fields —
 * but they keep the pages layer from casting raw `Record<string, unknown>`.
 */
export type DashboardEvent = {
  id: string;
  teamId: string;
  title: string;
  eventType?: string;
  startsAt?: unknown;
  endsAt?: unknown;
  location?: string;
};

/**
 * One FIRST LEGO League judging area. A task counts toward an area when it
 * carries the area's id as a label, so the importer and the built-in templates
 * tag cards with these ids and a coach can tag any card by hand.
 */
export type DashboardArea = {
  id: string;
  label: string;
  taskCount: number;
  completedTaskCount: number;
};

export type DashboardTask = Partial<TrackerTask> & { id: string; title: string };

export type DashboardNotification = {
  id: string;
  teamId: string;
  title: string;
  body?: string;
  deepLink?: string;
  readAt?: unknown | null;
  createdAt?: unknown;
};

export type DashboardResult = {
  team: { id: string; name: string };
  role: string;
  tasks: DashboardTask[];
  /** Open tasks with a due date, soonest first. Overdue work leads the list. */
  upcomingTasks: DashboardTask[];
  goals: Array<Partial<TeamGoal> & { id: string; title: string }>;
  completedGoals: Array<Partial<TeamGoal> & { id: string; title: string }>;
  areas: DashboardArea[];
  notifications: DashboardNotification[];
  summary: {
    taskCount: number;
    completedTaskCount: number;
    goalCount: number;
    completedGoalCount: number;
    unreadNotificationCount: number;
    unreadSummaryTruncated: boolean;
    unreadSummaryLimit: number;
  };
};


export function getDashboard(teamId: string) {
  return call<{ teamId: string }, DashboardResult>('getDashboard', { teamId });
}

export function requestAccountDeletion() {
  return call<Record<string, never>, { status: 'pending' }>('requestAccountDeletion', {});
}

export function updateProfileSettings(input: { displayName: string; photoURL: string | null; theme: 'light' | 'dark' | 'system'; highContrast: boolean; reducedMotion: boolean; fontScale: 'default' | 'large'; emailNotifications: boolean; pushNotifications: boolean }) {
  return call<typeof input, { userId: string; saved: true; safetyNotifications: true }>('updateProfileSettings', input);
}
