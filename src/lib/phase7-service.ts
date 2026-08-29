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

export type DashboardScore = {
  id: string;
  teamId: string;
  totalPoints?: number;
  sessionType?: string;
  recordedAt?: unknown;
};

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
  tasks: Array<Partial<TrackerTask> & { id: string; title: string }>;
  goals: Array<Partial<TeamGoal> & { id: string; title: string }>;
  events: DashboardEvent[];
  scores: DashboardScore[];
  notifications: DashboardNotification[];
  summary: {
    taskCount: number;
    completedTaskCount: number;
    goalCount: number;
    upcomingEventCount: number;
    scoreCount: number;
    unreadNotificationCount: number;
    unreadMessageCount: number;
    announcementCount: number;
    unreadSummaryTruncated: boolean;
    unreadSummaryLimit: number;
  };
};

export type GlobalSearchResult = {
  type: string;
  teamId: string;
  recordId: string;
  title: string;
  snippet: string;
  deepLink: string;
};


export function getDashboard(teamId: string) {
  return call<{ teamId: string }, DashboardResult>('getDashboard', { teamId });
}

export function globalSearch(input: { query: string; teamId?: string }) {
  return call<typeof input, { query: string; results: GlobalSearchResult[]; teamIds: string[] }>('globalSearch', input);
}

export function requestAccountDeletion() {
  return call<Record<string, never>, { status: 'pending' }>('requestAccountDeletion', {});
}

export function updateProfileSettings(input: { displayName: string; photoURL: string | null; theme: 'light' | 'dark' | 'system'; highContrast: boolean; reducedMotion: boolean; fontScale: 'default' | 'large'; emailNotifications: boolean; pushNotifications: boolean; isMinor?: boolean }) {
  return call<typeof input, { userId: string; saved: true; safetyNotifications: true }>('updateProfileSettings', input);
}
