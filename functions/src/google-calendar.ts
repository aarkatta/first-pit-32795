import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  auditRecord,
  getInput,
  requireAuth,
  requireString,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember
} from './phase2.js';

export type GoogleRequest = CallableRequest<Record<string, unknown>>;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * `calendar.events` is the narrowest scope that still allows the two-way sync
 * this feature promises. `calendar.readonly` would cover the display half only.
 * `openid`/`email` identify which Google account was connected so the UI can
 * show it and a coach can tell two accounts apart.
 */
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
] as const;

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const MAX_SYNC_EVENTS_PER_RUN = 250;
export const MAX_TEAMS_PER_SCHEDULED_RUN = 50;
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;

/** Window pulled on a first (full) sync. Sync tokens carry the window afterwards. */
export const FULL_SYNC_PAST_DAYS = 30;
export const FULL_SYNC_FUTURE_DAYS = 365;

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * Read at call time rather than module load so the emulator and unit tests can
 * set the values per case, and so a missing configuration surfaces as a typed
 * `failed-precondition` on the one callable that needs it instead of crashing
 * every function in the deployment at cold start.
 */
export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '').trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpsError('failed-precondition', 'Google Calendar is not configured for this deployment. Ask an administrator to set the Google OAuth credentials.');
  }
  if (!redirectUri.startsWith('https://') && !redirectUri.startsWith('http://127.0.0.1') && !redirectUri.startsWith('http://localhost')) {
    throw new HttpsError('failed-precondition', 'The Google OAuth redirect URI must be HTTPS outside local development.');
  }
  return { clientId, clientSecret, redirectUri };
}

function encryptionKey(): Buffer {
  const raw = (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? '').trim();
  if (raw.length < 16) {
    throw new HttpsError('failed-precondition', 'Google token encryption is not configured for this deployment.');
  }
  return createHash('sha256').update(raw).digest();
}

/**
 * Refresh tokens are long-lived credentials for a person's calendar, so they
 * are encrypted before they reach Firestore. `firestore.rules` already denies
 * every client read of `googleIntegrations`; this is the second layer, so a
 * leaked database export is not a leaked set of Google accounts.
 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [ivPart, tagPart, dataPart] = String(payload).split('.');
  if (!ivPart || !tagPart || !dataPart) throw new HttpsError('internal', 'Stored Google credentials are unreadable.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpsError('internal', 'Stored Google credentials are unreadable.');
  }
}

export function buildAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    // `offline` + `consent` is the only combination that reliably returns a
    // refresh token on a re-authorization; without it a reconnect yields an
    // access token only and the scheduled sync stops working an hour later.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export function toRfc3339(value: unknown): string {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'An event date is invalid.');
  return date.toISOString();
}

export type NormalizedGoogleEvent = {
  googleEventId: string;
  title: string;
  description: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  cancelled: boolean;
  firstPitEventId: string | null;
};

/**
 * Google returns `start.date` for all-day events and `start.dateTime`
 * otherwise. An all-day event is normalized to a midnight-to-midnight span so
 * the rest of the app can treat every event as an instant range.
 */
