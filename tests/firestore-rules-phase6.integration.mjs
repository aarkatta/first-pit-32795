import fs from 'node:fs';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const teamA = 'team-score-a';
const teamB = 'team-score-b';
const env = await initializeTestEnvironment({
  projectId: 'first-pit-phase6-rules',
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `memberships/${teamA}_student-1`), { teamId: teamA, userId: 'student-1', role: 'student', status: 'active' });
    await setDoc(doc(db, `memberships/${teamA}_coach-1`), { teamId: teamA, userId: 'coach-1', role: 'coach', status: 'active' });
    await setDoc(doc(db, `scoreDefinitions/definition-a`), { id: 'definition-a', teamId: teamA, active: true, sourceType: 'team-defined', title: 'Team A scoring' });
    await setDoc(doc(db, `scoreDefinitions/definition-inactive`), { id: 'definition-inactive', teamId: teamA, active: false, sourceType: 'team-defined', title: 'Old scoring' });
    await setDoc(doc(db, `scoreSessions/session-a`), { id: 'session-a', teamId: teamA, scoreDefinitionId: 'definition-a', totalPoints: 10, scoreType: 'practice', sessionDate: new Date('2026-08-09T12:00:00Z') });
    await setDoc(doc(db, `scoreSessions/session-b`), { id: 'session-b', teamId: teamB, scoreDefinitionId: 'definition-b', totalPoints: 99, scoreType: 'match', sessionDate: new Date('2026-08-09T12:00:00Z') });
    await setDoc(doc(db, `scoreSessionHistory/history-a`), { id: 'history-a', teamId: teamA, sessionId: 'session-a', actorUserId: 'coach-1', action: 'corrected' });
  });

  const student = env.authenticatedContext('student-1').firestore();
  const coach = env.authenticatedContext('coach-1').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const teamQuery = query(collection(student, 'scoreSessions'), where('teamId', '==', teamA));

  await assertSucceeds(getDoc(doc(student, 'scoreDefinitions/definition-a')));
  await assertSucceeds(getDocs(teamQuery));
  await assertSucceeds(getDoc(doc(student, 'scoreSessionHistory/history-a')));
  await assertSucceeds(getDoc(doc(coach, 'scoreSessions/session-a')));
  await assertFails(getDoc(doc(student, 'scoreDefinitions/definition-inactive')));
  await assertFails(getDoc(doc(outsider, 'scoreSessions/session-a')));
  await assertFails(getDoc(doc(student, 'scoreSessions/session-b')));
  await assertFails(setDoc(doc(student, 'scoreSessions/forged'), { teamId: teamA, totalPoints: 999 }));
  await assertFails(setDoc(doc(coach, 'scoreSessionHistory/forged'), { teamId: teamA, action: 'corrected' }));
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 6 Firestore rules passed: team-scoped score reads and denied forged writes.');
