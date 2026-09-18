const projectId = 'demo-first-pit-phase5';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase5Pass123!';

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
const coach = await createUser(`phase5-coach-${suffix}@example.com`);
const student = await createUser(`phase5-student-${suffix}@example.com`);
const parent = await createUser(`phase5-parent-${suffix}@example.com`);
// Only coach and mentor accounts create teams; the type is declared once.
await call('setAccountType', coach.idToken, { accountType: 'coach' });
const team = await call('createTeam', coach.idToken, { name: `Phase 5 Integration ${suffix}` });
const teamId = team.teamId;
const invitation = await call('createInvitation', coach.idToken, { teamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: invitation.invitationId });
const parentInvitation = await call('createInvitation', coach.idToken, { teamId, email: parent.email, role: 'parent' });
await call('acceptInvitation', parent.idToken, { invitationId: parentInvitation.invitationId });

const question = await call('createQuestion', student.idToken, { questionId: `question-${suffix}`, teamId, visibility: 'team', title: 'Programming sensor question', body: 'How should we debounce this sensor?', category: 'Programming', tags: ['programming', 'sensors'] });
const teamSearch = await call('searchQuestions', student.idToken, { teamId, query: 'programming' });
if (!teamSearch.questions.some((entry) => entry.id === question.questionId)) throw new Error('Authorized team question search did not return the question.');
const globalSearch = await call('searchQuestions', student.idToken, { query: 'programming' });
if (globalSearch.questions.some((entry) => entry.id === question.questionId)) throw new Error('Private team question leaked into community search.');
await call('toggleSavedQuestion', student.idToken, { questionId: question.questionId });
await readDocument(`savedQuestions/${student.localId}_${question.questionId}`, student.idToken);
const questionReport = await call('createReport', student.idToken, { teamId, targetType: 'content', targetResource: `questions/${question.questionId}`, reasonCode: 'knowledge-content', description: 'Acceptance moderation report.' });
await call('updateModerationCase', coach.idToken, { teamId, caseId: questionReport.moderationCaseId, status: 'resolved', action: 'remove-content', expectedVersion: 1 });
await readDocument(`questions/${question.questionId}`, student.idToken, 403);

const video = await call('createVideo', coach.idToken, { videoId: `video-${suffix}`, teamId, visibility: 'team', category: 'CAD', title: 'CAD drive guide', description: 'A safe CAD walkthrough.', externalUrl: 'https://example.com/cad', sourceAttribution: 'Team library', captionTracks: [{ language: 'en', url: 'https://example.com/cad.vtt', kind: 'captions' }, { language: 'en', url: 'https://example.com/cad.txt', kind: 'transcript' }] });
await call('updateVideoPublication', coach.idToken, { videoId: video.videoId, publicationStatus: 'published' });
const videoSearch = await call('searchVideos', student.idToken, { teamId, query: 'cad' });
if (!videoSearch.videos.some((entry) => entry.id === video.videoId && entry.transcriptAvailable)) throw new Error('Published CAD video or transcript metadata missing.');
await call('toggleVideoFavorite', student.idToken, { videoId: video.videoId });
await call('recordVideoWatch', student.idToken, { videoId: video.videoId, progressSeconds: 42 });
await readDocument(`videoFavorites/${student.localId}_${video.videoId}`, student.idToken);
await readDocument(`videoWatchHistory/${student.localId}_${video.videoId}`, student.idToken);

const poll = await call('createPoll', coach.idToken, { pollId: `poll-${suffix}`, teamId, question: 'Which practice slot works?', options: ['Saturday', 'Sunday'], anonymous: true, resultsVisibility: 'afterClose', expiresAt: new Date(Date.now() + 3600000).toISOString() });
const notificationId = globalThis.Buffer.from(`${student.localId}_${teamId}_poll:${poll.pollId}:published`).toString('base64url');
await readDocument(`notifications/${notificationId}`, student.idToken);
const listedBeforeVote = await call('listPolls', student.idToken, { teamId });
const hiddenBeforeVote = listedBeforeVote.polls.find((entry) => entry.id === poll.pollId);
if (!hiddenBeforeVote || 'totalVotes' in hiddenBeforeVote || 'optionVoteCounts' in hiddenBeforeVote || hiddenBeforeVote.resultsVisible !== false) throw new Error('Poll aggregates leaked through listPolls before voting.');
await call('votePoll', student.idToken, { pollId: poll.pollId, selectedOptionIds: ['option-1'] });
await callFails('votePoll', student.idToken, { pollId: poll.pollId, selectedOptionIds: ['option-2'] });
await callFails('getPollResults', student.idToken, { pollId: poll.pollId });
const listedAfterVote = await call('listPolls', student.idToken, { teamId });
const hiddenAfterVote = listedAfterVote.polls.find((entry) => entry.id === poll.pollId);
if (!hiddenAfterVote || 'totalVotes' in hiddenAfterVote || 'optionVoteCounts' in hiddenAfterVote) throw new Error('After-close poll aggregates leaked through listPolls after voting.');
await call('closePoll', coach.idToken, { pollId: poll.pollId });
const results = await call('getPollResults', student.idToken, { pollId: poll.pollId });
if (results.totalVotes !== 1 || results.optionVoteCounts['option-1'] !== 1) throw new Error('Authorized poll aggregate results are incorrect.');
const listedAfterClose = await call('listPolls', student.idToken, { teamId });
const visibleAfterClose = listedAfterClose.polls.find((entry) => entry.id === poll.pollId);
if (visibleAfterClose.totalVotes !== 1 || visibleAfterClose.optionVoteCounts['option-1'] !== 1 || visibleAfterClose.resultsVisible !== true) throw new Error('listPolls omitted authorized aggregates after close.');