export function fromGoogleEventResource(resource: Record<string, unknown>): NormalizedGoogleEvent | null {
  const googleEventId = typeof resource.id === 'string' ? resource.id : '';
  if (!googleEventId) return null;
  const cancelled = resource.status === 'cancelled';
  const start = (resource.start ?? {}) as Record<string, unknown>;
  const end = (resource.end ?? {}) as Record<string, unknown>;
  const startRaw = typeof start.dateTime === 'string' ? start.dateTime : typeof start.date === 'string' ? `${start.date}T00:00:00.000Z` : null;
  const endRaw = typeof end.dateTime === 'string' ? end.dateTime : typeof end.date === 'string' ? `${end.date}T00:00:00.000Z` : null;
  const startsAt = startRaw ? new Date(startRaw) : null;
  const endsAt = endRaw ? new Date(endRaw) : null;
  // A cancellation arrives with the id and status only, so it must survive the
  // missing-dates check below — it is a deletion instruction, not an event.
  if (!cancelled && (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))) return null;
  const extended = (resource.extendedProperties ?? {}) as Record<string, unknown>;
  const priv = (extended.private ?? {}) as Record<string, unknown>;
  const updatedRaw = typeof resource.updated === 'string' ? new Date(resource.updated) : new Date(0);
  return {
    googleEventId,
    title: typeof resource.summary === 'string' && resource.summary.trim() ? resource.summary.trim().slice(0, 160) : 'Untitled event',
    description: typeof resource.description === 'string' ? resource.description.slice(0, 4000) : '',
    location: typeof resource.location === 'string' && resource.location.trim() ? resource.location.trim().slice(0, 240) : null,
    startsAt: startsAt ?? new Date(0),
    endsAt: endsAt ?? new Date(0),
    updatedAt: Number.isNaN(updatedRaw.getTime()) ? new Date(0) : updatedRaw,
    cancelled,
    firstPitEventId: typeof priv.firstPitEventId === 'string' ? priv.firstPitEventId : null
  };
}

export function toGoogleEventResource(event: DocumentData, teamId: string): Record<string, unknown> {
  return {
    summary: String(event.title ?? 'Untitled event').slice(0, 160),
    description: event.description ? String(event.description).slice(0, 4000) : undefined,
    location: event.location ? String(event.location).slice(0, 240) : undefined,
    start: { dateTime: toRfc3339(event.startsAt) },
    end: { dateTime: toRfc3339(event.endsAt) },
    // The correlation key. It is what stops a pushed event from being pulled
    // back in as a second, duplicate First Pit event on the next sync.
    extendedProperties: { private: { firstPitEventId: String(event.id), firstPitTeamId: teamId } }
  };
}

/**
 * Last-writer-wins, resolved on Google's own `updated` stamp rather than local
 * clock time. `googleSyncedAt` records the remote version already applied, so a
 * remote change is applied only when Google reports something strictly newer.
 * This is what prevents the echo loop: our own push updates `googleSyncedAt` to
 * the value Google returns, so the next pull sees nothing new.
 */
export function shouldApplyRemoteChange(remoteUpdated: Date, lastSynced: unknown): boolean {
  const applied = lastSynced instanceof Timestamp ? lastSynced.toMillis() : lastSynced instanceof Date ? lastSynced.getTime() : 0;
  return remoteUpdated.getTime() > applied;
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // `invalid_grant` means the person revoked access or changed their password.
    // That is a reconnect prompt, not a server fault, so it must not be a 500.
    const code = String(payload.error ?? '');
    if (code === 'invalid_grant') throw new HttpsError('failed-precondition', 'The Google account connection expired. Reconnect Google Calendar.');
    throw new HttpsError('unavailable', 'Google rejected the authorization request.');
  }
  return payload;
}

type Integration = { userId: string; refreshToken: string; accessToken: string | null; accessTokenExpiresAt: number };

