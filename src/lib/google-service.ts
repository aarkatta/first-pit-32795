import { call } from './callable';

export type GoogleConnection = {
  connected: boolean;
  email: string | null;
  scopes: string[];
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

export type TeamCalendarSync = {
  teamId: string;
  enabled: boolean;
  calendarId: string | null;
  lastSyncedAt: number | null;
  connectedBy: string | null;
  disabledReason?: string | null;
};

export type GoogleAgendaEvent = {
  googleEventId: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
};

export type SyncResult = {
  teamId: string;
  pulled: number;
  created: number;
  updated: number;
  removed: number;
  pushed: number;
};

/**
 * Returns the consent URL to send the browser to. The state is minted and
 * stored server-side, so the client never constructs an OAuth URL itself.
 */
export function startGoogleOAuth() {
  return call<Record<string, never>, { authUrl: string; expiresInSeconds: number }>('startGoogleOAuth', {});
}

export function getGoogleConnection() {
  return call<Record<string, never>, GoogleConnection>('getGoogleConnection', {});
}

export function disconnectGoogle() {
  return call<Record<string, never>, { connected: false; disabledTeams: number }>('disconnectGoogle', {});
}

export function listGoogleCalendars() {
  return call<Record<string, never>, { calendars: GoogleCalendarSummary[] }>('listGoogleCalendars', {});
}

export function listMyGoogleEvents(input: { calendarId?: string; days?: number } = {}) {
  return call<typeof input, { calendarId: string; events: GoogleAgendaEvent[] }>('listMyGoogleEvents', input);
}

export function getTeamCalendarSync(teamId: string) {
  return call<{ teamId: string }, TeamCalendarSync>('getTeamCalendarSync', { teamId });
}

export function setTeamCalendarSync(input: { teamId: string; calendarId?: string; enabled: boolean }) {
  return call<typeof input, { teamId: string; enabled: boolean; calendarId?: string }>('setTeamCalendarSync', input);
}

export function syncTeamCalendar(teamId: string) {
  return call<{ teamId: string }, SyncResult>('syncTeamCalendar', { teamId });
}

export function setTeamChatLink(input: { teamId: string; chatUrl?: string; label?: string; clear?: boolean }) {
  return call<typeof input, { teamId: string; chatUrl: string | null; label: string | null }>('setTeamChatLink', input);
}

/**
 * Mirrors the server's allowlist so the form can reject a bad link before a
 * round trip. The server check in `requireGoogleChatUrl` is the authoritative
 * one — this is only there to give a faster, clearer error.
 */
export function isGoogleChatUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && ['chat.google.com', 'mail.google.com'].includes(url.hostname);
  } catch {
    return false;
  }
}
