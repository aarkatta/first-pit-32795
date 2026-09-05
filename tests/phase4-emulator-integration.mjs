const projectId = 'demo-first-pit-phase4';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase4Pass123!';

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

async function callFails(name, token, data) {
  const { response } = await json(`${functionsBase}/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: withOperationId(data) }) });
  if (response.status === 200) throw new Error(`${name} unexpectedly succeeded.`);
}

async function readDocument(path, token, expectedStatus = 200) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== expectedStatus) throw new Error(`Expected ${expectedStatus} for ${path}, received ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const suffix = Date.now();
const coach = await createUser(`phase4-coach-${suffix}@example.com`);
const secondCoach = await createUser(`phase4-coach2-${suffix}@example.com`);
const thirdCoach = await createUser(`phase4-coach3-${suffix}@example.com`);
const student = await createUser(`phase4-student-${suffix}@example.com`);
const parent = await createUser(`phase4-parent-${suffix}@example.com`);
const team = await call('createTeam', coach.idToken, { name: `Phase 4 Integration ${suffix}` });
const teamId = team.teamId;
for (const [account, role] of [[secondCoach, 'coach'], [thirdCoach, 'coach'], [student, 'student'], [parent, 'parent']]) {
  const invitation = await call('createInvitation', coach.idToken, { teamId, email: account.email, role });
  await call('acceptInvitation', account.idToken, { invitationId: invitation.invitationId });
}
await call('updateTeamPolicy', coach.idToken, { teamId, directMessaging: 'coachesOnly', messageRetentionDays: 30 });
const channel = await call('createChannel', coach.idToken, { teamId, channelId: `channel-${suffix}`, name: 'Practice', description: 'Robot practice coordination' });
const coachesChannel = await call('createChannel', coach.idToken, { teamId, channelId: `coaches-${suffix}`, name: 'Coach notes', visibility: 'coaches' });
const direct = await call('createChannel', coach.idToken, { teamId, channelId: `direct-${suffix}`, name: 'Coach direct', visibility: 'direct', participantUserIds: [coach.localId, secondCoach.localId] });
const message = await call('sendMessage', student.idToken, { teamId, channelId: channel.channelId, messageId: `message-${suffix}`, operationId: `message-${suffix}`, body: `Practice update @${coach.localId}` });
await call('sendMessage', student.idToken, { teamId, channelId: channel.channelId, messageId: `message-${suffix}`, operationId: `message-${suffix}`, body: `Practice update @${coach.localId}` });
await callFails('sendMessage', coach.idToken, { teamId, channelId: coachesChannel.channelId, body: `Private note @${student.localId}` });
const reply = await call('sendMessage', coach.idToken, { teamId, channelId: channel.channelId, parentMessageId: message.messageId, body: 'Thanks for the update.' });
const directMessage = await call('sendMessage', coach.idToken, { teamId, channelId: direct.channelId, body: 'Coach-only private note.' });
const coachesMessage = await call('sendMessage', coach.idToken, { teamId, channelId: coachesChannel.channelId, body: 'All-coaches practice note.' });
await call('toggleReaction', coach.idToken, { teamId, messageId: message.messageId, reaction: '👍' });
await call('toggleReaction', coach.idToken, { teamId, messageId: message.messageId, reaction: '👍' });
await call('markChannelRead', student.idToken, { teamId, channelId: channel.channelId });
await call('toggleChannelMute', student.idToken, { teamId, channelId: channel.channelId, muted: true });
await call('toggleChannelMute', student.idToken, { teamId, channelId: channel.channelId, muted: false });
const announcement = await call('createAnnouncement', coach.idToken, { teamId, channelId: channel.channelId, title: 'Saturday practice', body: 'Bring the finished attachment.', acknowledgementRequired: true });
await call('acknowledgeAnnouncement', student.idToken, { teamId, announcementId: announcement.announcementId });
const mentionNotificationId = globalThis.Buffer.from(`${coach.localId}_${teamId}_message:${message.messageId}`).toString('base64url');
const announcementNotificationId = globalThis.Buffer.from(`${student.localId}_${teamId}_announcement:${announcement.announcementId}`).toString('base64url');
await readDocument(`notifications/${mentionNotificationId}`, coach.idToken);
await readDocument(`notifications/${announcementNotificationId}`, student.idToken);
const search = await call('searchMessages', student.idToken, { teamId, query: 'practice', pageSize: 10 });
if (!search.messages.some((entry) => entry.id === message.messageId)) throw new Error('Authorized message search did not return the team message.');
const report = await call('createReport', student.idToken, { teamId, targetType: 'content', targetResource: `messages/${message.messageId}`, reasonCode: 'chat-content', description: 'Integration report.' });
await readDocument(`moderationCases/${report.moderationCaseId}`, coach.idToken);
const exported = await call('exportTeamMessages', coach.idToken, { teamId, channelId: channel.channelId });
if (!exported.messages.some((entry) => entry.id === message.messageId) || exported.truncated) throw new Error('Authorized bounded message export failed.');
const participantExport = await call('exportTeamMessages', secondCoach.idToken, { teamId, channelId: direct.channelId });
if (!participantExport.messages.some((entry) => entry.id === directMessage.messageId)) throw new Error('A direct-channel participant could not export the conversation.');
await callFails('exportTeamMessages', thirdCoach.idToken, { teamId, channelId: direct.channelId });
const nonparticipantTeamExport = await call('exportTeamMessages', thirdCoach.idToken, { teamId });
if (nonparticipantTeamExport.messages.some((entry) => entry.id === directMessage.messageId)) throw new Error('A team-wide export leaked an inaccessible direct conversation.');
if (!nonparticipantTeamExport.messages.some((entry) => entry.id === message.messageId)
  || !nonparticipantTeamExport.messages.some((entry) => entry.id === coachesMessage.messageId)) throw new Error('A coach team-wide export omitted an accessible team or coaches channel.');
await callFails('exportTeamMessages', student.idToken, { teamId });
await callFails('exportTeamMessages', parent.idToken, { teamId });
await readDocument(`messages/${message.messageId}`, student.idToken);
await readDocument(`messages/${reply.messageId}`, coach.idToken);
await readDocument(`messages/${directMessage.messageId}`, secondCoach.idToken);
await readDocument(`messages/${directMessage.messageId}`, student.idToken, 403);
await readDocument(`messages/${directMessage.messageId}`, parent.idToken, 403);
await readDocument(`channels/${coachesChannel.channelId}`, student.idToken, 403);
await callFails('createChannel', student.idToken, { teamId, name: 'Student direct', visibility: 'direct', participantUserIds: [student.localId, coach.localId] });
await callFails('sendMessage', student.idToken, { teamId, channelId: channel.channelId, body: 'Attachment attempt', attachmentFileIds: ['not-approved'] });
globalThis.console.log('Phase 4 Functions integration passed: channels, threads, reactions, mentions, read/mute state, announcements, acknowledgements, authorized search, reporting, policy-gated direct messages, and attachment denial.');