async function loadIntegration(userId: string): Promise<Integration> {
  const snapshot = await getFirestore().doc(`googleIntegrations/${userId}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data?.refreshToken) {
    throw new HttpsError('failed-precondition', 'Connect a Google account before using Google Calendar.');
  }
  const key = encryptionKey();
  return {
    userId,
    refreshToken: decryptSecret(String(data.refreshToken), key),
    accessToken: data.accessToken ? decryptSecret(String(data.accessToken), key) : null,
    accessTokenExpiresAt: Number(data.accessTokenExpiresAt ?? 0)
  };
}

/**
 * Returns a live access token, refreshing and caching it when the stored one is
 * within a minute of expiry. Caching matters: the scheduled sync would
 * otherwise mint a new token per team per run.
 */
async function accessTokenFor(userId: string): Promise<string> {
  const integration = await loadIntegration(userId);
  if (integration.accessToken && integration.accessTokenExpiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS) {
    return integration.accessToken;
  }
  const config = googleOAuthConfig();
  const payload = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: integration.refreshToken,
    grant_type: 'refresh_token'
  });
  const accessToken = String(payload.access_token ?? '');
  if (!accessToken) throw new HttpsError('unavailable', 'Google did not return an access token.');
  const expiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;
  const key = encryptionKey();
  await getFirestore().doc(`googleIntegrations/${userId}`).set({
    accessToken: encryptSecret(accessToken, key),
    accessTokenExpiresAt: expiresAt,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return accessToken;
}

export type CalendarResponse = { ok: boolean; status: number; body: Record<string, unknown> };

async function calendarFetch(userId: string, path: string, init: RequestInit = {}): Promise<CalendarResponse> {
  const token = await accessTokenFor(userId);
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
  const text = await response.text();
  const body = text ? ((JSON.parse(text) as Record<string, unknown>) ?? {}) : {};
  return { ok: response.ok, status: response.status, body };
}

function assertCalendarOk(result: CalendarResponse, action: string): Record<string, unknown> {
  if (result.ok) return result.body;
  if (result.status === 401 || result.status === 403) {
    throw new HttpsError('permission-denied', `Google denied access while ${action}. Reconnect Google Calendar and confirm the calendar permission.`);
  }
  if (result.status === 404) throw new HttpsError('not-found', `The Google calendar was not found while ${action}.`);
  if (result.status === 429 || result.status >= 500) throw new HttpsError('unavailable', `Google Calendar is temporarily unavailable while ${action}.`);
  throw new HttpsError('internal', `Google Calendar rejected the request while ${action}.`);
}

export function requireCalendarId(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'A calendar ID is required.');
  const calendarId = value.trim();
  if (!calendarId || calendarId.length > 320 || calendarId.includes('/') || calendarId.includes('..')) {
    throw new HttpsError('invalid-argument', 'The calendar ID is invalid.');
  }
  return calendarId;
}

// ---------------------------------------------------------------------------
// OAuth lifecycle
// ---------------------------------------------------------------------------

export const startGoogleOAuth = async (request: GoogleRequest) => {
  const auth = requireAuth(request);
  const config = googleOAuthConfig();
  const db = getFirestore();
  const state = randomBytes(32).toString('base64url');
  // The state doc is the CSRF defence and the only place the callback learns
  // which signed-in user began the flow — the callback itself is unauthenticated.
  await db.doc(`googleOAuthStates/${state}`).set({
    state,
    userId: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + OAUTH_STATE_TTL_MS)
  });
  return { authUrl: buildAuthUrl(config, state), expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000) };
};

/**
 * Completes the OAuth handshake. Called by the `/google/oauth/callback` HTTP
 * route, which is public by necessity — Google redirects a browser to it — so
 * every trust decision here rests on the single-use `state` document.
 */
export async function completeGoogleOAuth(code: string, state: string): Promise<{ userId: string; email: string }> {
  const config = googleOAuthConfig();
  const db = getFirestore();
  const stateRef = db.doc(`googleOAuthStates/${state}`);
  const stateSnapshot = await stateRef.get();
  const stateData = stateSnapshot.data();
  if (!stateSnapshot.exists || !stateData) throw new HttpsError('permission-denied', 'This Google authorization link is not valid.');
  const expiresAt = stateData.expiresAt instanceof Timestamp ? stateData.expiresAt.toMillis() : 0;
  if (expiresAt < Date.now()) {
    await stateRef.delete();
    throw new HttpsError('deadline-exceeded', 'This Google authorization link expired. Start again.');
  }
  const userId = String(stateData.userId ?? '');
  if (!userId) throw new HttpsError('permission-denied', 'This Google authorization link is not valid.');
  // Single use: consumed before the token exchange so a replayed callback
  // cannot mint a second set of credentials.
  await stateRef.delete();

  const payload = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri
  });
  const refreshToken = String(payload.refresh_token ?? '');
  const accessToken = String(payload.access_token ?? '');
  if (!refreshToken) {
    throw new HttpsError('failed-precondition', 'Google did not return a refresh token. Remove First Pit from your Google account permissions and connect again.');
  }

  let email = '';
  const profile = await fetch(USERINFO_ENDPOINT, { headers: { authorization: `Bearer ${accessToken}` } })
    .then(async (response) => (response.ok ? ((await response.json()) as Record<string, unknown>) : {}))
    .catch(() => ({} as Record<string, unknown>));
  if (typeof profile.email === 'string') email = profile.email;

  const key = encryptionKey();
  await db.doc(`googleIntegrations/${userId}`).set({
    userId,
    email,
    refreshToken: encryptSecret(refreshToken, key),
    accessToken: accessToken ? encryptSecret(accessToken, key) : null,
    accessTokenExpiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    scopes: String(payload.scope ?? ''),
    connectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('auditEvents').doc().set(auditRecord({
    type: 'sensitive.updated',
    actorUserId: userId,
    targetResource: `googleIntegrations/${userId}`,
    metadata: { action: 'google.connected' }
  }));
  return { userId, email };
}

export const getGoogleConnection = async (request: GoogleRequest) => {
  const auth = requireAuth(request);
  const snapshot = await getFirestore().doc(`googleIntegrations/${auth.uid}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data?.refreshToken) return { connected: false as const, email: null, scopes: [] as string[] };
  return {
    connected: true as const,
    email: typeof data.email === 'string' ? data.email : null,
    scopes: String(data.scopes ?? '').split(' ').filter(Boolean)
  };
};

