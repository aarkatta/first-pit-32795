import fs from 'node:fs';
import { doc, getDoc, getDocs, query, collection, where, setDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'first-pit-phase3-rules';
const teamId = 'team-phase3';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `teamPolicies/${teamId}`), { teamId, parentVisibility: 'none', directMessaging: 'disabled', contentAudience: 'teamOnly', membershipApproval: 'inviteOnly', fileSharing: 'teamOnly', discoverability: 'private' });
    for (const [uid, role] of [['student-1', 'student'], ['coach-1', 'coach'], ['mentor-1', 'mentor'], ['parent-1', 'parent']]) {
      await setDoc(doc(db, `memberships/${teamId}_${uid}`), { teamId, userId: uid, role, status: 'active' });
    }
    await setDoc(doc(db, `memberships/${teamId}_suspended`), { teamId, userId: 'suspended', role: 'student', status: 'suspended' });
    await setDoc(doc(db, 'tasks/task-1'), { id: 'task-1', teamId, title: 'Build', status: 'todo', dueAt: null });
    await setDoc(doc(db, 'projects/project-1'), { id: 'project-1', teamId, name: 'Robot', archived: false, columns: [{ id: 'todo', name: 'To Do' }], completedColumnId: 'todo' });
    await setDoc(doc(db, 'projectTemplates/template-1'), { id: 'template-1', teamId, name: 'Our board', columns: [{ id: 'todo', name: 'To Do' }], completedColumnId: 'todo', cards: [] });
    await setDoc(doc(db, 'projectTemplates/template-other'), { id: 'template-other', teamId: 'team-other', name: 'Someone else', columns: [], completedColumnId: 'todo', cards: [] });
    await setDoc(doc(db, 'goals/goal-1'), { id: 'goal-1', teamId, title: 'Season goal' });
    await setDoc(doc(db, 'taskHistory/history-1'), { id: 'history-1', teamId, taskId: 'task-1', action: 'created' });
    await setDoc(doc(db, 'notifications/notification-student'), { id: 'notification-student', teamId, recipientUserId: 'student-1', title: 'Assigned' });
    await setDoc(doc(db, 'notifications/notification-coach'), { id: 'notification-coach', teamId, recipientUserId: 'coach-1', title: 'Assigned' });
    await setDoc(doc(db, 'fileMetadata/file-1'), { id: 'file-1', teamId, status: 'ready', storagePath: `teams/${teamId}/files/file-1/plan.txt`, scanStatus: 'notConfigured' });
  });

  const student = env.authenticatedContext('student-1').firestore();
  const coach = env.authenticatedContext('coach-1').firestore();
  const mentor = env.authenticatedContext('mentor-1').firestore();
  const parent = env.authenticatedContext('parent-1').firestore();
  const suspended = env.authenticatedContext('suspended').firestore();
  const platformAdmin = env.authenticatedContext('platform-admin-1', { platformAdmin: true }).firestore();

  for (const db of [student, coach, mentor, parent]) {
    await assertSucceeds(getDoc(doc(db, 'tasks/task-1')));
    await assertSucceeds(getDoc(doc(db, 'projects/project-1')));
    await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('teamId', '==', teamId))));
    await assertSucceeds(getDoc(doc(db, 'projectTemplates/template-1')));
    await assertFails(getDoc(doc(db, 'projectTemplates/template-other')));
    await assertSucceeds(getDoc(doc(db, 'goals/goal-1')));
    await assertSucceeds(getDoc(doc(db, 'fileMetadata/file-1')));
  }
  await assertFails(getDoc(doc(suspended, 'tasks/task-1')));
  await assertFails(getDoc(doc(student, 'notifications/notification-coach')));
  await assertSucceeds(getDoc(doc(student, 'notifications/notification-student')));
  await assertFails(setDoc(doc(student, 'tasks/task-1'), { teamId, title: 'forged' }));
  await assertFails(setDoc(doc(student, 'projects/project-1'), { teamId, name: 'forged' }));
  await assertFails(getDoc(doc(suspended, 'projectTemplates/template-1')));
  // A saved template is a board a coach can seed from, so no client role writes one.
  await assertFails(setDoc(doc(coach, 'projectTemplates/template-1'), { teamId, name: 'forged' }));
  await assertFails(setDoc(doc(student, 'projectTemplates/template-new'), { teamId, name: 'forged' }));
  await assertFails(setDoc(doc(coach, 'tasks/task-1'), { teamId, title: 'forged' }));
  await assertSucceeds(getDoc(doc(platformAdmin, 'tasks/task-1')));

  // Chat, the calendar, and the Google Calendar integration were removed from
  // the product. Their rule blocks went with them, so the catch-all deny is the
  // only thing standing between a client and any document still sitting in
  // those collections. This asserts the catch-all actually covers them — for
  // every role, including a platform admin.
  for (const [label, db] of [['student', student], ['coach', coach], ['parent', parent], ['platformAdmin', platformAdmin]]) {
    for (const path of [
      'googleIntegrations/student-1',
      'googleOAuthStates/state-1',
      `googleCalendarSync/${teamId}`,
      'channels/channel-1',
      'messages/message-1',
      'announcements/announcement-1',
      'announcementAcknowledgements/ack-1',
      'channelReads/read-1',
      'channelMutes/mute-1',
      'events/event-1',
      'eventOccurrences/event-1_1'
    ]) {
      await assertFails(getDoc(doc(db, path)), `${label} must not read ${path}`);
      await assertFails(setDoc(doc(db, path), { teamId, forged: true }), `${label} must not write ${path}`);
    }
  }
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 3 Firestore role matrix passed for Student, Coach, Mentor, Parent, and Platform Admin, including deny-all on the Google integration collections.');
