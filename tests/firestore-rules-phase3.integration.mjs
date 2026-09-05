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
    await setDoc(doc(db, 'goals/goal-1'), { id: 'goal-1', teamId, title: 'Season goal' });
    await setDoc(doc(db, 'eventOccurrences/event-1_1'), { id: 'event-1_1', teamId, title: 'Practice', startsAt: new Date() });
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
    await assertSucceeds(getDoc(doc(db, 'goals/goal-1')));
    await assertSucceeds(getDoc(doc(db, 'eventOccurrences/event-1_1')));
    await assertSucceeds(getDoc(doc(db, 'fileMetadata/file-1')));
  }
  await assertFails(getDoc(doc(suspended, 'tasks/task-1')));
  await assertFails(getDoc(doc(student, 'notifications/notification-coach')));
  await assertSucceeds(getDoc(doc(student, 'notifications/notification-student')));
  await assertFails(setDoc(doc(student, 'tasks/task-1'), { teamId, title: 'forged' }));
  await assertFails(setDoc(doc(student, 'projects/project-1'), { teamId, name: 'forged' }));
  await assertFails(setDoc(doc(coach, 'tasks/task-1'), { teamId, title: 'forged' }));
  await assertSucceeds(getDoc(doc(platformAdmin, 'tasks/task-1')));

  // Google integration state holds live OAuth refresh tokens and the CSRF state
  // that guards the consent callback. No client role reads or writes it — not a
  // coach, not a platform admin. Status reaches the UI only through callables.
  for (const [label, db] of [['student', student], ['coach', coach], ['parent', parent], ['platformAdmin', platformAdmin]]) {
    for (const path of ['googleIntegrations/student-1', 'googleOAuthStates/state-1', `googleCalendarSync/${teamId}`]) {
      await assertFails(getDoc(doc(db, path)), `${label} must not read ${path}`);
      await assertFails(setDoc(doc(db, path), { teamId, forged: true }), `${label} must not write ${path}`);
    }
  }
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 3 Firestore role matrix passed for Student, Coach, Mentor, Parent, and Platform Admin, including deny-all on the Google integration collections.');
