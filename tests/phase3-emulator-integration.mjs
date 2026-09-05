const projectId = 'demo-first-pit-phase3';
const authBase = 'http://127.0.0.1:9099';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Phase3Pass123!';

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

async function callFails(name, token, data, expectedStatus) {
  const { response, body } = await json(`${functionsBase}/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: withOperationId(data) }) });
  if (response.status === 200) throw new Error(`${name} unexpectedly succeeded.`);
  if (expectedStatus && body.error?.status !== expectedStatus) throw new Error(`${name} failed with ${body.error?.status ?? 'an unknown status'} instead of ${expectedStatus}: ${JSON.stringify(body)}`);
  return body;
}

async function readDocument(path, token) {
  const { response, body } = await json(`${firestoreBase}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error(`Could not read ${path}: ${JSON.stringify(body)}`);
  return body;
}

const suffix = Date.now();
const coach = await createUser(`phase3-coach-${suffix}@example.com`);
const student = await createUser(`phase3-student-${suffix}@example.com`);
const mentor = await createUser(`phase3-mentor-${suffix}@example.com`);
const parent = await createUser(`phase3-parent-${suffix}@example.com`);
const team = await call('createTeam', coach.idToken, { name: `Phase 3 Integration ${suffix}` });
const teamId = team.teamId;
const invitation = await call('createInvitation', coach.idToken, { teamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: invitation.invitationId });
const mentorInvitation = await call('createInvitation', coach.idToken, { teamId, email: mentor.email, role: 'mentor' });
await call('acceptInvitation', mentor.idToken, { invitationId: mentorInvitation.invitationId });
const parentInvitation = await call('createInvitation', coach.idToken, { teamId, email: parent.email, role: 'parent' });
await call('acceptInvitation', parent.idToken, { invitationId: parentInvitation.invitationId });
await call('updateTeamPolicy', coach.idToken, { teamId, fileSharing: 'teamOnly' });

const taskInput = { teamId, taskId: `task-${suffix}`, operationId: `create-${suffix}`, title: 'Run drivetrain test', assignedTo: student.localId, priority: 'high', dueAt: '2026-09-01T15:00:00.000Z' };
await call('createTask', coach.idToken, taskInput);
await call('createTask', coach.idToken, taskInput);
const task = await readDocument(`tasks/${taskInput.taskId}`, coach.idToken);
if (task.fields.title?.stringValue !== taskInput.title) throw new Error('Task was not stored.');
await call('updateTask', student.idToken, { teamId, taskId: taskInput.taskId, operationId: `status-${suffix}`, status: 'inProgress' });
const notification = await readDocument(`notifications/${globalThis.Buffer.from(`${student.localId}_${teamId}_task:${taskInput.taskId}:assigned`).toString('base64url')}`, student.idToken);
if (notification.fields.recipientUserId?.stringValue !== student.localId) throw new Error('Task notification was not deduplicated for the assignee.');

const goal = await call('createGoal', coach.idToken, { teamId, goalId: `goal-${suffix}`, operationId: `goal-${suffix}`, title: 'Tournament readiness' });
const event = await call('createEvent', coach.idToken, { teamId, eventId: `event-${suffix}`, operationId: `event-${suffix}`, title: 'Weekly practice', startsAt: '2026-08-10T16:00:00.000Z', endsAt: '2026-08-10T17:00:00.000Z', recurrence: { frequency: 'weekly', interval: 1, count: 3 }, linkedTaskIds: [taskInput.taskId], reminderMinutes: [30] });
if (!goal.goalId || !event.recurring) throw new Error('Goal or recurring event was not created.');
await readDocument(`eventOccurrences/${event.eventId}_1786377600000`, coach.idToken);
await call('markNotificationRead', student.idToken, { teamId, notificationId: notification.name.split('/').pop() });

const defaultProject = await call('ensureDefaultProject', coach.idToken, { teamId });
if (!defaultProject.projectId) throw new Error('The legacy Team Board was not created.');
const project = await call('createProject', coach.idToken, { teamId, operationId: `project-${suffix}`, name: 'Robot project' });
const testingColumn = await call('addProjectColumn', coach.idToken, { teamId, projectId: project.projectId, operationId: `column-${suffix}`, name: 'Testing', color: 'purple' });
const kanbanTask = await call('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `kanban-task-${suffix}`, title: 'Assigned robot review', assignedTo: student.localId, goalId: goal.goalId });
const unassignedTask = await call('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `unassigned-task-${suffix}`, title: 'Unassigned coach task' });
await callFails('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: unassignedTask.taskId, columnId: testingColumn.columnId, expectedVersion: 1, operationId: `student-unassigned-move-${suffix}` }, 'PERMISSION_DENIED');
await call('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: testingColumn.columnId, expectedVersion: 1, operationId: `student-move-${suffix}` });
const movedTask = await readDocument(`tasks/${kanbanTask.taskId}`, student.idToken);
if (movedTask.fields.columnId?.stringValue !== testingColumn.columnId || movedTask.fields.version?.integerValue !== '2') throw new Error('A student could not move their assigned team card.');
await call('moveTaskCard', coach.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'completed', expectedVersion: 2, operationId: `coach-move-${suffix}` });
const completedGoal = await readDocument(`goals/${goal.goalId}`, coach.idToken);
if (completedGoal.fields.taskCount?.integerValue !== '1' || completedGoal.fields.completedTaskCount?.integerValue !== '1') throw new Error('Kanban completion did not update the linked goal counters.');
await callFails('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 1, operationId: `stale-move-${suffix}` }, 'ABORTED');
await callFails('moveTaskCard', mentor.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 3, operationId: `mentor-move-${suffix}` }, 'PERMISSION_DENIED');
await callFails('moveTaskCard', parent.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 3, operationId: `parent-move-${suffix}` }, 'PERMISSION_DENIED');

const migrationTeam = await call('createTeam', coach.idToken, { name: `Migration guard ${suffix}` });
const migrationInvitation = await call('createInvitation', coach.idToken, { teamId: migrationTeam.teamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: migrationInvitation.invitationId });
await callFails('ensureDefaultProject', student.idToken, { teamId: migrationTeam.teamId }, 'PERMISSION_DENIED');

if (process.env.STORAGE_EMULATOR_HOST) {
  const { deleteApp, initializeApp } = await import('firebase/app');
  const { connectAuthEmulator, getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
  const { connectStorageEmulator, getStorage, ref, uploadBytes } = await import('firebase/storage');
  const createStorageClient = async (name, email) => {
    const app = initializeApp({ apiKey: 'demo-api-key', projectId, storageBucket: `${projectId}.appspot.com` }, name);
    const auth = getAuth(app);
    connectAuthEmulator(auth, authBase, { disableWarnings: true });
    await signInWithEmailAndPassword(auth, email, password);
    const storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    return { app, storage };
  };
  const coachStorage = await createStorageClient(`coach-storage-${suffix}`, coach.email);
  const studentStorage = await createStorageClient(`student-storage-${suffix}`, student.email);
  const upload = await call('createFileMetadata', coach.idToken, { teamId, fileId: `file-${suffix}`, name: 'plan.txt', contentType: 'text/plain', sizeBytes: 5 });
  await uploadBytes(ref(studentStorage.storage, upload.storagePath), new globalThis.Blob(['hello'], { type: 'text/plain' })).then(
    () => { throw new Error('A non-uploader claimed a pending upload.'); },
    () => undefined
  );
  await uploadBytes(ref(coachStorage.storage, upload.storagePath), new globalThis.Blob(['hello'], { type: 'text/plain' }));
  const firstCompletion = await call('completeFileUpload', coach.idToken, { teamId, fileId: upload.fileId });
  const replayedCompletion = await call('completeFileUpload', coach.idToken, { teamId, fileId: upload.fileId });
  if (firstCompletion.auditEventId !== replayedCompletion.auditEventId || firstCompletion.status !== 'ready') throw new Error('Upload completion replay was not atomic and idempotent.');
  const completedFile = await readDocument(`fileMetadata/${upload.fileId}`, coach.idToken);
  if (completedFile.fields.status?.stringValue !== 'ready') throw new Error('Completed upload metadata was not committed.');
  if (completedFile.fields.scanStatus?.stringValue !== 'clean') throw new Error('A completed upload was not marked scanned.');

  // A file whose bytes contradict its declared content type must be blocked at
  // completion. storage.rules compares the upload's content type against the
  // value the same client stored, so the byte check is the only thing standing
  // between a disguised binary and a download link.
  const disguised = await call('createFileMetadata', coach.idToken, { teamId, fileId: `disguised-${suffix}`, name: 'notes.txt', contentType: 'text/plain', sizeBytes: 8 });
  await uploadBytes(
    ref(coachStorage.storage, disguised.storagePath),
    new globalThis.Blob([new globalThis.Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'text/plain' })
  );
  await callFails('completeFileUpload', coach.idToken, { teamId, fileId: disguised.fileId }, 'FAILED_PRECONDITION');
  const blockedFile = await readDocument(`fileMetadata/${disguised.fileId}`, coach.idToken);
  if (blockedFile.fields.scanStatus?.stringValue !== 'blocked') throw new Error('A mismatched upload was not marked blocked.');
  if (blockedFile.fields.status?.stringValue === 'ready') throw new Error('A mismatched upload was published anyway.');

  await Promise.all([deleteApp(coachStorage.app), deleteApp(studentStorage.app)]);
}

globalThis.console.log('Phase 3 and Release 1.1 integration passed: admin-only migration, assigned Student movement, upload ownership/atomic replay when Storage is available, notifications, goal counters, and recurring events.');
