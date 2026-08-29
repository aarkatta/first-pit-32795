import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { auditRecord, getInput, requireAuth, requireString, requireTeamMember, type TeamAdmin } from './phase2.js';
import { canAccessChannel as canAccessTeamChannel } from './phase4.js';

export type Phase7Request = CallableRequest<Record<string, unknown>>;

const MAX_TEAMS = 50;
const MAX_RESULTS = 40;
const MAX_SCAN = 60;
const MAX_SEARCH_TEAMS = 5;

function terms(value: unknown) {
  const query = requireString(value, 'Search query', 80).toLowerCase();
  const tokens = [...new Set(query.split(/[^a-z0-9]+/).filter((token) => token.length >= 2))].slice(0, 6);
  if (!tokens.length) throw new HttpsError('invalid-argument', 'Search query must include at least two letters or numbers.');
  return { query, tokens };
}

function textMatches(tokens: string[], ...values: unknown[]) {
  const text = values.map((value) => String(value ?? '')).join(' ').toLowerCase();
  return tokens.every((token) => text.includes(token));
}

function dateMillis(value: unknown) {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function publicRecord(snapshot: FirebaseFirestore.QueryDocumentSnapshot, fields: string[]) {
  const data = snapshot.data();
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (data[field] !== undefined) result[field] = data[field];
    return result;
  }, { id: snapshot.id });
}

function result(type: string, teamId: string, recordId: string, title: string, snippet: string, deepLink: string) {
  return { type, teamId, recordId, title, snippet: snippet.slice(0, 240), deepLink };
}

/**
 * Search reuses the Phase 4 channel rule verbatim — a second copy of it drifted
 * away from the `parentVisibility` policy once already — and only adds the
 * archived-channel exclusion that search results need.
 */
function canAccessChannel(actor: TeamAdmin, channel: DocumentData, policy: DocumentData) {
  return channel.archived !== true && canAccessTeamChannel(actor, channel, policy);
}

export function summarizeUnreadNotifications(records: DocumentData[], limit = 50) {
  return {
    unreadMessageCount: records.filter((notification) => String(notification.type ?? '').startsWith('chat.')).length,
    announcementCount: records.filter((notification) => String(notification.type ?? '').includes('announcement')).length,
    unreadSummaryTruncated: records.length === limit,
    unreadSummaryLimit: limit
  };
}

async function activeTeamIds(uid: string, requestedTeamId?: string) {
  const db = getFirestore();
  if (requestedTeamId) {
    await requireActiveTeam(uid, requestedTeamId);
    return [requestedTeamId];
  }
  const memberships = await db.collection('memberships')
    .where('userId', '==', uid)
    .where('status', '==', 'active')
    .limit(MAX_TEAMS)
    .get();
  return memberships.docs.map((snapshot) => String(snapshot.data().teamId)).filter(Boolean);
}

async function requireActiveTeam(uid: string, teamId: string) {
  const membership = await getFirestore().doc(`memberships/${teamId}_${uid}`).get();
  if (!membership.exists || membership.data()?.teamId !== teamId || membership.data()?.userId !== uid || membership.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'An active team membership is required.');
  }
}

async function recentTeamRecords(teamId: string, searchTokens: string[]) {
  const db = getFirestore();
  const [tasks, goals, events, scores] = await Promise.all([
    db.collection('tasks').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
    db.collection('goals').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
    db.collection('eventOccurrences').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
    db.collection('scoreSessions').where('teamId', '==', teamId).limit(MAX_SCAN).get()
  ]);
  const records = [
    ...tasks.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().description)).map((snapshot) => {
      const projectId = typeof snapshot.data().projectId === 'string' ? `project=${encodeURIComponent(snapshot.data().projectId)}&` : '';
      return result('Task', teamId, snapshot.id, String(snapshot.data().title ?? 'Task'), String(snapshot.data().description ?? ''), `/coordination?${projectId}task=${encodeURIComponent(snapshot.id)}`);
    }),
    ...goals.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().description)).map((snapshot) => result('Goal', teamId, snapshot.id, String(snapshot.data().title ?? 'Goal'), String(snapshot.data().description ?? ''), `/coordination?goal=${encodeURIComponent(snapshot.id)}`)),
    ...events.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().description, snapshot.data().location)).map((snapshot) => result('Event', teamId, snapshot.id, String(snapshot.data().title ?? 'Event'), String(snapshot.data().description ?? ''), `/coordination?event=${encodeURIComponent(snapshot.id)}`)),
    ...scores.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().notes, snapshot.data().robotProgramContext)).map((snapshot) => result('Score', teamId, snapshot.id, String(snapshot.data().title ?? 'Score session'), String(snapshot.data().notes ?? ''), `/scorer?session=${encodeURIComponent(snapshot.id)}`))
  ];
  return records;
}

