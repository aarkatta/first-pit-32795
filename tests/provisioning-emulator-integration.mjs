/**
 * Coach-provisioned member accounts, end to end against the emulator suite.
 *
 * The assertions that matter here are the ones a unit test cannot make: that
 * the generated password really signs the member in, that it stops working
 * once they choose their own, and that a coach's reset lever reaches only the
 * accounts their own team created.
 */
const projectId = 'demo-first-pit-provisioning';
// Ports are overridable so this suite can run beside a `npm run emulators`
// session on the defaults — see "Testing layout" in CLAUDE.md.
const authPort = process.env.FIRST_PIT_AUTH_PORT ?? '9099';
const functionsPort = process.env.FIRST_PIT_FUNCTIONS_PORT ?? '5001';
const firestorePort = process.env.FIRST_PIT_FIRESTORE_PORT ?? '8080';
const authBase = `http://127.0.0.1:${authPort}`;
const functionsBase = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'ProvisionPass123!';

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

async function signIn(email, secret) {
  return json(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: secret, returnSecureToken: true })
  });
}

async function signInSucceeds(email, secret, label) {
  const { response, body } = await signIn(email, secret);
  if (response.status !== 200) throw new Error(`${label}: sign-in failed: ${JSON.stringify(body)}`);
  return body;
}

async function signInFails(email, secret, label) {
  const { response } = await signIn(email, secret);
  if (response.status === 200) throw new Error(`${label}: sign-in unexpectedly succeeded.`);
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
  return { ...user, ...(await signInSucceeds(user.email, password, 'verified user refresh')) };
}

let operationCounter = 0;
function withOperationId(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if ('operationId' in data) return data;
  operationCounter += 1;
  return { ...data, operationId: `provision-op-${operationCounter}` };
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
  if (expectedStatus && body.error?.status !== expectedStatus) {
    throw new Error(`${name} failed with ${body.error?.status ?? 'an unknown status'} instead of ${expectedStatus}: ${JSON.stringify(body)}`);
  }
}

async function readDocument(path) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status !== 200) throw new Error(`Could not read ${path}: ${JSON.stringify(body)}`);
  return body.fields ?? {};
}

async function createDocument(collection, documentId, fields) {
  const { response, body } = await json(`${firestoreBase}/${collection}?documentId=${encodeURIComponent(documentId)}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (response.status !== 200) throw new Error(`Could not create ${collection}/${documentId}: ${JSON.stringify(body)}`);
}

async function auditActions(teamId, targetUserId) {
  const { response, body } = await json(`${firestoreBase}:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'auditEvents' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'teamId' }, op: 'EQUAL', value: { stringValue: teamId } } },
              { fieldFilter: { field: { fieldPath: 'targetUserId' }, op: 'EQUAL', value: { stringValue: targetUserId } } }
            ]
          }
        }
      }
    })
  });
  if (response.status !== 200) throw new Error(`Could not query auditEvents: ${JSON.stringify(body)}`);
  return body
    .filter((row) => row.document)
    .map((row) => row.document.fields?.metadata?.mapValue?.fields?.action?.stringValue ?? null);
}

const TEMP_PASSWORD_SHAPE = /^[A-Z][a-z]{3,5}-[A-Z][a-z]{3,5}-[A-Z][a-z]{3,5}-\d{4}$/;

const suffix = Date.now();
const coach = await createUser(`provision-coach-${suffix}@example.com`);
const outsider = await createUser(`provision-outsider-${suffix}@example.com`);
let selfSignedMentor = await createUser(`provision-mentor-${suffix}@example.com`);

await call('setAccountType', coach.idToken, { accountType: 'coach' });
const team = await call('createTeam', coach.idToken, { name: `Provisioning ${suffix}`, teamNumber: '4321' });
const teamId = team.teamId;

// --- Input validation -------------------------------------------------------
const studentEmail = `provision-student-${suffix}@example.com`;
await callFails('provisionTeamMember', coach.idToken, { teamId, displayName: 'A', email: studentEmail }, 'INVALID_ARGUMENT');
await callFails('provisionTeamMember', coach.idToken, { teamId, displayName: 'Ada Lovelace', email: 'not-an-email' }, 'INVALID_ARGUMENT');
await callFails('provisionTeamMember', coach.idToken, { teamId, displayName: 'Ada Lovelace', email: studentEmail, role: 'teamLeader' }, 'INVALID_ARGUMENT');

