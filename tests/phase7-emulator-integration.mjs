const projectId = 'demo-first-pit-phase7';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase7Pass123!';

async function json(url, options = {}) {
  const response = await globalThis.fetch(url, options);
  const body = await response.json();
  return { response, body };
}

async function createUser(email) {
  const { response, body } = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  if (response.status !== 200) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`);
  const sent = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: body.idToken }) });
  if (sent.response.status !== 200) throw new Error(`Could not send verification for ${email}: ${JSON.stringify(sent.body)}`);
  const codes = await json(`${authBase}/emulator/v1/projects/${projectId}/oobCodes`);
  const code = codes.body.oobCodes?.findLast((entry) => entry.email === email && entry.requestType === 'VERIFY_EMAIL')?.oobCode;
  const applied = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code }) });
  if (applied.response.status !== 200) throw new Error(`Could not verify ${email}: ${JSON.stringify(applied.body)}`);
  const refreshed = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  if (refreshed.response.status !== 200) throw new Error(`Could not refresh ${email}: ${JSON.stringify(refreshed.body)}`);
  return { ...body, ...refreshed.body };
}

// Mutations that write an audit record or a receipt require an `operationId`.
// These suites assert behaviour, not idempotency plumbing, so the harness
// supplies a unique one whenever a call does not set its own. Tests that
// exercise replay pass an explicit id.
let operationCounter = 0;
function withOperationId(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if ('operationId' in data) return data;
  operationCounter += 1;
  return { ...data, operationId: `harness-op-${operationCounter}` };
}

async function call(name, token, data) {
  const { response, body } = await json(`${functionsBase}/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: withOperationId(data) }) });
  if (response.status !== 200) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body.data ?? body.result ?? body;
}

