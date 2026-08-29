const projectId = 'demo-first-pit-phase6';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase6Pass123!';
const requestTimeoutMs = 30_000;
const suiteTimeoutMs = 180_000;
const suiteStartedAt = Date.now();
let currentStage = 'initializing the Phase 6 harness';
let exiting = false;

function elapsedSeconds() {
  return ((Date.now() - suiteStartedAt) / 1000).toFixed(1);
}

function progress(stage) {
  currentStage = stage;
  globalThis.console.log(`[phase6 +${elapsedSeconds()}s] ${stage}`);
}

function fail(error) {
  if (exiting) return;
  exiting = true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const output = `[phase6 +${elapsedSeconds()}s] FAILED while ${currentStage}: ${message}\n`;
  globalThis.process.stderr.write(output, () => globalThis.process.exit(1));
  const forcedExit = setTimeout(() => globalThis.process.exit(1), 1_000);
  forcedExit.unref();
}

globalThis.process.on('uncaughtException', fail);
globalThis.process.on('unhandledRejection', fail);
const suiteTimeout = setTimeout(
  () => fail(new Error(`suite exceeded its ${suiteTimeoutMs / 1000}-second deadline`)),
  suiteTimeoutMs
);

async function json(url, options = {}) {
  const requestStartedAt = Date.now();
  try {
    const response = await globalThis.fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(requestTimeoutMs)
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { response, body };
  } catch (error) {
    const method = options.method ?? 'GET';
    const path = new URL(url).pathname;
    const duration = ((Date.now() - requestStartedAt) / 1000).toFixed(1);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${method} ${path} failed after ${duration}s: ${reason}`);
  }
}

async function createUser(email) {
  const { response, body } = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (response.status !== 200) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`);
  const sent = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: body.idToken })
  });
  if (sent.response.status !== 200) throw new Error(`Could not send verification for ${email}: ${JSON.stringify(sent.body)}`);
  const codes = await json(`${authBase}/emulator/v1/projects/${projectId}/oobCodes`);
  const code = codes.body.oobCodes?.findLast((entry) => entry.email === email && entry.requestType === 'VERIFY_EMAIL')?.oobCode;
  if (!code) throw new Error(`No verification code was recorded for ${email}.`);
  const applied = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: code })
  });
  if (applied.response.status !== 200) throw new Error(`Could not verify ${email}: ${JSON.stringify(applied.body)}`);
  const refreshed = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
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
  const { response, body } = await json(`${functionsBase}/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: withOperationId(data) })
  });
  if (response.status !== 200) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body.data ?? body.result ?? body;
}

async function callFails(name, token, data, expectedStatus) {
  const { response, body } = await json(`${functionsBase}/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: withOperationId(data) })
  });
  if (response.status === 200) throw new Error(`${name} unexpectedly succeeded.`);
  if (body?.error?.status !== expectedStatus) {
    throw new Error(`${name} failed with ${body?.error?.status ?? response.status} instead of ${expectedStatus}: ${JSON.stringify(body)}`);
  }
}

function value(data) {
  if (data === null) return { nullValue: 'NULL_VALUE' };
  if (typeof data === 'string') return { stringValue: data };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return Number.isInteger(data) ? { integerValue: String(data) } : { doubleValue: data };
  if (data instanceof Date) return { timestampValue: data.toISOString() };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, value(entry)])) } };
}

function sessionWrite(teamId, index, date, overrides = {}) {
  const id = `${teamId}-session-${String(index).padStart(4, '0')}`;
  const eventId = index % 3 === 0 ? 'event-a' : 'event-b';
  const scoreType = index % 2 === 0 ? 'practice' : 'match';
  const fields = {
    id,
    teamId,
    scoreDefinitionId: 'seed-definition',
    scoringSeason: '2026',
    scoringSourceType: 'team-defined',
    scoringSourceLabel: 'Boundary fixture',
    title: `Boundary session ${index}`,
    scoreType,
    sessionDate: date,
    eventId,
    missions: [{ missionId: 'mission-1', points: index % 21, completed: index % 2 === 0 }],
    deductions: [],
    totalPoints: index % 21,
    notes: '',
    participantUserIds: [],
    runTimeSeconds: 150,
    robotProgramContext: 'Boundary fixture',
    version: 1,
    createdBy: 'fixture',
    createdAt: date,
    updatedAt: date,
    ...overrides
  };
  return {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/scoreSessions/${id}`,
      fields: Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, value(entry)]))
    }
  };
}

async function commitWrites(writes) {
  for (let start = 0; start < writes.length; start += 400) {
    const batch = writes.slice(start, start + 400);
    progress(`seeding score fixtures ${start + 1}-${start + batch.length} of ${writes.length}`);
    const { response, body } = await json(`http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: batch })
    });
    if (response.status !== 200) throw new Error(`Could not seed ${batch.length} score sessions: ${JSON.stringify(body)}`);
  }
}

