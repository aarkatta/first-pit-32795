import fs from 'node:fs';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const teamId = 'team-phase5';
const env = await initializeTestEnvironment({
  projectId: 'first-pit-phase5-rules',
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `memberships/${teamId}_student-1`), { teamId, userId: 'student-1', role: 'student', status: 'active' });
    await setDoc(doc(db, `memberships/${teamId}_coach-1`), { teamId, userId: 'coach-1', role: 'coach', status: 'active' });
    await setDoc(doc(db, `questions/team-private`), { id: 'team-private', teamId, visibility: 'team', moderationStatus: 'published', title: 'Private programming', searchTokens: ['programming'] });
    await setDoc(doc(db, `questions/community-public`), { id: 'community-public', teamId: null, visibility: 'community', moderationStatus: 'published', title: 'Community programming', searchTokens: ['programming'] });
    await setDoc(doc(db, `answers/community-answer`), { id: 'community-answer', teamId: null, visibility: 'community', moderationStatus: 'published', questionId: 'community-public' });
    await setDoc(doc(db, `questionComments/community-comment`), { id: 'community-comment', teamId: null, visibility: 'community', moderationStatus: 'published', questionId: 'community-public' });
    await setDoc(doc(db, `videos/team-video`), { id: 'team-video', teamId, visibility: 'team', publicationStatus: 'published', title: 'Private CAD', searchTokens: ['cad'] });
    await setDoc(doc(db, `videos/team-draft`), { id: 'team-draft', teamId, visibility: 'team', publicationStatus: 'draft', createdBy: 'coach-1', title: 'Draft CAD', searchTokens: ['cad'] });
    await setDoc(doc(db, `videos/community-video`), { id: 'community-video', teamId: null, visibility: 'community', publicationStatus: 'published', title: 'Community CAD', searchTokens: ['cad'] });
    await setDoc(doc(db, `polls/team-poll`), { id: 'team-poll', teamId, visibility: 'team', status: 'open', resultsVisibility: 'afterClose', totalVotes: 2, optionVoteCounts: { 'option-1': 2 } });
    await setDoc(doc(db, `savedQuestions/student-1_team-private`), { userId: 'student-1', questionId: 'team-private' });
    await setDoc(doc(db, `videoFavorites/student-1_team-video`), { userId: 'student-1', videoId: 'team-video' });
  });

  const student = env.authenticatedContext('student-1').firestore();
  const coach = env.authenticatedContext('coach-1').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const unauthenticated = env.unauthenticatedContext().firestore();
  const teamQuestionQuery = query(collection(student, 'questions'), where('teamId', '==', teamId), where('visibility', '==', 'team'), where('moderationStatus', '==', 'published'));
  const communityQuestionQuery = query(collection(outsider, 'questions'), where('teamId', '==', null), where('visibility', '==', 'community'), where('moderationStatus', '==', 'published'));

  await assertSucceeds(getDoc(doc(student, 'questions/team-private')));
  await assertFails(getDoc(doc(outsider, 'questions/team-private')));
  await assertSucceeds(getDocs(teamQuestionQuery));
  await assertSucceeds(getDocs(communityQuestionQuery));
  await assertFails(getDoc(doc(unauthenticated, 'questions/community-public')));
  await assertFails(getDoc(doc(unauthenticated, 'answers/community-answer')));
  await assertFails(getDoc(doc(unauthenticated, 'questionComments/community-comment')));
  await assertFails(getDoc(doc(unauthenticated, 'videos/community-video')));
  await assertFails(getDoc(doc(outsider, 'videos/team-video')));
  await assertSucceeds(getDoc(doc(outsider, 'videos/community-video')));
  await assertFails(getDoc(doc(student, 'videos/team-draft')));
  await assertSucceeds(getDoc(doc(coach, 'videos/team-draft')));
  await assertFails(getDoc(doc(student, 'polls/team-poll')));
  await assertFails(getDoc(doc(outsider, 'polls/team-poll')));
  await assertFails(getDocs(query(collection(student, 'polls'), where('teamId', '==', teamId))));
  await assertSucceeds(getDoc(doc(student, 'savedQuestions/student-1_team-private')));
  await assertFails(getDoc(doc(outsider, 'savedQuestions/student-1_team-private')));
  await assertFails(getDoc(doc(student, 'pollVotes/team-poll_student-1')));
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 5 Firestore rules passed: team/community visibility, private search boundary, poll isolation, and personal record isolation.');