export const disconnectGoogle = async (request: GoogleRequest) => {
  const auth = requireAuth(request);
  const db = getFirestore();
  const ref = db.doc(`googleIntegrations/${auth.uid}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (snapshot.exists && data?.refreshToken) {
    // Best effort: revoking at Google is courteous but the local delete is what
    // actually ends First Pit's access, so a revoke failure must not block it.
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptSecret(String(data.refreshToken), encryptionKey()) }).toString()
    }).catch(() => undefined);
  }
  await ref.delete();
  // Any team whose sync ran on this account must stop, or the next scheduled
  // run would fail repeatedly against credentials that no longer exist.
  const owned = await db.collection('googleCalendarSync').where('userId', '==', auth.uid).limit(100).get();
  await Promise.all(owned.docs.map((doc) => doc.ref.set({ enabled: false, disabledReason: 'disconnected', updatedAt: FieldValue.serverTimestamp() }, { merge: true })));
  await db.collection('auditEvents').doc().set(auditRecord({
    type: 'sensitive.updated',
    actorUserId: auth.uid,
    targetResource: `googleIntegrations/${auth.uid}`,
    metadata: { action: 'google.disconnected' }
  }));
  return { connected: false as const, disabledTeams: owned.size };
};

export const listGoogleCalendars = async (request: GoogleRequest) => {
  const auth = requireAuth(request);
  const body = assertCalendarOk(await calendarFetch(auth.uid, '/users/me/calendarList?maxResults=100&minAccessRole=writer'), 'listing your calendars');
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    calendars: items.map((item) => {
      const calendar = item as Record<string, unknown>;
      return {
        id: String(calendar.id ?? ''),
        summary: String(calendar.summary ?? 'Untitled calendar'),
        primary: calendar.primary === true,
        accessRole: String(calendar.accessRole ?? '')
      };
    }).filter((calendar) => calendar.id)
  };
};

// ---------------------------------------------------------------------------
// Team calendar link
// ---------------------------------------------------------------------------

export const setTeamCalendarSync = async (request: GoogleRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const enabled = getInput(request, 'enabled') !== false;
  const db = getFirestore();
  const ref = db.doc(`googleCalendarSync/${teamId}`);
  if (!enabled) {
    await ref.set({ teamId, enabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection('auditEvents').doc().set(auditRecord({
      type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `googleCalendarSync/${teamId}`, metadata: { action: 'google.sync.disabled' }
    }));
    return { teamId, enabled: false as const };
  }
  const calendarId = requireCalendarId(getInput(request, 'calendarId'));
  // Proves the connected account can actually write here before the team starts
  // depending on it, rather than failing silently on the first scheduled run.
  assertCalendarOk(await calendarFetch(admin.uid, `/calendars/${encodeURIComponent(calendarId)}`), 'checking that calendar');
  const existing = await ref.get();
  await ref.set({
    teamId,
    userId: admin.uid,
    calendarId,
    enabled: true,
    disabledReason: null,
    // A calendar or account change invalidates the stored cursor; keeping it
    // would silently skip everything already in the new calendar.
    syncToken: existing.data()?.calendarId === calendarId && existing.data()?.userId === admin.uid ? existing.data()?.syncToken ?? null : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('auditEvents').doc().set(auditRecord({
    type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `googleCalendarSync/${teamId}`, metadata: { action: 'google.sync.enabled' }
  }));
  return { teamId, enabled: true as const, calendarId };
};

export const getTeamCalendarSync = async (request: GoogleRequest) => {
  const teamId = requireTeamId(request);
  await requireTeamMember(request, teamId);
  const snapshot = await getFirestore().doc(`googleCalendarSync/${teamId}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data) return { teamId, enabled: false as const, calendarId: null, lastSyncedAt: null, connectedBy: null };
  return {
    teamId,
    enabled: data.enabled === true,
    calendarId: typeof data.calendarId === 'string' ? data.calendarId : null,
    lastSyncedAt: data.lastSyncedAt instanceof Timestamp ? data.lastSyncedAt.toMillis() : null,
    connectedBy: typeof data.userId === 'string' ? data.userId : null,
    disabledReason: typeof data.disabledReason === 'string' ? data.disabledReason : null
  };
};

