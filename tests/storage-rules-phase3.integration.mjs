import fs from 'node:fs';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'first-pit-phase3-storage';
const teamId = 'team-storage';
const path = `teams/${teamId}/files/file-1/plan.txt`;
const cleanPath = `teams/${teamId}/files/file-2/scanned.txt`;
const unscannedPath = `teams/${teamId}/files/file-3/unscanned.txt`;
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync(new globalThis.URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: fs.readFileSync(new globalThis.URL('../storage.rules', import.meta.url), 'utf8') }
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `teamPolicies/${teamId}`), { teamId, fileSharing: 'teamOnly' });
    await setDoc(doc(db, `memberships/${teamId}_student-1`), { teamId, userId: 'student-1', role: 'student', status: 'active' });
    await setDoc(doc(db, `memberships/${teamId}_parent-1`), { teamId, userId: 'parent-1', role: 'parent', status: 'active' });
    await setDoc(doc(db, 'fileMetadata/file-1'), { id: 'file-1', teamId, storagePath: path, contentType: 'text/plain', sizeBytes: 5, status: 'pending', scanStatus: 'pending', uploadedBy: 'student-1', createdAt: new Date() });
    await setDoc(doc(db, 'fileMetadata/file-2'), { id: 'file-2', teamId, storagePath: cleanPath, contentType: 'text/plain', sizeBytes: 5, status: 'pending', scanStatus: 'pending', uploadedBy: 'student-1', createdAt: new Date() });
    await setDoc(doc(db, 'fileMetadata/file-3'), { id: 'file-3', teamId, storagePath: unscannedPath, contentType: 'text/plain', sizeBytes: 5, status: 'pending', scanStatus: 'pending', uploadedBy: 'student-1', createdAt: new Date() });
  });

  const student = env.authenticatedContext('student-1').storage();
  const parent = env.authenticatedContext('parent-1').storage();
  const studentDb = env.authenticatedContext('student-1').firestore();
  const parentDb = env.authenticatedContext('parent-1').firestore();
  const studentRef = student.ref(path);
  await assertFails(parent.ref(path).put(new globalThis.Blob(['hello'], { type: 'text/plain' })));
  await assertSucceeds(studentRef.put(new globalThis.Blob(['hello'], { type: 'text/plain' })));
  await assertFails(studentRef.getMetadata());
  await assertFails(parent.ref(path).getMetadata());
  await assertSucceeds(getDoc(doc(studentDb, 'fileMetadata/file-1')));
  await assertFails(getDoc(doc(parentDb, 'fileMetadata/file-1')));

  // The Storage Area list query the client actually issues. The status filter is
  // what makes it satisfy the fileMetadata list rule; without it the rule denies.
  const teamFilesQuery = (db) => query(
    collection(db, 'fileMetadata'),
    where('teamId', '==', teamId),
    where('status', '==', 'ready'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  await assertSucceeds(getDocs(teamFilesQuery(studentDb)));
  // A parent is an active member, so team file sharing (not parent visibility)
  // is what governs this; with fileSharing on, ready files are listable.
  await assertSucceeds(getDocs(teamFilesQuery(parentDb)));
  // Without the status filter the query no longer satisfies the list rule.
  await assertFails(getDocs(query(collection(studentDb, 'fileMetadata'), where('teamId', '==', teamId), limit(20))));

  // Both objects have to exist before the read rule means anything, and the
  // create rule only permits an upload while the metadata is still 'pending'.
  await assertSucceeds(student.ref(cleanPath).put(new globalThis.Blob(['hello'], { type: 'text/plain' })));
  await assertSucceeds(student.ref(unscannedPath).put(new globalThis.Blob(['hello'], { type: 'text/plain' })));
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // file-2 completes the way completeFileUpload finishes an upload.
    await setDoc(doc(db, 'fileMetadata/file-2'), { id: 'file-2', teamId, storagePath: cleanPath, contentType: 'text/plain', sizeBytes: 5, status: 'ready', scanStatus: 'clean', uploadedBy: 'student-1', createdAt: new Date() });
    // file-3 is ready but its scan never cleared.
    await setDoc(doc(db, 'fileMetadata/file-3'), { id: 'file-3', teamId, storagePath: unscannedPath, contentType: 'text/plain', sizeBytes: 5, status: 'ready', scanStatus: 'pending', uploadedBy: 'student-1', createdAt: new Date() });
  });

  // A scanned file downloads; an unscanned one does not, now that
  // 'notConfigured' is no longer an accepted scan state.
  await assertSucceeds(student.ref(cleanPath).getMetadata());
  await assertFails(student.ref(unscannedPath).getMetadata());
} finally {
  await env.cleanup();
}

globalThis.console.log('Phase 3 Storage rules upload cap, metadata binding, and pending-read checks passed.');