const coachPoll = await call('createPoll', coach.idToken, { pollId: `coach-poll-${suffix}`, teamId, question: 'Coach-only decision?', options: ['Yes', 'No'], audienceRoles: ['coach'], resultsVisibility: 'afterClose' });
const studentPoll = await call('createPoll', coach.idToken, { pollId: `student-poll-${suffix}`, teamId, question: 'Student-only decision?', options: ['Yes', 'No'], audienceRoles: ['student'], resultsVisibility: 'always' });
const parentPoll = await call('createPoll', coach.idToken, { pollId: `parent-poll-${suffix}`, teamId, question: 'Parent-only decision?', options: ['Yes', 'No'], audienceRoles: ['parent'], resultsVisibility: 'afterVote' });

const coachPolls = await call('listPolls', coach.idToken, { teamId });
if (!coachPolls.polls.some((entry) => entry.id === coachPoll.pollId)
  || coachPolls.polls.some((entry) => entry.id === studentPoll.pollId)
  || coachPolls.polls.some((entry) => entry.id === parentPoll.pollId)) throw new Error('Coach poll listing did not enforce role audiences.');
await call('getPollResults', coach.idToken, { pollId: coachPoll.pollId });
await callFails('getPollResults', coach.idToken, { pollId: studentPoll.pollId });

const studentPolls = await call('listPolls', student.idToken, { teamId });
if (!studentPolls.polls.some((entry) => entry.id === studentPoll.pollId)
  || studentPolls.polls.some((entry) => entry.id === coachPoll.pollId)
  || studentPolls.polls.some((entry) => entry.id === parentPoll.pollId)) throw new Error('Student poll listing did not enforce role audiences.');
const studentAlwaysResults = await call('getPollResults', student.idToken, { pollId: studentPoll.pollId });
if (studentAlwaysResults.totalVotes !== 0) throw new Error('Student audience could not read always-visible results.');
await callFails('getPollResults', student.idToken, { pollId: coachPoll.pollId });
await call('closePoll', coach.idToken, { pollId: coachPoll.pollId });
await callFails('getPollResults', student.idToken, { pollId: coachPoll.pollId });

const parentPollsBeforeVote = await call('listPolls', parent.idToken, { teamId });
const parentBeforeVote = parentPollsBeforeVote.polls.find((entry) => entry.id === parentPoll.pollId);
if (!parentBeforeVote || parentPollsBeforeVote.polls.some((entry) => entry.id === coachPoll.pollId)
  || parentPollsBeforeVote.polls.some((entry) => entry.id === studentPoll.pollId)
  || 'totalVotes' in parentBeforeVote || 'optionVoteCounts' in parentBeforeVote) throw new Error('Parent poll listing or pre-vote result timing was incorrect.');
await callFails('getPollResults', parent.idToken, { pollId: parentPoll.pollId });
await call('votePoll', parent.idToken, { pollId: parentPoll.pollId, selectedOptionIds: ['option-1'] });
const parentAfterVote = await call('getPollResults', parent.idToken, { pollId: parentPoll.pollId });
if (parentAfterVote.totalVotes !== 1 || parentAfterVote.optionVoteCounts['option-1'] !== 1) throw new Error('Parent audience could not read after-vote results.');

const definition = await call('createScoreDefinition', coach.idToken, { teamId, definitionId: `definition-${suffix}`, title: 'Security score', season: '2026-2027', missions: [{ id: 'mission-1', name: 'Mission 1', maxPoints: 10 }] });
await call('updateMembershipStatus', coach.idToken, { teamId, userId: student.localId, status: 'suspended' });
await callFails('createQuestion', student.idToken, { questionId: `revoked-question-${suffix}`, teamId, visibility: 'team', title: 'Revoked question', body: 'This commit must be denied.', category: 'Programming' });
await callFails('createVideo', student.idToken, { videoId: `revoked-video-${suffix}`, teamId, visibility: 'team', category: 'CAD', title: 'Revoked video', description: 'This commit must be denied.', externalUrl: 'https://example.com/revoked', sourceAttribution: 'Test' });
await callFails('createScoreSession', student.idToken, { sessionId: `revoked-score-${suffix}`, teamId, scoreDefinitionId: definition.definitionId, title: 'Revoked score', scoreType: 'practice', sessionDate: new Date().toISOString(), missions: [{ missionId: 'mission-1', points: 10, completed: true }] });
await callFails('createReport', student.idToken, { teamId, targetType: 'content', targetResource: `questions/${question.questionId}`, reasonCode: 'revoked-report' });

globalThis.console.log('Phase 5 integration passed: team question/video authorization, revocation denial, anonymous poll constraints, sanitized result visibility, and deduplicated notification deep link.');