// Only an active coach or team leader may provision.
await callFails('provisionTeamMember', outsider.idToken, { teamId, displayName: 'Ada Lovelace', email: studentEmail }, 'PERMISSION_DENIED');

// An address that already has an account is never attached without consent.
await callFails('provisionTeamMember', coach.idToken, { teamId, displayName: 'Coach Again', email: coach.email }, 'ALREADY_EXISTS');

// --- Provisioning a student -------------------------------------------------
const provisioned = await call('provisionTeamMember', coach.idToken, {
  teamId, displayName: '  Ada   Lovelace ', email: studentEmail.toUpperCase(), operationId: 'op-provision-student'
});
if (!TEMP_PASSWORD_SHAPE.test(provisioned.temporaryPassword)) throw new Error(`Temporary password had an unexpected shape: ${provisioned.temporaryPassword}`);
if (provisioned.email !== studentEmail) throw new Error('The provisioned email was not normalized to lower case.');
if (provisioned.displayName !== 'Ada Lovelace') throw new Error('The provisioned name was not whitespace-collapsed.');
if (provisioned.role !== 'student') throw new Error('Provisioning did not default to the student role.');
if (provisioned.replayed !== false) throw new Error('A first provision reported itself as a replay.');

const studentId = provisioned.userId;
const profile = await readDocument(`users/${studentId}`);
if (profile.mustSetPassword?.booleanValue !== true) throw new Error('A provisioned member was not flagged to set a password.');
if (profile.provisionedByTeamId?.stringValue !== teamId) throw new Error('The profile does not record the provisioning team.');
if (profile.provisionedBy?.stringValue !== coach.localId) throw new Error('The profile does not record the provisioning coach.');
if (profile.accountType?.stringValue !== 'student') throw new Error('A provisioned student did not get the student account type.');
if (profile.displayName?.stringValue !== 'Ada Lovelace') throw new Error('The profile is missing the display name.');
if (!Object.prototype.hasOwnProperty.call(profile, 'photoURL')) throw new Error('The profile is missing photoURL, which the client would then backfill.');

const membership = await readDocument(`memberships/${teamId}_${studentId}`);
if (membership.status?.stringValue !== 'active' || membership.role?.stringValue !== 'student') throw new Error('Provisioning did not create an active student membership.');

if (!(await auditActions(teamId, studentId)).includes('member.provisioned')) throw new Error('Provisioning wrote no audit event.');

// The receipt must never carry the credential.
const receipt = await readDocument(`phase2Operations/${teamId}_member.provision_op-provision-student`);
if (JSON.stringify(receipt).toLowerCase().includes(provisioned.temporaryPassword.toLowerCase())) throw new Error('The operation receipt stored the temporary password.');
if (receipt.userId?.stringValue !== studentId) throw new Error('The operation receipt does not name the created member.');

// The roster tells a coach which accounts they may reset, and tells nobody else.
const coachRoster = await call('listTeamMembers', coach.idToken, { teamId });
const studentRow = coachRoster.members.find((member) => member.userId === studentId);
if (studentRow?.provisionedByThisTeam !== true) throw new Error('The coach roster does not mark the provisioned member.');
if (studentRow?.mustSetPassword !== true) throw new Error('The coach roster does not show that the member still owes a password.');
const coachRow = coachRoster.members.find((member) => member.userId === coach.localId);
if (coachRow?.provisionedByThisTeam !== false) throw new Error('The coach roster wrongly marks a self-registered account as provisioned.');

// The password the coach was handed actually works.
let studentSession = await signInSucceeds(studentEmail, provisioned.temporaryPassword, 'provisioned student');
if (studentSession.idToken === undefined) throw new Error('The provisioned student received no session.');

// --- Replay -----------------------------------------------------------------
const replay = await call('provisionTeamMember', coach.idToken, {
  teamId, displayName: 'Ada Lovelace', email: studentEmail, operationId: 'op-provision-student'
});
if (replay.userId !== studentId) throw new Error('A replayed provision returned a different member.');
if (replay.temporaryPassword !== null || replay.replayed !== true) throw new Error('A replayed provision leaked or re-minted a password.');

// A second provision of the same address is refused outright.
await callFails('provisionTeamMember', coach.idToken, { teamId, displayName: 'Ada Twice', email: studentEmail }, 'ALREADY_EXISTS');

