const projectId = 'demo-first-pit-phase2';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase2Pass123!';

async function json(url, options = {}) {
  const response = await globalThis.fetch(url, options);
  const body = await response.json();
  return { response, body };
}

async function createUser(email) {
  const { response, body } = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (response.status !== 200) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function verifyUser(user) {
  const sent = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: user.idToken })
  });
  if (sent.response.status !== 200) throw new Error(`Could not send verification for ${user.email}: ${JSON.stringify(sent.body)}`);
  const codes = await json(`${authBase}/emulator/v1/projects/${projectId}/oobCodes`);
  const code = codes.body.oobCodes?.findLast((entry) => entry.email === user.email && entry.requestType === 'VERIFY_EMAIL')?.oobCode;
  if (!code) throw new Error(`No verification code was recorded for ${user.email}.`);
  const applied = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code })
  });
  if (applied.response.status !== 200) throw new Error(`Could not verify ${user.email}: ${JSON.stringify(applied.body)}`);
  const refreshed = await json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password, returnSecureToken: true })
  });
  if (refreshed.response.status !== 200) throw new Error(`Could not refresh ${user.email}: ${JSON.stringify(refreshed.body)}`);
  return { ...user, ...refreshed.body };
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
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: withOperationId(data) })
  });
  if (response.status !== 200) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body.data ?? body.result ?? body;
}

async function callFails(name, token, data, expectedStatus) {
  const { response, body } = await json(`${functionsBase}/${name}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: withOperationId(data) })
  });
  if (response.status === 200) throw new Error(`${name} unexpectedly succeeded.`);
  if (expectedStatus && body.error?.status !== expectedStatus) throw new Error(`${name} failed with ${body.error?.status ?? 'an unknown status'} instead of ${expectedStatus}: ${JSON.stringify(body)}`);
}

async function readDocument(path, token) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error(`Could not read ${path}: ${JSON.stringify(body)}`);
  return body;
}

async function patchDocument(path, fields) {
  const updateMask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const { response, body } = await json(`${firestoreBase}/${path}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (response.status !== 200) throw new Error(`Could not patch ${path}: ${JSON.stringify(body)}`);
}

async function assertDocumentMissing(path) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status !== 404) throw new Error(`Expected ${path} to be missing, received ${response.status}: ${JSON.stringify(body)}`);
}

const suffix = Date.now();
const coach = await createUser(`phase2-coach-${suffix}@example.com`);
let student = await createUser(`phase2-student-${suffix}@example.com`);
let mentor = await createUser(`phase2-mentor-${suffix}@example.com`);
const joiner = await createUser(`phase2-joiner-${suffix}@example.com`);
let expiredInvitee = await createUser(`phase2-expired-${suffix}@example.com`);

// Team creation is for coach and mentor accounts; the type is declared once.
await callFails('createTeam', joiner.idToken, { name: 'No account type yet', teamNumber: '2001' }, 'FAILED_PRECONDITION');
await call('setAccountType', student.idToken, { accountType: 'student' });
await callFails('createTeam', student.idToken, { name: 'Student team', teamNumber: '2002' }, 'PERMISSION_DENIED');
await callFails('setAccountType', student.idToken, { accountType: 'coach' }, 'FAILED_PRECONDITION');
const unchangedType = await call('setAccountType', student.idToken, { accountType: 'student' });
if (unchangedType.changed !== false) throw new Error('Re-declaring the same account type was not a no-op.');
await callFails('setAccountType', coach.idToken, { accountType: 'teamLeader' }, 'INVALID_ARGUMENT');
await call('setAccountType', coach.idToken, { accountType: 'coach' });
await callFails('createTeam', coach.idToken, { name: `Phase 2 Integration ${suffix}` }, 'INVALID_ARGUMENT');
const team = await call('createTeam', coach.idToken, { name: `Phase 2 Integration ${suffix}`, teamNumber: '1234' });
const teamId = team.teamId;
if ((await readDocument(`teams/${teamId}`, coach.idToken)).fields?.teamNumber?.stringValue !== '1234') throw new Error('createTeam did not store the team number.');
const invitation = await call('createInvitation', coach.idToken, { teamId, email: mentor.email, role: 'mentor', operationId: 'op-invite-mentor' });
await callFails('acceptInvitation', mentor.idToken, { invitationId: invitation.invitationId }, 'FAILED_PRECONDITION');
mentor = await verifyUser(mentor);
await call('acceptInvitation', mentor.idToken, { invitationId: invitation.invitationId });
await call('assignTeamRole', coach.idToken, { teamId, userId: mentor.localId, role: 'student', operationId: 'op-role-mentor' });
await call('createInvitation', coach.idToken, { teamId, email: student.email, role: 'student', operationId: 'op-invite-student' });
const studentInvitationId = `${teamId}_${globalThis.Buffer.from(student.email).toString('base64url')}`;
student = await verifyUser(student);
await call('acceptInvitation', student.idToken, { invitationId: studentInvitationId });