async function readDocument(path, token, expectedStatus = 200) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== expectedStatus) throw new Error(`Expected ${expectedStatus} for ${path}, received ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const suffix = Date.now();
const coach = await createUser(`phase7-coach-${suffix}@example.com`);
const student = await createUser(`phase7-student-${suffix}@example.com`);
const outsider = await createUser(`phase7-outsider-${suffix}@example.com`);
const team = await call('createTeam', coach.idToken, { name: `Phase 7 Integration ${suffix}` });
const teamId = team.teamId;
const invitation = await call('createInvitation', coach.idToken, { teamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: invitation.invitationId });

const taskId = `phase7-task-${suffix}`;
await call('createTask', coach.idToken, { teamId, taskId, operationId: `create-${suffix}`, title: 'Programming practice plan', assignedTo: student.localId, dueAt: '2026-09-01T15:00:00.000Z' });
await call('createGoal', coach.idToken, { teamId, goalId: `phase7-goal-${suffix}`, operationId: `goal-${suffix}`, title: 'Programming tournament readiness' });
await call('createQuestion', student.idToken, { teamId, questionId: `phase7-question-${suffix}`, visibility: 'team', title: 'Programming practice question', body: 'How should the robot handle this programming test?', category: 'Programming', tags: ['programming'] });
const video = await call('createVideo', coach.idToken, { teamId, videoId: `phase7-video-${suffix}`, visibility: 'team', category: 'Programming', title: 'Programming practice video', description: 'Team programming walkthrough.', externalUrl: 'https://example.com/programming', sourceAttribution: 'Team library' });
await call('updateVideoPublication', coach.idToken, { videoId: video.videoId, publicationStatus: 'published' });

await call('createTask', coach.idToken, { teamId, taskId: `phase7-area-task-${suffix}`, operationId: `area-${suffix}`, title: 'Robot game mission run', labels: ['robot-game'], status: 'completed' });
const scoreDefinition = await call('createScoreDefinition', coach.idToken, { teamId, definitionId: `phase7-definition-${suffix}`, title: 'Phase 7 definition', season: '2026', missions: [{ id: 'mission-1', name: 'Mission 1', maxPoints: 50 }], deductions: [] });
await call('createScoreSession', coach.idToken, { teamId, sessionId: `phase7-session-${suffix}`, operationId: `session-${suffix}`, scoreDefinitionId: scoreDefinition.definitionId, title: 'Phase 7 match', scoreType: 'match', sessionDate: '2026-08-20T12:00:00.000Z', missions: [{ missionId: 'mission-1', points: 40, completed: true }], deductions: [] });

const dashboard = await call('getDashboard', student.idToken, { teamId });
if (dashboard.role !== 'student' || dashboard.summary.taskCount !== 2 || dashboard.summary.completedTaskCount !== 1 || dashboard.summary.goalCount !== 1 || dashboard.summary.completedGoalCount !== 0 || dashboard.summary.unreadNotificationCount < 1) throw new Error('Dashboard did not return the authorized role, task, goal, and assignment notification summary.');
const robotGameArea = dashboard.areas?.find((area) => area.id === 'robot-game');
if (dashboard.areas?.length !== 4 || robotGameArea?.taskCount !== 1 || robotGameArea?.completedTaskCount !== 1) throw new Error('Dashboard did not count the labelled task toward its judging area.');
if (dashboard.upcomingTasks?.length !== 1 || dashboard.upcomingTasks[0].id !== taskId) throw new Error('Dashboard upcoming tasks must list only open tasks with a due date.');
if (dashboard.scores?.[0]?.totalPoints !== 40 || dashboard.scores[0].scoreType !== 'match') throw new Error('Dashboard did not return the recorded score session for the trend.');
const search = await call('globalSearch', student.idToken, { query: 'programming', teamId });
const resultTypes = new Set(search.results.map((entry) => entry.type));
for (const type of ['Task', 'Question', 'Video']) if (!resultTypes.has(type)) throw new Error(`Global search did not return authorized ${type} results.`);
for (const entry of search.results) if (entry.teamId !== teamId || !entry.deepLink.startsWith('/')) throw new Error('Global search returned an invalid team boundary or deep link.');
if (!search.results.some((entry) => entry.type === 'Task' && entry.recordId === taskId)) throw new Error('Global search returned a task without its record ID.');

const otherTeam = await call('createTeam', outsider.idToken, { name: `Phase 7 Other Team ${suffix}` });
await call('createQuestion', outsider.idToken, { teamId: otherTeam.teamId, questionId: `phase7-private-${suffix}`, visibility: 'team', title: 'Programming private other team', body: 'Should never appear for the student.', category: 'Programming', tags: ['programming'] });
const scopedSearch = await call('globalSearch', student.idToken, { query: 'private other team' });
if (scopedSearch.results.some((entry) => entry.recordId === `phase7-private-${suffix}`)) throw new Error('Global search leaked a record from a team without an active membership.');

await call('updateProfileSettings', student.idToken, { displayName: 'Phase 7 Student', photoURL: null, theme: 'dark', highContrast: true, reducedMotion: true, fontScale: 'large', emailNotifications: false, pushNotifications: true, isMinor: true });
await readDocument(`users/${student.localId}`, student.idToken);
const profileSettings = await readDocument(`userSettings/${student.localId}`, student.idToken);
if (profileSettings.fields.theme?.stringValue !== 'dark' || profileSettings.fields.highContrast?.booleanValue !== true) throw new Error('Profile customization settings did not persist.');
const firstDeletionRequest = await call('requestAccountDeletion', student.idToken, {});
const replayedDeletionRequest = await call('requestAccountDeletion', student.idToken, {});
if (firstDeletionRequest.auditEventId !== replayedDeletionRequest.auditEventId) throw new Error('Account deletion replay created a different audit identity.');
const deletion = await readDocument(`accountDeletionRequests/${student.localId}`, student.idToken);
if (deletion.fields.status?.stringValue !== 'pending' || deletion.fields.userId?.stringValue !== student.localId) throw new Error('Account deletion request was not persisted with safe ownership.');
globalThis.console.log('Phase 7 integration passed: dashboard role/task/notification summary, authorized cross-module search, private team isolation, notification-ready records, and account deletion workflow.');