// ---------------------------------------------------------------------------
// Two-way sync
// ---------------------------------------------------------------------------

export type SyncCounts = { pulled: number; created: number; updated: number; removed: number; pushed: number };

type SyncState = { teamId: string; userId: string; calendarId: string; syncToken: string | null };

function eventDocFromGoogle(normalized: NormalizedGoogleEvent, teamId: string, userId: string, calendarId: string, eventId: string) {
  return {
    id: eventId,
    teamId,
    createdBy: userId,
    title: normalized.title,
    description: normalized.description,
    startsAt: Timestamp.fromDate(normalized.startsAt),
    endsAt: Timestamp.fromDate(normalized.endsAt),
    location: normalized.location,
    eventType: 'meeting' as const,
    recurrence: null,
    occurrenceOf: null,
    reminderMinutes: [] as number[],
    linkedTaskIds: [] as string[],
    source: 'google' as const,
    googleEventId: normalized.googleEventId,
    googleCalendarId: calendarId,
    googleSyncedAt: Timestamp.fromDate(normalized.updatedAt),
    googlePushedAt: Timestamp.fromDate(normalized.updatedAt),
    googlePushPending: false,
    updatedAt: FieldValue.serverTimestamp()
  };
}

/**
 * Pulls remote changes into `events`.
 *
 * Uses Google's sync token when one is stored and falls back to a bounded
 * window otherwise. A 410 means the token aged out, which Google documents as
 * "discard the cursor and run a full sync" rather than an error to surface.
 */
