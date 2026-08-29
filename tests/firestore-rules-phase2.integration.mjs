import fs from 'node:fs';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'first-pit-phase2';
const teamId = 'team-phase2';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `teams/${teamId}`), { name: 'Phase 2 Team', normalizedName: 'phase 2 team', createdBy: 'coach-1' });
    await setDoc(doc(db, `teamPolicies/${teamId}`), { teamId, parentVisibility: 'none', directMessaging: 'disabled', contentAudience: 'teamOnly', membershipApproval: 'inviteOnly', fileSharing: 'disabled', discoverability: 'private' });
    for (const [uid, role, email] of [
      ['student-1', 'student', 'student@example.com'],
      ['coach-1', 'coach', 'coach@example.com'],
      ['mentor-1', 'mentor', 'mentor@example.com'],
      ['parent-1', 'parent', 'parent@example.com']
    ]) {
      await setDoc(doc(db, `memberships/${teamId}_${uid}`), { teamId, userId: uid, role, status: 'active' });
      await setDoc(doc(db, `users/${uid}`), { uid, email, displayName: uid, photoURL: null });
    }
    await setDoc(doc(db, 'invitations/invitation-1'), { teamId, email: 'student@example.com', targetUserId: 'student-1', status: 'pending' });
    await setDoc(doc(db, 'joinRequests/request-1'), { teamId, userId: 'student-1', status: 'pending' });
    await setDoc(doc(db, 'reports/report-1'), { teamId, reporterUserId: 'student-1', targetType: 'user' });
    await setDoc(doc(db, 'moderationCases/case-1'), { teamId, reporterUserId: 'student-1', status: 'open' });
    await setDoc(doc(db, 'auditEvents/audit-1'), { teamId, actorUserId: 'coach-1' });
  });

  const unverifiedStudent = env.authenticatedContext('student-1', { email: 'student@example.com', email_verified: false }).firestore();
  const student = env.authenticatedContext('student-1', { email: 'student@example.com', email_verified: true }).firestore();
  const matchingEmailWrongUser = env.authenticatedContext('impostor-1', { email: 'student@example.com', email_verified: true }).firestore();
  const coach = env.authenticatedContext('coach-1', { email: 'coach@example.com' }).firestore();
  const mentor = env.authenticatedContext('mentor-1', { email: 'mentor@example.com' }).firestore();
  const parent = env.authenticatedContext('parent-1', { email: 'parent@example.com' }).firestore();
  const platformAdmin = env.authenticatedContext('platform-admin-1', { platformAdmin: true }).firestore();

  await assertSucceeds(getDoc(doc(student, `memberships/${teamId}_student-1`)));
  await assertFails(getDoc(doc(student, `memberships/${teamId}_coach-1`)));
  await assertSucceeds(getDoc(doc(student, `teamPolicies/${teamId}`)));
  await assertFails(getDoc(doc(unverifiedStudent, 'invitations/invitation-1')));
  await assertSucceeds(getDoc(doc(student, 'invitations/invitation-1')));
  await assertFails(getDoc(doc(matchingEmailWrongUser, 'invitations/invitation-1')));
  await assertFails(getDoc(doc(student, 'moderationCases/case-1')));

  await assertSucceeds(getDoc(doc(coach, `memberships/${teamId}_student-1`)));
  await assertSucceeds(getDoc(doc(coach, 'moderationCases/case-1')));
  await assertSucceeds(getDoc(doc(coach, 'auditEvents/audit-1')));
  await assertFails(setDoc(doc(coach, `memberships/${teamId}_student-1`), { teamId, userId: 'student-1', role: 'coach', status: 'active' }));

  await assertFails(getDoc(doc(mentor, `memberships/${teamId}_student-1`)));
  await assertFails(getDoc(doc(parent, 'moderationCases/case-1')));
  await assertSucceeds(getDoc(doc(platformAdmin, 'moderationCases/case-1')));
  await assertSucceeds(getDoc(doc(platformAdmin, 'auditEvents/audit-1')));
  await assertFails(setDoc(doc(platformAdmin, 'auditEvents/forged'), { teamId, actorUserId: 'platform-admin-1' }));
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 2 Firestore role matrix passed for Student, Coach, Mentor, Parent, and Platform Admin.');
