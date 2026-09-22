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

/** Writes fields as the emulator owner, bypassing rules — for data an earlier version could create. */
async function patchAsOwner(path, fields) {
  const updateMask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const { response, body } = await json(`${firestoreBase}/${path}?${updateMask}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields })
  });
  if (response.status !== 200) throw new Error(`Could not patch ${path}: ${JSON.stringify(body)}`);
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
// Never invited anywhere: proves an import cannot assign work to a stranger.
const outsider = await createUser(`phase3-outsider-${suffix}@example.com`);
// Only coach and mentor accounts create teams; the type is declared once.
await call('setAccountType', coach.idToken, { accountType: 'coach' });
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
if (!goal.goalId) throw new Error('Goal was not created.');
await call('markNotificationRead', student.idToken, { teamId, notificationId: notification.name.split('/').pop() });

const defaultProject = await call('ensureDefaultProject', coach.idToken, { teamId });
if (!defaultProject.projectId) throw new Error('The legacy Team Board was not created.');
const project = await call('createProject', coach.idToken, { teamId, operationId: `project-${suffix}`, name: 'Robot project' });
const testingColumn = await call('addProjectColumn', coach.idToken, { teamId, projectId: project.projectId, operationId: `column-${suffix}`, name: 'Testing', color: 'purple' });
const kanbanTask = await call('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `kanban-task-${suffix}`, title: 'Assigned robot review', assignedTo: student.localId, goalId: goal.goalId });
const unassignedTask = await call('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `unassigned-task-${suffix}`, title: 'Unassigned coach task' });
// Students are task editors: they move any card, not only their own.
await call('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: unassignedTask.taskId, columnId: testingColumn.columnId, expectedVersion: 1, operationId: `student-unassigned-move-${suffix}` });
await call('updateTask', student.idToken, { teamId, taskId: unassignedTask.taskId, expectedVersion: 2, operationId: `student-edit-${suffix}`, title: 'Unassigned task a student renamed', priority: 'high', assignedTo: student.localId });
const studentEdited = await readDocument(`tasks/${unassignedTask.taskId}`, student.idToken);
if (studentEdited.fields.title?.stringValue !== 'Unassigned task a student renamed' || studentEdited.fields.assignedTo?.stringValue !== student.localId) throw new Error('A student could not edit a task\'s details.');
const studentCreated = await call('createKanbanTask', student.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `student-create-${suffix}`, title: 'Task a student added' });
const studentCard = await readDocument(`tasks/${studentCreated.taskId}`, student.idToken);
if (studentCard.fields.createdBy?.stringValue !== student.localId) throw new Error('A student-created task did not record its author.');
await callFails('createKanbanTask', mentor.idToken, { teamId, projectId: project.projectId, columnId: 'todo', title: 'Mentor task' }, 'PERMISSION_DENIED');
await callFails('createKanbanTask', parent.idToken, { teamId, projectId: project.projectId, columnId: 'todo', title: 'Parent task' }, 'PERMISSION_DENIED');
await callFails('updateTask', mentor.idToken, { teamId, taskId: unassignedTask.taskId, expectedVersion: 3, title: 'Mentor rename' }, 'PERMISSION_DENIED');
await call('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: testingColumn.columnId, expectedVersion: 1, operationId: `student-move-${suffix}` });
const movedTask = await readDocument(`tasks/${kanbanTask.taskId}`, student.idToken);
if (movedTask.fields.columnId?.stringValue !== testingColumn.columnId || movedTask.fields.version?.integerValue !== '2') throw new Error('A student could not move their assigned team card.');
await call('moveTaskCard', coach.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'completed', expectedVersion: 2, operationId: `coach-move-${suffix}` });
const completedGoal = await readDocument(`goals/${goal.goalId}`, coach.idToken);
if (completedGoal.fields.taskCount?.integerValue !== '1' || completedGoal.fields.completedTaskCount?.integerValue !== '1') throw new Error('Kanban completion did not update the linked goal counters.');
await callFails('moveTaskCard', student.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 1, operationId: `stale-move-${suffix}` }, 'ABORTED');
await callFails('moveTaskCard', mentor.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 3, operationId: `mentor-move-${suffix}` }, 'PERMISSION_DENIED');
await callFails('moveTaskCard', parent.idToken, { teamId, projectId: project.projectId, taskId: kanbanTask.taskId, columnId: 'review', expectedVersion: 3, operationId: `parent-move-${suffix}` }, 'PERMISSION_DENIED');

// Board templates: a coach seeds a project from a built-in preset, saves the
// result back as a team template, and every other role is refused.
const catalogue = await call('listProjectTemplates', student.idToken, { teamId });
if (!catalogue.builtIn?.length) throw new Error('The built-in template catalogue was empty.');
const preset = catalogue.builtIn[0];
const seeded = await call('createProjectFromTemplate', coach.idToken, { teamId, operationId: `template-project-${suffix}`, templateId: preset.id, name: 'Seeded board' });
if (seeded.cardCount !== preset.cards.length) throw new Error('A template did not seed its starter cards.');
const seededProject = await readDocument(`projects/${seeded.projectId}`, student.idToken);
if (seededProject.fields.name?.stringValue !== 'Seeded board') throw new Error('The project name override was ignored.');
if (seededProject.fields.columns?.arrayValue?.values?.length !== preset.columns.length) throw new Error('A template did not seed its workflow columns.');
// The receipt makes a retried create return the same board instead of a second one.
const replayed = await call('createProjectFromTemplate', coach.idToken, { teamId, operationId: `template-project-${suffix}`, templateId: preset.id, name: 'Seeded board' });
if (replayed.projectId !== seeded.projectId) throw new Error('Retrying a template create made a second project.');
await callFails('createProjectFromTemplate', student.idToken, { teamId, templateId: preset.id }, 'PERMISSION_DENIED');
await callFails('createProjectFromTemplate', coach.idToken, { teamId, templateId: 'builtin:not-a-template' }, 'NOT_FOUND');

const saved = await call('saveProjectAsTemplate', coach.idToken, { teamId, operationId: `save-template-${suffix}`, projectId: seeded.projectId, name: 'Our seeded board' });
if (saved.cardCount !== preset.cards.length) throw new Error('Saving a board as a template did not snapshot its cards.');
const savedCatalogue = await call('listProjectTemplates', coach.idToken, { teamId });
if (!savedCatalogue.team?.some((template) => template.id === saved.templateId)) throw new Error('A saved template was missing from the catalogue.');
const fromSaved = await call('createProjectFromTemplate', coach.idToken, { teamId, templateId: saved.templateId, includeCards: false });
if (fromSaved.cardCount !== 0) throw new Error('Opting out of starter cards still seeded them.');
await callFails('saveProjectAsTemplate', student.idToken, { teamId, projectId: seeded.projectId, name: 'Forged' }, 'PERMISSION_DENIED');
await callFails('deleteProjectTemplate', student.idToken, { teamId, templateId: saved.templateId }, 'PERMISSION_DENIED');
// A built-in preset belongs to the product, not the team; it has no document to delete.
await callFails('deleteProjectTemplate', coach.idToken, { teamId, templateId: preset.id }, 'FAILED_PRECONDITION');
await call('deleteProjectTemplate', coach.idToken, { teamId, templateId: saved.templateId });

// Goals reach their own outcome: a coach links an existing card to a goal, the
// counters follow the card, and the goal can be marked achieved.
const milestone = await call('createGoal', coach.idToken, { teamId, operationId: `milestone-${suffix}`, title: 'Innovation project ready', description: 'Problem, solution and presentation done.', dueAt: '2026-11-01T05:00:00.000Z' });
const linkedCard = await call('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `goal-card-${suffix}`, title: 'Draft the solution', assignedTo: student.localId });
await call('updateTask', coach.idToken, { teamId, taskId: linkedCard.taskId, expectedVersion: 1, goalId: milestone.goalId });
const linkedGoal = await readDocument(`goals/${milestone.goalId}`, student.idToken);
if (linkedGoal.fields.taskCount?.integerValue !== '1' || linkedGoal.fields.completedTaskCount?.integerValue !== '0') throw new Error('Linking a card to a goal did not update its counters.');
if (!linkedGoal.fields.dueAt?.timestampValue || !linkedGoal.fields.description?.stringValue) throw new Error('A goal lost its description or target date.');
// Completing the card moves the goal's progress without anyone touching the goal.
await call('updateTask', student.idToken, { teamId, taskId: linkedCard.taskId, status: 'completed' });
const progressedGoal = await readDocument(`goals/${milestone.goalId}`, coach.idToken);
if (progressedGoal.fields.completedTaskCount?.integerValue !== '1') throw new Error('Completing a linked card did not advance its goal.');
// Unlinking gives the count back.
const linkedCardNow = await readDocument(`tasks/${linkedCard.taskId}`, coach.idToken);
await call('updateTask', coach.idToken, { teamId, taskId: linkedCard.taskId, expectedVersion: Number(linkedCardNow.fields.version?.integerValue ?? 1), goalId: null });
const unlinkedGoal = await readDocument(`goals/${milestone.goalId}`, coach.idToken);
if (unlinkedGoal.fields.taskCount?.integerValue !== '0' || unlinkedGoal.fields.completedTaskCount?.integerValue !== '0') throw new Error('Unlinking a card did not release its goal counters.');
const achieved = await call('updateGoal', coach.idToken, { teamId, goalId: milestone.goalId, expectedVersion: Number(unlinkedGoal.fields.version?.integerValue ?? 1), status: 'completed' });
const achievedGoal = await readDocument(`goals/${milestone.goalId}`, student.idToken);
if (achievedGoal.fields.status?.stringValue !== 'completed') throw new Error('A goal could not be marked achieved.');
// Stale edits lose, and only coaches may edit at all.
await callFails('updateGoal', coach.idToken, { teamId, goalId: milestone.goalId, expectedVersion: 1, status: 'active' }, 'ABORTED');
await callFails('updateGoal', student.idToken, { teamId, goalId: milestone.goalId, expectedVersion: achieved.version, status: 'active' }, 'PERMISSION_DENIED');
await call('updateGoal', coach.idToken, { teamId, goalId: milestone.goalId, expectedVersion: achieved.version, status: 'active' });

// Board categories: a coach owns the list, every other role is refused, a card
// can only carry a category its own board defines, and a category still holding
// cards cannot be removed.
const boardVersion = Number(seededProject.fields.version?.integerValue ?? 1);
const categoriesResult = await call('updateProjectCategories', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  expectedVersion: boardVersion,
  categories: [
    ...(preset.categories ?? []).map((entry) => ({ id: entry.id, name: entry.name, color: entry.color, areaId: entry.areaId })),
    { name: 'Outreach', color: 'pink', areaId: 'core-values' }
  ]
});
const outreach = categoriesResult.categories.at(-1);
if (!outreach?.id || outreach.name !== 'Outreach' || outreach.areaId !== 'core-values') throw new Error('A new board category did not keep its name or judging area.');
if (categoriesResult.version !== boardVersion + 1) throw new Error('A category edit did not advance the board version.');
// Stale edits lose rather than silently overwriting another coach's list.
await callFails('updateProjectCategories', coach.idToken, { teamId, projectId: seeded.projectId, expectedVersion: boardVersion, categories: [] }, 'ABORTED');
await callFails('updateProjectCategories', student.idToken, { teamId, projectId: seeded.projectId, expectedVersion: categoriesResult.version, categories: [] }, 'PERMISSION_DENIED');
await callFails('updateProjectCategories', mentor.idToken, { teamId, projectId: seeded.projectId, expectedVersion: categoriesResult.version, categories: [] }, 'PERMISSION_DENIED');
await callFails('updateProjectCategories', coach.idToken, { teamId, projectId: seeded.projectId, expectedVersion: categoriesResult.version, categories: [{ name: 'Bad area', areaId: 'marketing' }] }, 'INVALID_ARGUMENT');

const categorisedTask = await call('createKanbanTask', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  columnId: preset.columns[0].id,
  operationId: `category-task-${suffix}`,
  title: 'Plan the outreach visit',
  categoryId: outreach.id
});
const storedCategorised = await readDocument(`tasks/${categorisedTask.taskId}`, student.idToken);
if (storedCategorised.fields.categoryId?.stringValue !== outreach.id) throw new Error('A card did not keep the category it was created with.');
// A category from another board is not a category this card may carry.
await callFails('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', title: 'Wrong board category', categoryId: outreach.id }, 'NOT_FOUND');
await callFails('updateProjectCategories', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  expectedVersion: categoriesResult.version,
  categories: (preset.categories ?? []).map((entry) => ({ id: entry.id, name: entry.name, color: entry.color, areaId: entry.areaId }))
}, 'FAILED_PRECONDITION');

// Subtasks: a coach owns the list; the card's assignee and a sub-item's own
// assignee may each flip one status and nothing else.
const subtaskCard = await call('createKanbanTask', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  columnId: preset.columns[0].id,
  operationId: `subtask-card-${suffix}`,
  title: 'Build the team website',
  assignedTo: student.localId
});
const subtasks = [
  { id: `sub-ui-${suffix}`, title: 'Build UI', status: 'todo', assignedTo: null, dueAt: '2026-10-01T05:00:00.000Z' },
  { id: `sub-login-${suffix}`, title: 'Create login screen', status: 'todo', assignedTo: mentor.localId }
];
await call('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: 1, subtasks });
const storedSubtasks = await readDocument(`tasks/${subtaskCard.taskId}`, student.idToken);
const storedSubtaskValues = storedSubtasks.fields.subtasks?.arrayValue?.values ?? [];
if (storedSubtaskValues.length !== 2 || !storedSubtaskValues[0].mapValue.fields.dueAt?.timestampValue) throw new Error('Subtasks did not persist with their due dates.');
// The card's assignee may tick a sub-item off without touching anything else.
await call('updateTask', student.idToken, { teamId, taskId: subtaskCard.taskId, subtaskStatus: { id: subtasks[0].id, status: 'done' } });
const tickedByStudent = await readDocument(`tasks/${subtaskCard.taskId}`, student.idToken);
const tickedValues = tickedByStudent.fields.subtasks?.arrayValue?.values ?? [];
if (tickedValues[0].mapValue.fields.status?.stringValue !== 'done' || tickedValues[1].mapValue.fields.status?.stringValue !== 'todo') throw new Error('A student subtask tick changed the wrong sub-item.');
// A mentor is read-only on the card, but owns the sub-item assigned to them.
await call('updateTask', mentor.idToken, { teamId, taskId: subtaskCard.taskId, subtaskStatus: { id: subtasks[1].id, status: 'inProgress' } });
await callFails('updateTask', mentor.idToken, { teamId, taskId: subtaskCard.taskId, status: 'completed' }, 'PERMISSION_DENIED');
await callFails('updateTask', mentor.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: 4, subtasks: [] }, 'PERMISSION_DENIED');
await callFails('updateTask', parent.idToken, { teamId, taskId: subtaskCard.taskId, subtaskStatus: { id: subtasks[0].id, status: 'todo' } }, 'PERMISSION_DENIED');
await callFails('updateTask', student.idToken, { teamId, taskId: subtaskCard.taskId, subtaskStatus: { id: 'no-such-subtask', status: 'done' } }, 'NOT_FOUND');
await callFails('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: 99, subtasks: [] }, 'ABORTED');

// Parents follow the tracker read-only: no path that assigns work accepts one.
await callFails('createTask', coach.idToken, { ...taskInput, taskId: `parent-task-${suffix}`, operationId: `parent-create-${suffix}`, assignedTo: parent.localId }, 'FAILED_PRECONDITION');
await callFails('createKanbanTask', coach.idToken, { teamId, projectId: project.projectId, columnId: 'todo', operationId: `parent-quick-${suffix}`, title: 'For a parent', assignedTo: parent.localId }, 'FAILED_PRECONDITION');
const beforeParentAssign = await readDocument(`tasks/${subtaskCard.taskId}`, coach.idToken);
const parentAssignVersion = Number(beforeParentAssign.fields.version?.integerValue);
await callFails('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: parentAssignVersion, assignedTo: parent.localId }, 'FAILED_PRECONDITION');
await callFails('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: parentAssignVersion, subtasks: [{ ...subtasks[0], assignedTo: parent.localId }] }, 'FAILED_PRECONDITION');
// A card assigned to a parent before the rule existed: they still cannot touch
// it through the assignee path, and editors can still edit it.
await patchAsOwner(`tasks/${subtaskCard.taskId}`, { assignedTo: { stringValue: parent.localId } });
await callFails('updateTask', parent.idToken, { teamId, taskId: subtaskCard.taskId, status: 'review' }, 'PERMISSION_DENIED');
await callFails('updateTask', parent.idToken, { teamId, taskId: subtaskCard.taskId, comment: 'Looks good' }, 'PERMISSION_DENIED');
// The card dialog saves the whole form, so the unchanged assignee comes back too.
await call('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: parentAssignVersion, title: 'Renamed while a parent holds it', assignedTo: parent.localId });
const renamedLegacy = await readDocument(`tasks/${subtaskCard.taskId}`, coach.idToken);
if (renamedLegacy.fields.title?.stringValue !== 'Renamed while a parent holds it') throw new Error('An editor could not edit a card already assigned to a parent.');
await call('updateTask', coach.idToken, { teamId, taskId: subtaskCard.taskId, expectedVersion: parentAssignVersion + 1, assignedTo: student.localId });

// A status change resolves against the board's real workflow. This board's
// columns are the preset's, so there is no column called "inProgress": the card
// must keep its column instead of disappearing into one that does not exist.
const beforeStatusChange = await readDocument(`tasks/${subtaskCard.taskId}`, coach.idToken);
const columnBefore = beforeStatusChange.fields.columnId?.stringValue;
await call('updateTask', student.idToken, { teamId, taskId: subtaskCard.taskId, status: 'inProgress' });
const afterStatusChange = await readDocument(`tasks/${subtaskCard.taskId}`, coach.idToken);
if (afterStatusChange.fields.columnId?.stringValue !== columnBefore) throw new Error('A status change moved a card into a column this board does not have.');
if (afterStatusChange.fields.status?.stringValue !== 'inProgress') throw new Error('A status change did not record the new status.');
// "Completed" is the one status that means a column: the board's own done column.
await call('updateTask', student.idToken, { teamId, taskId: subtaskCard.taskId, status: 'completed' });
const completedCard = await readDocument(`tasks/${subtaskCard.taskId}`, coach.idToken);
if (completedCard.fields.columnId?.stringValue !== seededProject.fields.completedColumnId?.stringValue) throw new Error('Completing a card did not move it to the board\'s completion column.');
if (!completedCard.fields.completedAt?.timestampValue) throw new Error('Completing a card did not stamp completedAt.');

// Planned window and deadline are three separate dates on a card.
const datedCard = await call('createKanbanTask', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  columnId: preset.columns[0].id,
  operationId: `dated-card-${suffix}`,
  title: 'Build the base robot'
});
await call('updateTask', coach.idToken, {
  teamId,
  taskId: datedCard.taskId,
  expectedVersion: 1,
  startAt: '2026-10-01T05:00:00.000Z',
  endAt: '2026-10-08T05:00:00.000Z',
  dueAt: '2026-10-10T05:00:00.000Z'
});
const datedTask = await readDocument(`tasks/${datedCard.taskId}`, student.idToken);
for (const field of ['startAt', 'endAt', 'dueAt']) {
  if (!datedTask.fields[field]?.timestampValue) throw new Error(`A card did not keep its ${field}.`);
}
// Slashes are ordinary prose, and the standard template's own task list uses them.
const slashCard = await call('createKanbanTask', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  columnId: preset.columns[0].id,
  operationId: `slash-card-${suffix}`,
  title: 'Start passive/active attachments',
  description: 'See https://example.org/plan for the sketch.'
});
const slashTask = await readDocument(`tasks/${slashCard.taskId}`, student.idToken);
if (slashTask.fields.title?.stringValue !== 'Start passive/active attachments') throw new Error('A task title lost its slash.');
// Identifiers keep the stricter rule: a "/" there would break a document path.
await callFails('createKanbanTask', coach.idToken, { teamId, projectId: seeded.projectId, columnId: preset.columns[0].id, title: 'Bad id', taskId: 'tasks/evil' }, 'INVALID_ARGUMENT');

// The work-breakdown tree: a category rolls up into a milestone, and cards
// created in it inherit that milestone so the counters follow the structure.
const wbsMilestone = await call('createGoal', coach.idToken, { teamId, operationId: `wbs-goal-${suffix}`, title: 'Innovation project ready for the expert demo' });
const categoriesWithMilestone = await call('updateProjectCategories', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  expectedVersion: categoriesResult.version,
  categories: categoriesResult.categories.map((entry) => entry.id === outreach.id ? { ...entry, goalId: wbsMilestone.goalId } : entry)
});
if (categoriesWithMilestone.categories.find((entry) => entry.id === outreach.id)?.goalId !== wbsMilestone.goalId) throw new Error('A category did not keep the milestone it was put under.');
// A milestone from another team, or one that does not exist, is refused.
await callFails('updateProjectCategories', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  expectedVersion: categoriesWithMilestone.version,
  categories: categoriesWithMilestone.categories.map((entry) => entry.id === outreach.id ? { ...entry, goalId: `missing-${suffix}` } : entry)
}, 'NOT_FOUND');

const inheritedCard = await call('createKanbanTask', coach.idToken, {
  teamId,
  projectId: seeded.projectId,
  columnId: preset.columns[0].id,
  operationId: `inherit-card-${suffix}`,
  title: 'Book the demo room',
  categoryId: outreach.id
});
const inheritedTask = await readDocument(`tasks/${inheritedCard.taskId}`, student.idToken);
if (inheritedTask.fields.goalId?.stringValue !== wbsMilestone.goalId) throw new Error('A card did not inherit its category milestone.');
const inheritedGoal = await readDocument(`goals/${wbsMilestone.goalId}`, coach.idToken);
if (inheritedGoal.fields.taskCount?.integerValue !== '1') throw new Error('An inherited milestone did not count its new card.');
// Moving the card to a package with no milestone takes it out of the branch.
const plainCategory = categoriesWithMilestone.categories.find((entry) => entry.id !== outreach.id && !entry.goalId);
await call('updateTask', coach.idToken, { teamId, taskId: inheritedCard.taskId, expectedVersion: 1, categoryId: plainCategory.id });
const movedTaskRecord = await readDocument(`tasks/${inheritedCard.taskId}`, coach.idToken);
if (movedTaskRecord.fields.goalId?.stringValue) throw new Error('Moving a card between packages did not move it out of the old milestone.');
const releasedGoal = await readDocument(`goals/${wbsMilestone.goalId}`, coach.idToken);
if (releasedGoal.fields.taskCount?.integerValue !== '0') throw new Error('A milestone kept counting a card that left its branch.');
// A coach can still point one card at a milestone its package does not belong to.
await call('updateTask', coach.idToken, { teamId, taskId: inheritedCard.taskId, expectedVersion: 2, goalId: wbsMilestone.goalId });
const overriddenTask = await readDocument(`tasks/${inheritedCard.taskId}`, coach.idToken);
if (overriddenTask.fields.goalId?.stringValue !== wbsMilestone.goalId) throw new Error('A per-card milestone override was not honoured.');

// Task import: a coach imports previewed spreadsheet rows onto a board, a retry
// replays the committed result, and every other role is refused.
const importInput = {
  teamId,
  projectId: seeded.projectId,
  operationId: `import-${suffix}`,
  rows: [
    { title: 'Imported research task', area: 'innovation-project', priority: 'high', dueAt: '2026-10-01T05:00:00.000Z', labels: ['research'] },
    { title: 'Imported build task', area: 'robot-design' }
  ]
};
const imported = await call('importProjectTasks', coach.idToken, importInput);
if (imported.importedCount !== 2 || imported.taskIds?.length !== 2 || imported.columnId !== preset.columns[0].id) throw new Error('A task import did not land every row in the first open column.');
const importedTask = await readDocument(`tasks/${imported.taskIds[0]}`, coach.idToken);
const importedLabels = importedTask.fields.labels?.arrayValue?.values?.map((value) => value.stringValue) ?? [];
if (importedLabels.join(',') !== 'innovation-project,research' || importedTask.fields.priority?.stringValue !== 'high' || !importedTask.fields.dueAt?.timestampValue) throw new Error('An imported task lost its area label, priority, or due date.');
const importReplay = await call('importProjectTasks', coach.idToken, importInput);
if (importReplay.taskIds.join() !== imported.taskIds.join()) throw new Error('Retrying an import added the rows twice.');
await callFails('importProjectTasks', student.idToken, { ...importInput, operationId: `student-import-${suffix}` }, 'PERMISSION_DENIED');

// A richer import: rows carry their own column, a category the board does not
// have yet, a resolved assignee, and sub-items.
const richImport = {
  teamId,
  projectId: seeded.projectId,
  operationId: `rich-import-${suffix}`,
  rows: [
    {
      title: 'Build the team website',
      categoryName: 'Fundraising',
      columnId: preset.columns[1].id,
      assignedTo: student.localId,
      priority: 'high',
      subtasks: [
        { id: `imp-sub-1-${suffix}`, title: 'Build UI', status: 'done', assignedTo: student.localId, dueAt: null },
        { id: `imp-sub-2-${suffix}`, title: 'Create database', status: 'todo', assignedTo: null, dueAt: '2026-11-01T05:00:00.000Z' }
      ]
    },
    // Same category, different casing: it must resolve to one group, not two.
    { title: 'Plan the fundraising event', categoryName: 'fundraising', area: 'core-values' },
    // A category the board already has is reused rather than duplicated.
    { title: 'Plan the outreach visit', categoryName: 'Outreach' }
  ]
};
const richResult = await call('importProjectTasks', coach.idToken, richImport);
if (richResult.createdCategories?.join() !== 'Fundraising') throw new Error('An import did not create exactly the one category its rows named.');
const richTask = await readDocument(`tasks/${richResult.taskIds[0]}`, student.idToken);
if (richTask.fields.columnId?.stringValue !== preset.columns[1].id) throw new Error('An imported row ignored its own Status column.');
if (richTask.fields.assignedTo?.stringValue !== student.localId) throw new Error('An imported row lost its assignee.');
if ((richTask.fields.subtasks?.arrayValue?.values ?? []).length !== 2) throw new Error('An imported row lost its subtasks.');
const importedCategoryId = richTask.fields.categoryId?.stringValue;
const secondRichTask = await readDocument(`tasks/${richResult.taskIds[1]}`, student.idToken);
// "outreach" and "Outreach" are the same group, created once.
if (!importedCategoryId || secondRichTask.fields.categoryId?.stringValue !== importedCategoryId) throw new Error('Two spellings of one category did not land in the same group.');
const boardAfterImport = await readDocument(`projects/${seeded.projectId}`, coach.idToken);
const categoryNames = (boardAfterImport.fields.categories?.arrayValue?.values ?? []).map((value) => value.mapValue.fields.name?.stringValue);
if (!categoryNames.includes('Fundraising')) throw new Error('An import did not add its new category to the board.');
if (categoryNames.filter((name) => name === 'Outreach').length !== 1) throw new Error('An import duplicated a category the board already had.');
const reusedCategoryTask = await readDocument(`tasks/${richResult.taskIds[2]}`, coach.idToken);
if (reusedCategoryTask.fields.categoryId?.stringValue !== outreach.id) throw new Error('An import did not reuse the board\'s existing category.');
// An assignee who is not a member of this team is refused, not silently dropped.
await callFails('importProjectTasks', coach.idToken, { ...richImport, operationId: `bad-assignee-${suffix}`, rows: [{ title: 'Wrong assignee', assignedTo: outsider.localId }] }, 'PERMISSION_DENIED');

// Assignee resolution: coach-only, matches by display name and email, and says
// so plainly when a value matches nobody.
const resolved = await call('resolveImportAssignees', coach.idToken, { teamId, values: [student.email, 'Nobody At All'] });
if (resolved.matches?.[0]?.userId !== student.localId || resolved.matches[0].reason !== 'matched') throw new Error('An assignee email did not resolve to its team member.');
if (resolved.matches[1].userId !== null || resolved.matches[1].reason !== 'unknown') throw new Error('An unknown assignee was not reported as unknown.');
if (Object.values(resolved.matches[0]).includes(student.email) === false) throw new Error('The resolver did not echo the value it was asked about.');
await callFails('resolveImportAssignees', student.idToken, { teamId, values: [student.email] }, 'PERMISSION_DENIED');
const parentLookup = await call('resolveImportAssignees', coach.idToken, { teamId, values: [parent.email] });
if (parentLookup.matches?.[0]?.userId !== null || parentLookup.matches[0].reason !== 'parent') throw new Error('An import naming a parent did not report them as a parent.');
await callFails('importProjectTasks', coach.idToken, { ...richImport, operationId: `parent-assignee-${suffix}`, rows: [{ title: 'For a parent', assignedTo: parent.localId }] }, 'FAILED_PRECONDITION');
await callFails('importProjectTasks', coach.idToken, { ...importInput, operationId: `bad-area-${suffix}`, rows: [{ title: 'Bad area', area: 'marketing' }] }, 'INVALID_ARGUMENT');
await callFails('importProjectTasks', coach.idToken, { ...importInput, operationId: `bad-column-${suffix}`, columnId: 'no-such-column' }, 'NOT_FOUND');
await callFails('createProjectFromTemplate', coach.idToken, { teamId, templateId: saved.templateId }, 'NOT_FOUND');

const migrationTeam = await call('createTeam', coach.idToken, { name: `Migration guard ${suffix}` });
const migrationInvitation = await call('createInvitation', coach.idToken, { teamId: migrationTeam.teamId, email: student.email, role: 'student' });
await call('acceptInvitation', student.idToken, { invitationId: migrationInvitation.invitationId });
await callFails('ensureDefaultProject', student.idToken, { teamId: migrationTeam.teamId }, 'PERMISSION_DENIED');

// A team with no tasks yet starts from the standard season plan: the same
// categories and tasks as the downloadable Excel template.
const seededBoard = await call('ensureDefaultProject', coach.idToken, { teamId: migrationTeam.teamId });
if (!seededBoard.created || seededBoard.seededTaskCount !== 48) throw new Error(`A new team's board was not seeded from the standard plan (${seededBoard.seededTaskCount}).`);
const seededBoardDoc = await readDocument(`projects/${seededBoard.projectId}`, student.idToken);
const seededCategories = seededBoardDoc.fields.categories?.arrayValue?.values ?? [];
if (seededCategories.length !== 4 || seededBoardDoc.fields.migrationVersion?.integerValue !== '1') throw new Error('The seeded board is missing its categories or was left mid-migration.');
// Once the board exists, anyone on the team can open it, and nothing is seeded twice.
const reopened = await call('ensureDefaultProject', student.idToken, { teamId: migrationTeam.teamId });
if (reopened.created || reopened.seededTaskCount) throw new Error('Opening an existing board seeded it again.');

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

globalThis.console.log('Phase 3 and Release 1.1 integration passed: admin-only migration, standard-plan seeding, Student task editing, coach-only board templates, upload ownership/atomic replay when Storage is available, notifications, and goal counters.');