async function readDocument(path, expectedStatus = 200) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status !== expectedStatus) throw new Error(`Expected ${expectedStatus} for ${path}, received ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function assertBoundary(label, list, exported, expected) {
  if (list.sessions.length !== Math.min(expected.count, 50)) throw new Error(`${label} list returned ${list.sessions.length} history rows instead of ${Math.min(expected.count, 50)}.`);
  if (list.statistics.count !== Math.min(expected.count, 500)) throw new Error(`${label} statistics counted ${list.statistics.count} instead of ${Math.min(expected.count, 500)}.`);
  if (list.historyTruncated !== expected.historyTruncated) throw new Error(`${label} historyTruncated was ${list.historyTruncated}.`);
  if (list.statisticsTruncated !== expected.statisticsTruncated || list.statisticsLimit !== 500) throw new Error(`${label} statistics metadata was incorrect.`);
  if (exported.count !== Math.min(expected.count, 500) || exported.limit !== 500 || exported.truncated !== expected.statisticsTruncated) throw new Error(`${label} export metadata was incorrect.`);
  const csvRows = exported.csv.trimEnd().split('\n').length;
  if (csvRows !== exported.count + 1) throw new Error(`${label} CSV contained ${csvRows} rows for ${exported.count} records.`);
  if (list.sessions.some((session) => session.teamId !== expected.teamId)) throw new Error(`${label} list crossed a team boundary.`);
}

const suffix = Date.now();
progress('creating and verifying the Coach account');
const coach = await createUser(`phase6-coach-${suffix}@example.com`);
progress('creating and verifying the Student account');
const student = await createUser(`phase6-student-${suffix}@example.com`);
const boundaryCounts = [0, 50, 51, 500, 501];
const teams = new Map();

for (const count of boundaryCounts) {
  progress(`creating the ${count}-record boundary team`);
  const team = await call('createTeam', coach.idToken, { name: `Phase 6 boundary ${count} ${suffix}` });
  teams.set(count, team.teamId);
}

const allWrites = [];
for (const count of boundaryCounts) {
  const teamId = teams.get(count);
  for (let index = 0; index < count; index += 1) {
    const date = count === 51
      ? new Date(Date.UTC(2026, 0, 1 + index))
      : new Date(Date.UTC(2026, 2, 1, 0, index));
    allWrites.push(sessionWrite(teamId, index, date));
  }
}
await commitWrites(allWrites);

for (const count of boundaryCounts) {
  const teamId = teams.get(count);
  progress(`checking list/statistics/export at the ${count}-record boundary`);
  const list = await call('listScoreSessions', coach.idToken, { teamId });
  const exported = await call('exportScoreReport', coach.idToken, { teamId });
  assertBoundary(`${count}-record boundary`, list, exported, {
    count,
    teamId,
    historyTruncated: count > 50,
    statisticsTruncated: count > 500
  });
}

const filterTeamId = teams.get(51);
const filters = {
  teamId: filterTeamId,
  scoreType: 'practice',
  eventId: 'event-a',
  fromDate: '2026-01-10T00:00:00.000Z',
  toDate: '2026-02-10T23:59:59.999Z'
};
const expectedFilteredCount = Array.from({ length: 51 }, (_, index) => index)
  .filter((index) => index % 2 === 0 && index % 3 === 0 && index >= 9 && index <= 40).length;
progress('checking combined date, score-type, and event filters');
const filteredList = await call('listScoreSessions', coach.idToken, filters);
const filteredExport = await call('exportScoreReport', coach.idToken, filters);
assertBoundary('filtered boundary', filteredList, filteredExport, {
  count: expectedFilteredCount,
  teamId: filterTeamId,
  historyTruncated: false,
  statisticsTruncated: false
});
if (filteredList.sessions.some((session) => session.scoreType !== 'practice' || session.eventId !== 'event-a')) throw new Error('Score filters returned a non-matching session.');

progress('creating the mixed-history filter regression team');
const mixedTeam = await call('createTeam', coach.idToken, { name: `Phase 6 mixed history ${suffix}` });
const mixedBase = Date.UTC(2026, 5, 1);
const mixedWrites = [
  ...Array.from({ length: 510 }, (_, index) => sessionWrite(
    mixedTeam.teamId,
    index,
    new Date(mixedBase + index * 60_000),
    { scoreType: 'match', eventId: 'event-b' }
  )),
  ...Array.from({ length: 7 }, (_, index) => sessionWrite(
    mixedTeam.teamId,
    510 + index,
    new Date(mixedBase - (index + 1) * 60_000),
    { scoreType: 'practice', eventId: 'event-a' }
  ))
];
await commitWrites(mixedWrites);
progress('checking that predicates run before the 501-record cap');
const mixedFilters = { teamId: mixedTeam.teamId, scoreType: 'practice', eventId: 'event-a' };
const mixedList = await call('listScoreSessions', coach.idToken, mixedFilters);
const mixedExport = await call('exportScoreReport', coach.idToken, mixedFilters);
assertBoundary('mixed-history filtered regression', mixedList, mixedExport, {
  count: 7,
  teamId: mixedTeam.teamId,
  historyTruncated: false,
  statisticsTruncated: false
});
if (mixedList.sessions.some((session) => session.scoreType !== 'practice' || session.eventId !== 'event-a')) throw new Error('Mixed-history regression returned a non-matching session.');

const exportTeamId = teams.get(50);
progress('checking Student export denial and cross-team list denial');
const invitation = await call('createInvitation', coach.idToken, { teamId: exportTeamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: invitation.invitationId });
await callFails('exportScoreReport', student.idToken, { teamId: exportTeamId }, 'PERMISSION_DENIED');
await callFails('listScoreSessions', student.idToken, { teamId: filterTeamId }, 'PERMISSION_DENIED');

const replayTeamId = teams.get(0);
progress('checking score operation replay identity');
const definition = await call('createScoreDefinition', coach.idToken, {
  teamId: replayTeamId,
  definitionId: `definition-${suffix}`,
  title: 'Replay definition',
  season: '2026',
  missions: [{ id: 'mission-1', name: 'Mission 1', maxPoints: 20 }],
  deductions: []
});
const replayInput = {
  teamId: replayTeamId,
  sessionId: `replay-a-${suffix}`,
  operationId: `operation-${suffix}`,
  scoreDefinitionId: definition.definitionId,
  title: 'Replay session',
  scoreType: 'practice',
  sessionDate: '2026-08-09T12:00:00.000Z',
  missions: [{ missionId: 'mission-1', points: 20, completed: true }],
  deductions: []
};
const created = await call('createScoreSession', coach.idToken, replayInput);
const replayed = await call('createScoreSession', coach.idToken, { ...replayInput, sessionId: `replay-b-${suffix}` });
if (created.sessionId !== replayInput.sessionId || replayed.sessionId !== replayInput.sessionId) throw new Error('Score operation replay did not return the originally committed session ID.');
await readDocument(`scoreSessions/${replayInput.sessionId}`);
await readDocument(`scoreSessions/replay-b-${suffix}`, 404);

clearTimeout(suiteTimeout);
exiting = true;
await new Promise((resolve) => globalThis.process.stdout.write(
  `[phase6 +${elapsedSeconds()}s] PASS: 0/50/51/500/501 list/stat/export boundaries, >501 mixed-history filters, team scope, export role denial, CSV rows, and score operation replay.\n`,
  resolve
));
globalThis.process.exit(0);
