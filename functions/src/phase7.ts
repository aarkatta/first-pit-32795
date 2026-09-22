import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getInput, requireAuth, requireString, requireTeamMember } from './phase2.js';

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

/**
 * Picks the named fields for a callable response. A callable encodes a
 * Firestore `Timestamp` as a bare `{_seconds, _nanoseconds}` object the client
 * cannot read as a date, so timestamps leave here as ISO strings.
 */
export function pickPublicFields(id: string, data: DocumentData, fields: string[]) {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const value = data[field];
    if (value !== undefined) result[field] = value instanceof Timestamp ? value.toDate().toISOString() : value;
    return result;
  }, { id });
}

function publicRecord(snapshot: FirebaseFirestore.QueryDocumentSnapshot, fields: string[]) {
  return pickPublicFields(snapshot.id, snapshot.data(), fields);
}

function result(type: string, teamId: string, recordId: string, title: string, snippet: string, deepLink: string) {
  return { type, teamId, recordId, title, snippet: snippet.slice(0, 240), deepLink };
}

export function summarizeUnreadNotifications(records: DocumentData[], limit = 50) {
  return {
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
  const [tasks, goals] = await Promise.all([
    db.collection('tasks').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
    db.collection('goals').where('teamId', '==', teamId).limit(MAX_SCAN).get()
  ]);
  const records = [
    ...tasks.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().description)).map((snapshot) => {
      const projectId = typeof snapshot.data().projectId === 'string' ? `project=${encodeURIComponent(snapshot.data().projectId)}&` : '';
      return result('Task', teamId, snapshot.id, String(snapshot.data().title ?? 'Task'), String(snapshot.data().description ?? ''), `/coordination?${projectId}task=${encodeURIComponent(snapshot.id)}`);
    }),
    ...goals.docs.filter((snapshot) => textMatches(searchTokens, snapshot.data().title, snapshot.data().description)).map((snapshot) => result('Goal', teamId, snapshot.id, String(snapshot.data().title ?? 'Goal'), String(snapshot.data().description ?? ''), `/milestones?goal=${encodeURIComponent(snapshot.id)}`))
  ];
  return records;
}

/**
 * The four FIRST LEGO League judging areas. A task belongs to an area when it
 * carries the area id as a label — the built-in templates and the task importer
 * apply these, and a coach can add one to any card. Labels rather than a new
 * task field keep every existing task, rule, and editor unchanged.
 */
export const DASHBOARD_AREAS = [
  { id: 'innovation-project', label: 'Innovation project' },
  { id: 'robot-design', label: 'Robot design' },
  { id: 'robot-game', label: 'Robot game' },
  { id: 'core-values', label: 'Core values' }
] as const;

const OPEN_TASK_STATUSES = ['todo', 'inProgress', 'review'];

export function areaProgress(counts: Array<{ taskCount: number; completedTaskCount: number }>) {
  return DASHBOARD_AREAS.map((area, index) => {
    const taskCount = Math.max(0, counts[index]?.taskCount ?? 0);
    return { id: area.id, label: area.label, taskCount, completedTaskCount: Math.min(taskCount, Math.max(0, counts[index]?.completedTaskCount ?? 0)) };
  });
}