export async function pullFromGoogle(sync: SyncState): Promise<SyncCounts> {
  const db = getFirestore();
  const counts: SyncCounts = { pulled: 0, created: 0, updated: 0, removed: 0, pushed: 0 };
  let pageToken: string | null = null;
  let syncToken = sync.syncToken;
  let nextSyncToken: string | null = null;
  let guard = 0;

  do {
    const params = new URLSearchParams({ maxResults: '100', singleEvents: 'true', showDeleted: 'true' });
    if (syncToken) {
      params.set('syncToken', syncToken);
    } else {
      params.set('timeMin', new Date(Date.now() - FULL_SYNC_PAST_DAYS * 86400000).toISOString());
      params.set('timeMax', new Date(Date.now() + FULL_SYNC_FUTURE_DAYS * 86400000).toISOString());
    }
    if (pageToken) params.set('pageToken', pageToken);

    const result = await calendarFetch(sync.userId, `/calendars/${encodeURIComponent(sync.calendarId)}/events?${params.toString()}`);
    if (result.status === 410 && syncToken) {
      await db.doc(`googleCalendarSync/${sync.teamId}`).set({ syncToken: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      syncToken = null;
      pageToken = null;
      if (guard++ > 1) throw new HttpsError('unavailable', 'Google Calendar could not complete a full sync.');
      continue;
    }
    const body = assertCalendarOk(result, 'reading the team calendar');
    const items = Array.isArray(body.items) ? body.items : [];

    for (const item of items) {
      if (counts.pulled >= MAX_SYNC_EVENTS_PER_RUN) break;
      const normalized = fromGoogleEventResource(item as Record<string, unknown>);
      if (!normalized) continue;
      counts.pulled += 1;

      const existing = await db.collection('events')
        .where('teamId', '==', sync.teamId)
        .where('googleEventId', '==', normalized.googleEventId)
        .limit(1)
        .get();
      const current = existing.docs[0];

      if (normalized.cancelled) {
        if (!current) continue;
        // Only mirror-copies are removed. An event that originated in First Pit
        // keeps its own record — the team owns it — and simply loses its link.
        if (current.data().source === 'google') {
          await current.ref.delete();
          counts.removed += 1;
        } else {
          await current.ref.set({ googleEventId: FieldValue.delete(), googleCalendarId: FieldValue.delete(), googlePushPending: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        continue;
      }

      if (!current) {
        // An event we pushed comes back on the first pull after the push. It
        // already exists locally under its own id, so adopt rather than clone.
        const linked = normalized.firstPitEventId
          ? await db.doc(`events/${normalized.firstPitEventId}`).get()
          : null;
        if (linked?.exists && linked.data()?.teamId === sync.teamId) {
          await linked.ref.set({
            googleEventId: normalized.googleEventId,
            googleCalendarId: sync.calendarId,
            googleSyncedAt: Timestamp.fromDate(normalized.updatedAt),
            googlePushedAt: Timestamp.fromDate(normalized.updatedAt),
            googlePushPending: false,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          continue;
        }
        const eventId = db.collection('events').doc().id;
        await db.doc(`events/${eventId}`).set({
          ...eventDocFromGoogle(normalized, sync.teamId, sync.userId, sync.calendarId, eventId),
          createdAt: FieldValue.serverTimestamp()
        });
        counts.created += 1;
        continue;
      }

      if (!shouldApplyRemoteChange(normalized.updatedAt, current.data().googleSyncedAt)) continue;
      await current.ref.set({
        title: normalized.title,
        description: normalized.description,
        location: normalized.location,
        startsAt: Timestamp.fromDate(normalized.startsAt),
        endsAt: Timestamp.fromDate(normalized.endsAt),
        googleCalendarId: sync.calendarId,
        googleSyncedAt: Timestamp.fromDate(normalized.updatedAt),
        googlePushedAt: Timestamp.fromDate(normalized.updatedAt),
        googlePushPending: false,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      counts.updated += 1;
    }

    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : null;
    if (typeof body.nextSyncToken === 'string') nextSyncToken = body.nextSyncToken;
  } while (pageToken && counts.pulled < MAX_SYNC_EVENTS_PER_RUN);

  if (nextSyncToken) {
    await db.doc(`googleCalendarSync/${sync.teamId}`).set({ syncToken: nextSyncToken, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return counts;
}

/**
 * Pushes First Pit events to Google.
 *
 * `googlePushPending` is the work queue: `createEvent`/`updateEvent` set it and
 * a successful push clears it, so an interrupted run resumes exactly where it
 * stopped instead of re-pushing the whole calendar.
 */
export async function pushToGoogle(sync: SyncState, backfill: boolean): Promise<number> {
  const db = getFirestore();
  const base = db.collection('events').where('teamId', '==', sync.teamId);
  const pending = backfill
    ? await base.where('startsAt', '>=', Timestamp.fromMillis(Date.now() - FULL_SYNC_PAST_DAYS * 86400000)).limit(MAX_SYNC_EVENTS_PER_RUN).get()
    : await base.where('googlePushPending', '==', true).limit(MAX_SYNC_EVENTS_PER_RUN).get();

  let pushed = 0;
  for (const doc of pending.docs) {
    const data = doc.data();
    // Never push a mirror-copy back to its own source, and skip recurrence
    // masters: their occurrences are separate documents already.
    if (data.source === 'google' && !data.googlePushPending) continue;
    if (data.occurrenceOf) continue;
    if (backfill && data.googleEventId) continue;

    const resource = toGoogleEventResource({ ...data, id: doc.id }, sync.teamId);
    const existingId = typeof data.googleEventId === 'string' ? data.googleEventId : null;
    const result = existingId
      ? await calendarFetch(sync.userId, `/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(existingId)}`, { method: 'PUT', body: JSON.stringify(resource) })
      : await calendarFetch(sync.userId, `/calendars/${encodeURIComponent(sync.calendarId)}/events`, { method: 'POST', body: JSON.stringify(resource) });

    // A mirrored event deleted in Google returns 404/410 on update. Drop the
    // stale link and create it fresh on the next run rather than failing.
    if (!result.ok && existingId && (result.status === 404 || result.status === 410)) {
      await doc.ref.set({ googleEventId: FieldValue.delete(), googlePushPending: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      continue;
    }
    const body = assertCalendarOk(result, 'writing to the team calendar');
    const updated = typeof body.updated === 'string' ? new Date(body.updated) : new Date();
    await doc.ref.set({
      googleEventId: String(body.id ?? existingId ?? ''),
      googleCalendarId: sync.calendarId,
      googleSyncedAt: Timestamp.fromDate(updated),
      googlePushedAt: Timestamp.fromDate(updated),
      googlePushPending: false,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    pushed += 1;
  }
  return pushed;
}

async function loadSyncState(teamId: string): Promise<SyncState | null> {
  const snapshot = await getFirestore().doc(`googleCalendarSync/${teamId}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || data.enabled !== true) return null;
  const userId = String(data.userId ?? '');
  const calendarId = String(data.calendarId ?? '');
  if (!userId || !calendarId) return null;
  return { teamId, userId, calendarId, syncToken: typeof data.syncToken === 'string' ? data.syncToken : null };
}

export async function runTeamSync(teamId: string): Promise<SyncCounts> {
  const sync = await loadSyncState(teamId);
  if (!sync) throw new HttpsError('failed-precondition', 'Google Calendar sync is not enabled for this team.');
  // Push first: a local edit made since the last run should win over the copy
  // Google still holds, and pushing first makes the pull see the final state.
  const pushed = await pushToGoogle(sync, sync.syncToken === null);
  const counts = await pullFromGoogle(sync);
  counts.pushed = pushed;
  await getFirestore().doc(`googleCalendarSync/${teamId}`).set({ lastSyncedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return counts;
}

export const syncTeamCalendar = async (request: GoogleRequest) => {
  const teamId = requireTeamId(request);
  await requireTeamMember(request, teamId);
  return { teamId, ...(await runTeamSync(teamId)) };
};

/** Personal agenda for the signed-in user's own Google account. Read-only. */
export const listMyGoogleEvents = async (request: GoogleRequest) => {
  const auth = requireAuth(request);
  const calendarId = getInput(request, 'calendarId') === undefined ? 'primary' : requireCalendarId(getInput(request, 'calendarId'));
  const days = Number(getInput(request, 'days') ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpsError('invalid-argument', 'The window must be between 1 and 90 days.');
  const params = new URLSearchParams({
    maxResults: '50',
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + days * 86400000).toISOString()
  });
  const body = assertCalendarOk(await calendarFetch(auth.uid, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`), 'reading your calendar');
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    calendarId,
    events: items
      .map((item) => fromGoogleEventResource(item as Record<string, unknown>))
      .filter((event): event is NormalizedGoogleEvent => Boolean(event) && !event!.cancelled)
      .map((event) => ({
        googleEventId: event.googleEventId,
        title: event.title,
        location: event.location,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString()
      }))
  };
};

/** Scheduled fan-out. Bounded per run so one slow team cannot starve the rest. */
export async function syncAllTeamCalendars(): Promise<{ teams: number; failures: number }> {
  const snapshot = await getFirestore().collection('googleCalendarSync').where('enabled', '==', true).limit(MAX_TEAMS_PER_SCHEDULED_RUN).get();
  let failures = 0;
  for (const doc of snapshot.docs) {
    try {
      await runTeamSync(doc.id);
    } catch {
      // One team's expired credentials must not stop the others.
      failures += 1;
      await doc.ref.set({ lastSyncError: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  return { teams: snapshot.size, failures };
}

// ---------------------------------------------------------------------------
// Google Chat hand-off
// ---------------------------------------------------------------------------

/**
 * Google Chat has no embeddable surface (`chat.google.com` sends
 * `X-Frame-Options: SAMEORIGIN`) and its API needs a Business/Enterprise
 * Workspace account, so a team links out to its space instead. Only the two
 * real Chat hosts are accepted — this value is rendered as a link for the whole
 * team, so an open redirect here would be a phishing vector.
 */
export function requireGoogleChatUrl(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'A Google Chat link is required.');
  const raw = value.trim();
  if (!raw || raw.length > 512) throw new HttpsError('invalid-argument', 'The Google Chat link is invalid.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpsError('invalid-argument', 'The Google Chat link is not a valid URL.');
  }
  if (url.protocol !== 'https:' || !['chat.google.com', 'mail.google.com'].includes(url.hostname)) {
    throw new HttpsError('invalid-argument', 'The link must be an https://chat.google.com or https://mail.google.com Google Chat link.');
  }
  return url.toString();
}

export const setTeamChatLink = async (request: GoogleRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const clear = getInput(request, 'clear') === true;
  const label = getInput(request, 'label') === undefined ? 'Google Chat' : requireString(getInput(request, 'label'), 'Link label', 60);
  const db = getFirestore();
  const chatUrl = clear ? null : requireGoogleChatUrl(getInput(request, 'chatUrl'));
  await db.doc(`teamPolicies/${teamId}`).set({ googleChatUrl: chatUrl, googleChatLabel: chatUrl ? label : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('auditEvents').doc().set(auditRecord({
    type: 'administrative.action', actorUserId: admin.uid, teamId, targetResource: `teamPolicies/${teamId}`, metadata: { action: chatUrl ? 'google.chat.linked' : 'google.chat.unlinked' }
  }));
  return { teamId, chatUrl, label: chatUrl ? label : null };
};

/**
 * Removes a mirrored event from Google. Best effort by design: the First Pit
 * record is what the team actually sees, so a Google failure must not block the
 * local delete. An orphan left behind is reconciled by the next full sync.
 */
export async function deleteGoogleEvent(teamId: string, googleEventId: string): Promise<boolean> {
  if (!googleEventId) return false;
  const sync = await loadSyncState(teamId);
  if (!sync) return false;
  const result = await calendarFetch(sync.userId, `/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(googleEventId)}`, { method: 'DELETE' });
  return result.ok || result.status === 404 || result.status === 410;
}