// Team details: coach / team leader only; name 2–80 chars, number required and digits only.
const teamName = `Phase 2 Integration ${suffix}`;
await callFails('updateTeamDetails', student.idToken, { teamId, name: teamName, teamNumber: '9999' }, 'PERMISSION_DENIED');
await callFails('updateTeamDetails', coach.idToken, { teamId, name: teamName, teamNumber: '12ab' }, 'INVALID_ARGUMENT');
await callFails('updateTeamDetails', coach.idToken, { teamId, name: 'x', teamNumber: '4242' }, 'INVALID_ARGUMENT');
await call('updateTeamDetails', coach.idToken, { teamId, name: `Renamed ${suffix}`, teamNumber: '4242' });
const renamed = (await readDocument(`teams/${teamId}`, student.idToken)).fields;
if (renamed?.teamNumber?.stringValue !== '4242' || renamed?.name?.stringValue !== `Renamed ${suffix}`) throw new Error('updateTeamDetails did not store the new name and number for members to read.');
// The number is mandatory: it can be changed but never cleared or left out.
await callFails('updateTeamDetails', coach.idToken, { teamId, name: teamName, teamNumber: null }, 'INVALID_ARGUMENT');
await callFails('updateTeamDetails', coach.idToken, { teamId, name: teamName, teamNumber: '' }, 'INVALID_ARGUMENT');
if ((await readDocument(`teams/${teamId}`, coach.idToken)).fields?.teamNumber?.stringValue !== '4242') throw new Error('A refused updateTeamDetails changed the team number.');
await call('updateTeamDetails', coach.idToken, { teamId, name: teamName, teamNumber: '1234' });

const expiredInvitation = await call('createInvitation', coach.idToken, { teamId, email: expiredInvitee.email, role: 'student', operationId: 'op-invite-expired' });
expiredInvitee = await verifyUser(expiredInvitee);
await patchDocument(`invitations/${expiredInvitation.invitationId}`, {
  expiresAt: { timestampValue: '2020-01-01T00:00:00.000Z' }
});
await callFails('acceptInvitation', expiredInvitee.idToken, { invitationId: expiredInvitation.invitationId }, 'FAILED_PRECONDITION');
const expiredRecord = await readDocument(`invitations/${expiredInvitation.invitationId}`, coach.idToken);
if (expiredRecord.fields.status?.stringValue !== 'expired') throw new Error('Expired invitation status did not commit before the callable denial.');
await assertDocumentMissing(`memberships/${teamId}_${expiredInvitee.localId}`);
await callFails('acceptInvitation', expiredInvitee.idToken, { invitationId: expiredInvitation.invitationId }, 'NOT_FOUND');

await call('updateTeamPolicy', coach.idToken, { teamId, directMessaging: 'coachesOnly', membershipApproval: 'coachApproval' });
const policy = await readDocument(`teamPolicies/${teamId}`, coach.idToken);
if (policy.fields.directMessaging?.stringValue !== 'coachesOnly' || policy.fields.discoverability?.stringValue !== 'private') throw new Error('Safety policy was not stored with safe discoverability.');

const joinRequest = await call('requestToJoinTeam', joiner.idToken, { teamId });
await call('approveJoinRequest', coach.idToken, { teamId, requestId: joinRequest.requestId });
await readDocument(`memberships/${teamId}_${joiner.localId}`, joiner.idToken);

const reportInput = { teamId, targetType: 'user', targetUserId: mentor.localId, reasonCode: 'safety-concern', description: 'Integration test report.', operationId: 'op-report-1' };
const report = await call('createReport', student.idToken, reportInput);
await readDocument(`moderationCases/${report.moderationCaseId}`, coach.idToken);

// Replaying the same operationId must return the original ids rather than
// opening a second case for one incident.
const replayedReport = await call('createReport', student.idToken, reportInput);
if (replayedReport.reportId !== report.reportId || replayedReport.moderationCaseId !== report.moderationCaseId) {
  throw new Error('createReport replay produced a duplicate report or moderation case.');
}

await call('updateModerationCase', coach.idToken, { teamId, caseId: report.moderationCaseId, status: 'resolved', action: 'none', expectedVersion: 1 });
// A stale expectedVersion must be refused instead of silently overwriting
// another coach's triage.
await callFails('updateModerationCase', coach.idToken, { teamId, caseId: report.moderationCaseId, status: 'dismissed', action: 'none', expectedVersion: 1 }, 'ABORTED');

const leaveResponse = await json(`${functionsBase}/leaveTeam`, {
  method: 'POST', headers: { Authorization: `Bearer ${coach.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { teamId } })
});
if (leaveResponse.response.status === 200) throw new Error('A sole coach was allowed to leave the team.');

// A coach-typed account that is a student on some team still cannot create one:
// the membership decides, so an invited student cannot relabel their way in.
let dual = await createUser(`phase2-dual-${suffix}@example.com`);
await call('setAccountType', dual.idToken, { accountType: 'coach' });
const guardTeam = await call('createTeam', coach.idToken, { name: `Phase 2 dual-role guard ${suffix}`, teamNumber: '2003' });
const dualInvitation = await call('createInvitation', coach.idToken, { teamId: guardTeam.teamId, email: dual.email, role: 'student' });
dual = await verifyUser(dual);
await call('acceptInvitation', dual.idToken, { invitationId: dualInvitation.invitationId });
await callFails('createTeam', dual.idToken, { name: 'Dual role team', teamNumber: '2004' }, 'PERMISSION_DENIED');

globalThis.console.log('Phase 2 Functions integration passed: team creation by account type, invitation verification/expiry, role assignment, policy update, join approval, report, moderation, and sole-coach protection.');