export const getDashboard = async (request: Phase7Request) => {
  const auth = requireAuth(request);
  const teamId = requireString(getInput(request, 'teamId'), 'Team ID');
  const actor = await requireTeamMember(request, teamId);
  const db = getFirestore();
  const taskQuery = db.collection('tasks').where('teamId', '==', teamId);
  const goalQuery = db.collection('goals').where('teamId', '==', teamId);
  const unreadNotificationQuery = db.collection('notifications').where('recipientUserId', '==', auth.uid).where('teamId', '==', teamId).where('readAt', '==', null);
  // Count aggregations cost one read per 1,000 matches, so per-area progress
  // stays bounded however many tasks a team accumulates.
  const areaCountsPromise = Promise.all(DASHBOARD_AREAS.map(async (area) => {
    const areaQuery = taskQuery.where('labels', 'array-contains', area.id);
    const [total, completed] = await Promise.all([areaQuery.count().get(), areaQuery.where('status', '==', 'completed').count().get()]);
    return { taskCount: total.data().count, completedTaskCount: completed.data().count };
  }));
  const [team, tasks, upcomingTasks, goals, completedGoals, notifications, unreadNotificationsSnapshot, taskCount, completedTaskCount, goalCount, completedGoalCount, unreadNotificationCount, areaCounts] = await Promise.all([
    db.doc(`teams/${teamId}`).get(),
    taskQuery.orderBy('updatedAt', 'desc').limit(5).get(),
    // The range filter drops tasks without a due date, which have no place on
    // an "upcoming" list; overdue open work sorts first.
    taskQuery.where('status', 'in', OPEN_TASK_STATUSES).where('dueAt', '>', Timestamp.fromMillis(0)).orderBy('dueAt', 'asc').limit(5).get(),
    goalQuery.orderBy('updatedAt', 'desc').limit(20).get(),
    goalQuery.where('status', '==', 'completed').orderBy('updatedAt', 'desc').limit(3).get(),
    db.collection('notifications').where('recipientUserId', '==', auth.uid).where('teamId', '==', teamId).orderBy('createdAt', 'desc').limit(10).get(),
    unreadNotificationQuery.orderBy('createdAt', 'desc').limit(50).get(),
    taskQuery.count().get(),
    taskQuery.where('status', '==', 'completed').count().get(),
    goalQuery.count().get(),
    goalQuery.where('status', '==', 'completed').count().get(),
    unreadNotificationQuery.count().get(),
    areaCountsPromise
  ]);
  if (!team.exists) throw new HttpsError('not-found', 'Team not found.');
  const taskFields = ['title', 'status', 'priority', 'assignedTo', 'projectId', 'labels', 'dueAt', 'updatedAt'];
  const goalFields = ['title', 'status', 'taskCount', 'completedTaskCount', 'dueAt', 'updatedAt'];
  const taskRecords = tasks.docs.map((snapshot) => publicRecord(snapshot, taskFields));
  const goalRecords = goals.docs.map((snapshot) => publicRecord(snapshot, goalFields));
  const notificationRecords = notifications.docs.map((snapshot) => publicRecord(snapshot, ['teamId', 'title', 'body', 'type', 'deepLink', 'mandatory', 'readAt', 'createdAt']));
  const unreadNotifications = unreadNotificationsSnapshot.docs.map((snapshot) => snapshot.data());
  const unreadSummary = summarizeUnreadNotifications(unreadNotifications);
  return {
    team: { id: team.id, name: String(team.data()?.name ?? 'Your team') },
    role: actor.role ?? 'member',
    tasks: taskRecords,
    upcomingTasks: upcomingTasks.docs.map((snapshot) => publicRecord(snapshot, taskFields)),
    goals: goalRecords,
    completedGoals: completedGoals.docs.map((snapshot) => publicRecord(snapshot, goalFields)),
    areas: areaProgress(areaCounts),
    notifications: notificationRecords,
    summary: {
      taskCount: taskCount.data().count,
      completedTaskCount: completedTaskCount.data().count,
      goalCount: goalCount.data().count,
      completedGoalCount: completedGoalCount.data().count,
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
    // `isMinor` was a self-declared "I am under 18" checkbox that nothing read.
    // It is no longer collected, and every save scrubs any value an earlier
    // version stored — unused information about children is not kept. An older
    // client that still sends the field is ignored rather than refused.
    transaction.set(privacyRef, { userId: auth.uid, profileVisibility: 'teamOnly', searchable: false, allowParentVisibility: false, privateConversations: false, isMinor: FieldValue.delete(), updatedAt: now }, { merge: true });
    transaction.set(settingsRef, { userId: auth.uid, theme, highContrast: data.highContrast, reducedMotion: data.reducedMotion, fontScale, updatedAt: now }, { merge: true });
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
    await requireTeamMember(request, teamId);
    const [questions, videos, files, policy] = await Promise.all([
      db.collection('questions').where('teamId', '==', teamId).where('visibility', '==', 'team').where('moderationStatus', '==', 'published').where('searchTokens', 'array-contains', tokens[0]).limit(MAX_SCAN).get(),
      db.collection('videos').where('teamId', '==', teamId).where('visibility', '==', 'team').where('publicationStatus', '==', 'published').where('searchTokens', 'array-contains', tokens[0]).limit(MAX_SCAN).get(),
      db.collection('fileMetadata').where('teamId', '==', teamId).limit(MAX_SCAN).get(),
      db.doc(`teamPolicies/${teamId}`).get()
    ]);
    questions.docs.filter((snapshot) => textMatches(tokens, snapshot.data().title, snapshot.data().body, snapshot.data().category, ...(snapshot.data().tags ?? []))).forEach((snapshot) => records.push(result('Question', teamId, snapshot.id, String(snapshot.data().title ?? 'Question'), String(snapshot.data().body ?? ''), `/knowledge?tab=questions&question=${encodeURIComponent(snapshot.id)}`)));
    videos.docs.filter((snapshot) => textMatches(tokens, snapshot.data().title, snapshot.data().description, snapshot.data().category)).forEach((snapshot) => records.push(result('Video', teamId, snapshot.id, String(snapshot.data().title ?? 'Video'), String(snapshot.data().description ?? ''), `/knowledge?tab=videos&video=${encodeURIComponent(snapshot.id)}`)));
    const policyData = policy.data() ?? {};
    if (policyData.fileSharing === 'teamOnly') {
      files.docs.filter((snapshot) => snapshot.data().status === 'ready' && !['blocked', 'pending'].includes(String(snapshot.data().scanStatus)) && textMatches(tokens, snapshot.data().name)).forEach((snapshot) => records.push(result('File', teamId, snapshot.id, String(snapshot.data().name ?? 'Team file'), `${String(snapshot.data().contentType ?? 'File')} · ${Number(snapshot.data().sizeBytes ?? 0)} bytes`, `/files?file=${encodeURIComponent(snapshot.id)}`)));
    }
    const team = await db.doc(`teams/${teamId}`).get();
    if (team.exists && textMatches(tokens, team.data()?.name)) records.push(result('Team', teamId, teamId, String(team.data()?.name ?? 'Team'), 'Team workspace', '/team'));
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