// --- The member sets their own password -------------------------------------
await callFails('setInitialPassword', studentSession.idToken, { newPassword: 'short' }, 'INVALID_ARGUMENT');
await callFails('setInitialPassword', studentSession.idToken, { newPassword: 'Password123' }, 'INVALID_ARGUMENT');
await callFails('setInitialPassword', studentSession.idToken, { newPassword: studentEmail }, 'INVALID_ARGUMENT');
await callFails('setInitialPassword', studentSession.idToken, { newPassword: studentEmail.split('@')[0] }, 'INVALID_ARGUMENT');

const chosenPassword = 'my robot is fast';
await call('setInitialPassword', studentSession.idToken, { newPassword: chosenPassword });
if ((await readDocument(`users/${studentId}`)).mustSetPassword?.booleanValue !== false) throw new Error('Setting a password did not clear the prompt.');
await signInFails(studentEmail, provisioned.temporaryPassword, 'the coach-issued password after the member changed it');
studentSession = await signInSucceeds(studentEmail, chosenPassword, 'the member-chosen password');

// The gate closes behind them.
await callFails('setInitialPassword', studentSession.idToken, { newPassword: 'another good one' }, 'FAILED_PRECONDITION');

// A teammate has no business knowing who has not finished signing in.
const memberRoster = await call('listTeamMembers', studentSession.idToken, { teamId });
for (const member of memberRoster.members) {
  if ('mustSetPassword' in member || 'provisionedByThisTeam' in member) {
    throw new Error('listTeamMembers leaked provisioning fields to a non-admin.');
  }
}

// --- Coach-initiated reset --------------------------------------------------
await callFails('resetTeamMemberPassword', outsider.idToken, { teamId, userId: studentId }, 'PERMISSION_DENIED');
await callFails('resetTeamMemberPassword', studentSession.idToken, { teamId, userId: studentId }, 'PERMISSION_DENIED');
await callFails('resetTeamMemberPassword', coach.idToken, { teamId, userId: 'no-such-member' }, 'NOT_FOUND');

const reset = await call('resetTeamMemberPassword', coach.idToken, { teamId, userId: studentId, operationId: 'op-reset-student' });
if (!TEMP_PASSWORD_SHAPE.test(reset.temporaryPassword)) throw new Error(`The reset password had an unexpected shape: ${reset.temporaryPassword}`);
await signInFails(studentEmail, chosenPassword, 'the member password after a coach reset');
studentSession = await signInSucceeds(studentEmail, reset.temporaryPassword, 'the reset password');
if ((await readDocument(`users/${studentId}`)).mustSetPassword?.booleanValue !== true) throw new Error('A reset did not re-arm the password prompt.');
if (!(await auditActions(teamId, studentId)).includes('member.password.reset')) throw new Error('A coach-initiated reset wrote no audit event.');

const resetReplay = await call('resetTeamMemberPassword', coach.idToken, { teamId, userId: studentId, operationId: 'op-reset-student' });
if (resetReplay.temporaryPassword !== null || resetReplay.replayed !== true) throw new Error('A replayed reset leaked or re-minted a password.');
// The replay must not have changed the credential again.
await signInSucceeds(studentEmail, reset.temporaryPassword, 'the reset password after a replayed reset');

// --- A member who signed up on their own is out of reach --------------------
const mentorInvitation = await call('createInvitation', coach.idToken, { teamId, email: selfSignedMentor.email, role: 'mentor' });
selfSignedMentor = await verifyUser(selfSignedMentor);
await call('acceptInvitation', selfSignedMentor.idToken, { invitationId: mentorInvitation.invitationId });
// Before their client has written a profile at all...
await callFails('resetTeamMemberPassword', coach.idToken, { teamId, userId: selfSignedMentor.localId }, 'FAILED_PRECONDITION');
// ...and once it has, which is the ordinary case: a profile with no
// provisioning record belongs to the person, not to the team.
await createDocument('users', selfSignedMentor.localId, {
  uid: { stringValue: selfSignedMentor.localId },
  email: { stringValue: selfSignedMentor.email },
  displayName: { stringValue: 'Self Registered Mentor' },
  photoURL: { nullValue: null }
});
await callFails('resetTeamMemberPassword', coach.idToken, { teamId, userId: selfSignedMentor.localId }, 'FAILED_PRECONDITION');
await signInSucceeds(selfSignedMentor.email, password, 'a self-registered mentor after a refused reset');

// A provisioned member whose membership is gone is out of reach too.
await call('updateMembershipStatus', coach.idToken, { teamId, userId: studentId, status: 'removed' });
await callFails('resetTeamMemberPassword', coach.idToken, { teamId, userId: studentId }, 'FAILED_PRECONDITION');

console.log('Provisioning emulator integration checks passed.');