export const getDashboard = async (request: Phase7Request) => {
  const auth = requireAuth(request);
  const teamId = requireString(getInput(request, 'teamId'), 'Team ID');
  const actor = await requireTeamMember(request, teamId);
  const db = getFirestore();
  const now = Timestamp.now();
  const taskQuery = db.collection('tasks').where('teamId', '==', teamId);
  const goalQuery = db.collection('goals').where('teamId', '==', teamId);
  const scoreQuery = db.collection('scoreSessions').where('teamId', '==', teamId);
  const unreadNotificationQuery = db.collection('notifications').where('recipientUserId', '==', auth.uid).where('teamId', '==', teamId).where('readAt', '==', null);
  const [team, tasks, goals, events, occurrences, scores, notifications, unreadNotificationsSnapshot, taskCount, completedTaskCount, goalCount, scoreCount, unreadNotificationCount] = await Promise.all([
    db.doc(`teams/${teamId}`).get(),
    taskQuery.orderBy('updatedAt', 'desc').limit(5).get(),
    goalQuery.orderBy('updatedAt', 'desc').limit(20).get(),
    db.collection('events').where('teamId', '==', teamId).where('startsAt', '>=', now).orderBy('startsAt', 'asc').limit(20).get(),
    db.collection('eventOccurrences').where('teamId', '==', teamId).where('startsAt', '>=', now).orderBy('startsAt', 'asc').limit(20).get(),
    scoreQuery.orderBy('sessionDate', 'desc').limit(5).get(),
    db.collection('notifications').where('recipientUserId', '==', auth.uid).where('teamId', '==', teamId).orderBy('createdAt', 'desc').limit(10).get(),
    unreadNotificationQuery.orderBy('createdAt', 'desc').limit(50).get(),
    taskQuery.count().get(),
    taskQuery.where('status', '==', 'completed').count().get(),
    goalQuery.count().get(),
    scoreQuery.count().get(),
    unreadNotificationQuery.count().get()
  ]);
  if (!team.exists) throw new HttpsError('not-found', 'Team not found.');
  const taskRecords = tasks.docs.map((snapshot) => publicRecord(snapshot, ['title', 'status', 'priority', 'assignedTo', 'projectId', 'dueAt', 'updatedAt']));
  const goalRecords = goals.docs.map((snapshot) => publicRecord(snapshot, ['title', 'status', 'taskCount', 'completedTaskCount', 'dueAt', 'updatedAt']));
  const eventRecords = [
    ...events.docs.filter((snapshot) => !snapshot.data().recurrence).map((snapshot) => publicRecord(snapshot, ['title', 'startsAt', 'endsAt', 'eventType', 'location'])),
    ...occurrences.docs.map((snapshot) => publicRecord(snapshot, ['title', 'startsAt', 'endsAt', 'eventType', 'location', 'occurrenceOf']))
  ].sort((a, b) => dateMillis(a.startsAt) - dateMillis(b.startsAt)).slice(0, 5);
  const scoreRecords = scores.docs.map((snapshot) => publicRecord(snapshot, ['title', 'scoreType', 'totalPoints', 'sessionDate', 'updatedAt']));
  const notificationRecords = notifications.docs.map((snapshot) => publicRecord(snapshot, ['teamId', 'title', 'body', 'type', 'deepLink', 'mandatory', 'readAt', 'createdAt']));
  const unreadNotifications = unreadNotificationsSnapshot.docs.map((snapshot) => snapshot.data());
  const unreadSummary = summarizeUnreadNotifications(unreadNotifications);
  return {
    team: { id: team.id, name: String(team.data()?.name ?? 'Your team') },
    role: actor.role ?? 'member',
    tasks: taskRecords,
    goals: goalRecords,
    events: eventRecords,
    scores: scoreRecords,
    notifications: notificationRecords,
    summary: {
      taskCount: taskCount.data().count,
      completedTaskCount: completedTaskCount.data().count,
      goalCount: goalCount.data().count,
      upcomingEventCount: eventRecords.length,
      scoreCount: scoreCount.data().count,
      unreadNotificationCount: unreadNotificationCount.data().count,
      ...unreadSummary
    }
  };
};

function requireOptionalHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 500) throw new HttpsError('invalid-argument', 'Profile picture URL is invalid.');
  try {
    const parsed = new globalThis.URL(value.trim());
    if (parsed.protocol !== 'https:') throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw new HttpsError('invalid-argument', 'Profile picture URL must be a https link.');
  }
}

export const updateProfileSettings = async (request: Phase7Request) => {
  const auth = requireAuth(request);
  const data = request.data ?? {};
  const displayName = requireString(getInput(request, 'displayName'), 'Display name', 80);
  // A profile picture is rendered by every teammate, so the URL is bounded and
  // restricted to https — a `javascript:` or `data:` value would otherwise be
  // stored and handed straight to an <img src>.
  const photoURL = requireOptionalHttpsUrl(getInput(request, 'photoURL'));
  const theme = getInput(request, 'theme') ?? 'system';
  if (!['light', 'dark', 'system'].includes(String(theme))) throw new HttpsError('invalid-argument', 'Theme is invalid.');
  const fontScale = getInput(request, 'fontScale') ?? 'default';
  if (!['default', 'large'].includes(String(fontScale))) throw new HttpsError('invalid-argument', 'Text size is invalid.');
  for (const [name, value] of [['highContrast', data.highContrast], ['reducedMotion', data.reducedMotion], ['emailNotifications', data.emailNotifications], ['pushNotifications', data.pushNotifications]] as const) {
    if (typeof value !== 'boolean') throw new HttpsError('invalid-argument', `${name} must be boolean.`);
  }
  if (data.isMinor !== undefined && typeof data.isMinor !== 'boolean') throw new HttpsError('invalid-argument', 'Minor status must be boolean.');
  const db = getFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const notificationRef = db.doc(`notificationPreferences/${auth.uid}`);
  const privacyRef = db.doc(`privacySettings/${auth.uid}`);
  const settingsRef = db.doc(`userSettings/${auth.uid}`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(userRef);
    const now = Timestamp.now();
    transaction.set(userRef, { uid: auth.uid, email: request.auth?.token.email ?? null, displayName, photoURL: photoURL || null, updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
    transaction.set(notificationRef, { userId: auth.uid, emailNotifications: data.emailNotifications, pushNotifications: data.pushNotifications, safetyNotifications: true, updatedAt: now }, { merge: true });
    transaction.set(privacyRef, { userId: auth.uid, profileVisibility: 'teamOnly', searchable: false, allowParentVisibility: false, privateConversations: false, ...(data.isMinor === undefined ? {} : { isMinor: data.isMinor }), updatedAt: now }, { merge: true });
    transaction.set(settingsRef, { userId: auth.uid, theme, highContrast: data.highContrast, reducedMotion: data.reducedMotion, fontScale, updatedAt: now }, { merge: true });
    // `isMinor` gates youth-safety behavior across the product, so changing it
    // here has to leave the same audit trail as updatePrivacySettings.
    if (data.isMinor !== undefined) {
      transaction.set(db.collection('auditEvents').doc(), auditRecord({
        type: 'sensitive.updated',
        actorUserId: auth.uid,
        targetResource: `privacySettings/${auth.uid}`,
        metadata: { action: 'privacy.updated' }
      }));
    }
  });
  return { userId: auth.uid, saved: true as const, safetyNotifications: true as const };
};

export const globalSearch = async (request: Phase7Request) => {
  const auth = requireAuth(request);
  const { query, tokens } = terms(getInput(request, 'query'));
  const requestedTeamId = getInput(request, 'teamId') === undefined || getInput(request, 'teamId') === null || getInput(request, 'teamId') === ''
    ? undefined
    : requireString(getInput(request, 'teamId'), 'Team ID');
  const allTeamIds = await activeTeamIds(auth.uid, requestedTeamId);
  // Every team costs ~10 queries and up to ~600 document reads. Without a cap a
  // member of many teams turns one keystroke-driven search into tens of
  // thousands of reads, so an unscoped search covers only the first few teams
  // and says so; the client can re-run it scoped to a specific team.
  const teamIds = requestedTeamId ? allTeamIds : allTeamIds.slice(0, MAX_SEARCH_TEAMS);
  const db = getFirestore();
  const records: Array<ReturnType<typeof result>> = [];
  for (const teamId of teamIds) {
    // Stop fanning out as soon as the response is already full.
    if (records.length >= MAX_RESULTS) break;
    const actor = await requireTeamMember(request, teamId);
    const [questions, videos, messages, files, channels, policy] = await Promise.all([
      db.collection('questions').where('teamId', '==', teamId).where('visibility', '==', 'team').where('moderationStatus', '==', 'published').where('searchTokens', 'array-contains', tokens[0]).limit(MAX_SCAN).get(),
      db.collection('videos').where('teamId', '==', teamId).where('visibility', '==', 'team').where('publicationStatus', '==', 'published').where('searchTokens', 'array-contains', tokens[0]).limit(MAX_SCAN).get(),
      db.collection('messages').where('teamId', '==', teamId).where('searchTokens', 'array-contains', tokens[0]).limit(MAX_SCAN).get(),
      db.collection('fileMetadata').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
      db.collection('channels').where('teamId', '==', teamId).where('archived', '==', false).limit(MAX_SCAN).get(),
      db.doc(`teamPolicies/${teamId}`).get()
    ]);
    questions.docs.filter((snapshot) => textMatches(tokens, snapshot.data().title, snapshot.data().body, snapshot.data().category, ...(snapshot.data().tags ?? []))).forEach((snapshot) => records.push(result('Question', teamId, snapshot.id, String(snapshot.data().title ?? 'Question'), String(snapshot.data().body ?? ''), `/knowledge?tab=questions&question=${encodeURIComponent(snapshot.id)}`)));
    videos.docs.filter((snapshot) => textMatches(tokens, snapshot.data().title, snapshot.data().description, snapshot.data().category)).forEach((snapshot) => records.push(result('Video', teamId, snapshot.id, String(snapshot.data().title ?? 'Video'), String(snapshot.data().description ?? ''), `/knowledge?tab=videos&video=${encodeURIComponent(snapshot.id)}`)));
    const channelMap = new Map(channels.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
    const policyData = policy.data() ?? {};
    messages.docs.filter((snapshot) => {
      const message = snapshot.data();
      const channel = channelMap.get(String(message.channelId));
      return channel ? canAccessChannel(actor, channel, policyData) && textMatches(tokens, message.body) : false;
    }).forEach((snapshot) => records.push(result('Message', teamId, snapshot.id, 'Team message', String(snapshot.data().body ?? ''), `/chat?channel=${encodeURIComponent(String(snapshot.data().channelId ?? ''))}&message=${encodeURIComponent(snapshot.id)}`)));
    if (policyData.fileSharing === 'teamOnly') {
      files.docs.filter((snapshot) => snapshot.data().status === 'ready' && !['blocked', 'pending'].includes(String(snapshot.data().scanStatus)) && textMatches(tokens, snapshot.data().name)).forEach((snapshot) => records.push(result('File', teamId, snapshot.id, String(snapshot.data().name ?? 'Team file'), `${String(snapshot.data().contentType ?? 'File')} · ${Number(snapshot.data().sizeBytes ?? 0)} bytes`, `/coordination?file=${encodeURIComponent(snapshot.id)}`)));
    }
    const team = await db.doc(`teams/${teamId}`).get();
    if (team.exists && textMatches(tokens, team.data()?.name)) records.push(result('Team', teamId, teamId, String(team.data()?.name ?? 'Team'), 'Team workspace', '/hub'));
    records.push(...await recentTeamRecords(teamId, tokens));
  }
  const unique = [...new Map(records.map((entry) => [`${entry.type}:${entry.teamId}:${entry.recordId}`, entry])).values()];
  unique.sort((a, b) => a.title.localeCompare(b.title));
  return {
    query,
    results: unique.slice(0, MAX_RESULTS),
    teamIds,
    teamSearchLimit: MAX_SEARCH_TEAMS,
    teamsTruncated: teamIds.length < allTeamIds.length
  };
};
