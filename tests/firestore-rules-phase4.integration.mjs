import fs from 'node:fs';
import { doc, getDoc, getDocs, query, collection, where, setDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'first-pit-phase4-rules';
const teamId = 'team-phase4';
const suiteTimeout = setTimeout(() => {
  globalThis.console.error('Phase 4 Firestore rules timed out after 60 seconds.');
  globalThis.process.exit(1);
}, 60_000);
suiteTimeout.unref();
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `teamPolicies/${teamId}`), { teamId, parentVisibility: 'none', directMessaging: 'coachesOnly', contentAudience: 'teamOnly', membershipApproval: 'inviteOnly', fileSharing: 'disabled', discoverability: 'private' });
    for (const [uid, role] of [['coach-1', 'coach'], ['coach-2', 'coach'], ['student-1', 'student'], ['parent-1', 'parent']]) {
      await setDoc(doc(db, `memberships/${teamId}_${uid}`), { teamId, userId: uid, role, status: 'active' });
    }
    await setDoc(doc(db, 'channels/team'), { id: 'team', teamId, name: 'Team', visibility: 'team', participantUserIds: [], archived: false });
    await setDoc(doc(db, 'channels/coaches'), { id: 'coaches', teamId, name: 'Coaches', visibility: 'coaches', participantUserIds: [], archived: false });
    await setDoc(doc(db, 'channels/direct'), { id: 'direct', teamId, name: 'Private', visibility: 'direct', participantUserIds: ['coach-1', 'coach-2'], archived: false });
    await setDoc(doc(db, 'messages/team-message'), { id: 'team-message', teamId, channelId: 'team', visibility: 'team', participantUserIds: [], body: 'Team update' });
    await setDoc(doc(db, 'messages/coach-message'), { id: 'coach-message', teamId, channelId: 'coaches', visibility: 'coaches', participantUserIds: [], body: 'Private coach notes' });
    await setDoc(doc(db, 'messages/direct-message'), { id: 'direct-message', teamId, channelId: 'direct', visibility: 'direct', participantUserIds: ['coach-1', 'coach-2'], body: 'Coach private message' });
    await setDoc(doc(db, 'announcements/announcement-1'), { id: 'announcement-1', teamId, channelId: 'team', title: 'Notice' });
    await setDoc(doc(db, 'channelReads/read-student'), { id: 'read-student', teamId, channelId: 'team', userId: 'student-1' });
    await setDoc(doc(db, 'channelReads/read-coach'), { id: 'read-coach', teamId, channelId: 'team', userId: 'coach-1' });
  });

  const coach = env.authenticatedContext('coach-1').firestore();
  const student = env.authenticatedContext('student-1').firestore();
  const parent = env.authenticatedContext('parent-1').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();

  await assertSucceeds(getDoc(doc(coach, 'channels/team')));
  await assertSucceeds(getDoc(doc(student, 'channels/team')));
  await assertSucceeds(getDoc(doc(coach, 'channels/coaches')));
  await assertSucceeds(getDoc(doc(coach, 'messages/direct-message')));
  await assertSucceeds(getDoc(doc(coach, 'announcements/announcement-1')));
  await assertSucceeds(getDocs(query(collection(student, 'messages'), where('teamId', '==', teamId), where('channelId', '==', 'team'), where('visibility', '==', 'team'))));
  await assertSucceeds(getDoc(doc(student, 'channelReads/read-student')));
  // Parent visibility is a team policy, not a default. With the team on
  // 'none', a parent is an active member but must not reach the team
  // conversation — the promise the product makes to families.
  await assertFails(getDoc(doc(parent, 'channels/team')));
  await assertFails(getDoc(doc(parent, 'messages/team-message')));

  await assertFails(getDoc(doc(student, 'channels/coaches')));
  await assertFails(getDoc(doc(student, 'messages/coach-message')));
  await assertFails(getDoc(doc(parent, 'messages/direct-message')));
  await assertFails(getDoc(doc(student, 'messages/direct-message')));
  await assertFails(getDoc(doc(outsider, 'messages/team-message')));
  await assertFails(getDoc(doc(student, 'channelReads/read-coach')));
  await assertFails(getDocs(query(collection(student, 'messages'), where('teamId', '==', teamId))));
  await assertFails(setDoc(doc(student, 'messages/team-message'), { body: 'forged' }));

  // Opting the team in opens exactly the team-visible surface to parents, and
  // nothing more: coach and direct channels stay closed.
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `teamPolicies/${teamId}`), { teamId, parentVisibility: 'teamMembers', directMessaging: 'coachesOnly', contentAudience: 'teamOnly', membershipApproval: 'inviteOnly', fileSharing: 'disabled', discoverability: 'private' });
  });
  const optedInParent = env.authenticatedContext('parent-1').firestore();
  await assertSucceeds(getDoc(doc(optedInParent, 'channels/team')));
  await assertSucceeds(getDoc(doc(optedInParent, 'messages/team-message')));
  await assertFails(getDoc(doc(optedInParent, 'channels/coaches')));
  await assertFails(getDoc(doc(optedInParent, 'messages/coach-message')));
  await assertFails(getDoc(doc(optedInParent, 'messages/direct-message')));
} finally {
  await env.cleanup();
}

clearTimeout(suiteTimeout);
await new Promise((resolve) => globalThis.process.stdout.write(
  'Phase 4 Firestore isolation rules passed for channel-scoped team, coach-only, direct, announcement, read-state, broad-query denial, and forged-write boundaries.\n',
  resolve
));
globalThis.process.exit(0);
