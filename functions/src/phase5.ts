import { FieldValue, Timestamp, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  assertTeamMemberInTransaction,
  getInput,
  requireAuth,
  requireString,
  requireTeamAdmin,
  requireTeamMember,
  auditRecord,
  type TeamAdmin
} from './phase2.js';

export type Phase5Request = CallableRequest<Record<string, unknown>>;
export type Visibility = 'team' | 'community';
export type PublicationStatus = 'draft' | 'published' | 'unpublished' | 'removed';
export const VIDEO_CATEGORIES = ['Drivetrain', 'Programming', 'CAD', 'Electronics', 'Autonomous', 'Pit Tips'] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_SCAN = 100;
const MAX_CAPTION_TRACKS = 8;
const POLL_ROLES = ['student', 'parent', 'mentor', 'coach', 'teamLeader'] as const;
const db = () => getFirestore();

function inputRecord(request: Phase5Request) {
  return request.data ?? {};
}

function optionalString(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, label, maxLength);
}

function requireUrl(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length > 500) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  try {
    const parsed = new globalThis.URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
}

function optionalUrl(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireUrl(value, label);
}

function optionalStoragePath(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 500 || value.startsWith('/') || value.includes('//')) throw new HttpsError('invalid-argument', 'Storage path is invalid.');
  return value.trim();
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function searchTokens(...values: string[]) {
  return [...new Set(values.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2).slice(0, 80))];
}

function parseVisibility(value: unknown, fallback: Visibility = 'team'): Visibility {
  const visibility = value ?? fallback;
  if (visibility !== 'team' && visibility !== 'community') throw new HttpsError('invalid-argument', 'Visibility must be team or community.');
  return visibility;
}

function parseTeamId(value: unknown, visibility: Visibility) {
  if (visibility === 'community') {
    if (value !== undefined && value !== null && value !== '') throw new HttpsError('invalid-argument', 'Community content cannot carry a private team ID.');
    return null;
  }
  return requireString(value, 'Team ID');
}

function parseTags(value: unknown) {
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > 12) throw new HttpsError('invalid-argument', 'Tags are invalid.');
  return [...new Set(value.map((tag) => requireString(tag, 'Tag', 32).toLowerCase()))];
}

function parseIdList(value: unknown, label: string, max = 12) {
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > max) throw new HttpsError('invalid-argument', `${label} are invalid.`);
  return [...new Set(value.map((entry) => requireString(entry, label, 128)))];
}

/**
 * Phase 5 idempotency receipts.
 *
 * Knowledge writes used to rely entirely on a client-supplied document ID, so a
 * retried request either duplicated a record or double-incremented a counter.
 * A receipt in `phase5Operations/{scope}_{operationId}` written inside the same
 * transaction as the record makes a retry replay the first outcome instead.
 * Community content has no team, so it is scoped under `community`.
 */
function operationKey(teamId: string | null, value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return `${teamId ?? 'community'}_${requireString(value, 'Operation ID', 120)}`;
}

function operationRef(teamId: string | null, value: unknown) {
  const key = operationKey(teamId, value);
  return key ? db().doc(`phase5Operations/${key}`) : null;
}

export function phase5OperationReceipt(
  receipt: Record<string, unknown>,
  expected: { teamId: string | null; actorUserId: string; kind: string }
): Record<string, unknown> {
  if ((receipt.teamId ?? null) !== (expected.teamId ?? null)
    || receipt.createdBy !== expected.actorUserId
    || receipt.kind !== expected.kind) {
    throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
  }
  return receipt;
}

function parsePageSize(value: unknown) {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new HttpsError('invalid-argument', 'Page size is invalid.');
  return value;
}

function parseCursor(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const millis = Number(value);
  if (!Number.isSafeInteger(millis) || millis < 0) throw new HttpsError('invalid-argument', 'Search cursor is invalid.');
  return Timestamp.fromMillis(millis);
}

function parseDate(value: unknown, label: string, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpsError('invalid-argument', `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} is invalid.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return Timestamp.fromDate(date);
}

function parsePollOptions(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw new HttpsError('invalid-argument', 'A poll needs between 2 and 8 choices.');
  const options = value.map((entry, index) => {
    const label = requireString(entry, `Choice ${index + 1}`, 160);
    return { id: `option-${index + 1}`, label };
  });
  if (new Set(options.map((option) => option.label.toLowerCase())).size !== options.length) throw new HttpsError('invalid-argument', 'Poll choices must be unique.');
  return options;
}

/**
 * Cursor for the token-scan searches. Resumes after the last RETURNED result
 * when the page filled, and after the last SCANNED doc when in-memory filters
 * shrank a full scan window below pageSize — otherwise matches past the window
 * would be unreachable and pagination would falsely report no-more-results.
 */
function searchNextBefore(results: Array<DocumentData & { id: string }>, snapshots: FirebaseFirestore.QuerySnapshot, pageSize: number): string | null {
  const lastReturned = results.at(-1)?.createdAt;
  if (results.length === pageSize && lastReturned instanceof Timestamp) return String(lastReturned.toMillis());
  const lastScanned = snapshots.docs.at(-1)?.data()?.createdAt;
  if (snapshots.size === MAX_SEARCH_SCAN && lastScanned instanceof Timestamp) return String(lastScanned.toMillis());
  return null;
}

function asPlainDocument(snapshot: FirebaseFirestore.DocumentSnapshot): DocumentData & { id: string } {
  return { id: snapshot.id, ...(snapshot.data() ?? {}) };
}

function notificationId(recipientUserId: string, teamId: string, dedupeKey: string) {
  return Buffer.from(`${recipientUserId}_${teamId}_${dedupeKey}`).toString('base64url');
}

export function pollAudienceIncludesRole(audienceRoles: unknown, role: unknown) {
  return typeof role === 'string' && Array.isArray(audienceRoles) && audienceRoles.includes(role);
}

async function activeAudience(transaction: Transaction, teamId: string, roles: readonly string[]) {
  const members = await transaction.get(db().collection('memberships').where('teamId', '==', teamId).where('status', '==', 'active'));
  return members.docs
    .filter((member) => pollAudienceIncludesRole(roles, member.data().role))
    .map((member) => String(member.data().userId))
    .filter(Boolean);
}

function writePollNotifications(transaction: Transaction, teamId: string, pollId: string, title: string, recipients: string[]) {
  const dedupeKey = `poll:${pollId}:published`;
  const now = FieldValue.serverTimestamp();
  for (const recipientUserId of [...new Set(recipients)]) {
    const ref = db().doc(`notifications/${notificationId(recipientUserId, teamId, dedupeKey)}`);
    transaction.set(ref, {
      id: ref.id,
      teamId,
      recipientUserId,
      type: 'poll.published',
      title: `New poll: ${title}`,
      body: 'Your team has a new poll to answer.',
      deepLink: `/knowledge?tab=polls&poll=${pollId}`,
      dedupeKey,
      mandatory: false,
      readAt: null,
      createdAt: now,
      updatedAt: now
    }, { merge: true });
  }
}

async function assertContentAccess(actor: { uid: string; platformAdmin: boolean }, content: DocumentData, allowUnpublished = false) {
  if (content.visibility === 'community') {
    if (!allowUnpublished && ((content.publicationStatus && content.publicationStatus !== 'published') || content.moderationStatus === 'removed')) throw new HttpsError('not-found', 'Content is not published.');
    return;
  }
  if (typeof content.teamId !== 'string') throw new HttpsError('permission-denied', 'Content policy is invalid.');
  if (content.moderationStatus === 'removed' || content.publicationStatus === 'removed') throw new HttpsError('not-found', 'Content is no longer available.');
  if (actor.platformAdmin) return;
  const membership = await db().doc(`memberships/${content.teamId}_${actor.uid}`).get();
  if (!membership.exists || membership.data()?.status !== 'active') throw new HttpsError('permission-denied', 'An active team membership is required.');
  if (!allowUnpublished && content.publicationStatus && content.publicationStatus !== 'published'
    && content.createdBy !== actor.uid && !['coach', 'teamLeader'].includes(String(membership.data()?.role))) {
    throw new HttpsError('not-found', 'Content is not published.');
  }
}

async function assertContentAccessInTransaction(transaction: Transaction, actor: { uid: string; platformAdmin: boolean }, content: DocumentData, allowUnpublished = false) {
  if (content.visibility === 'community') {
    if (!allowUnpublished && ((content.publicationStatus && content.publicationStatus !== 'published') || content.moderationStatus === 'removed')) throw new HttpsError('not-found', 'Content is not published.');
    return;
  }
  if (typeof content.teamId !== 'string') throw new HttpsError('permission-denied', 'Content policy is invalid.');
  if (content.moderationStatus === 'removed' || content.publicationStatus === 'removed') throw new HttpsError('not-found', 'Content is no longer available.');
  if (actor.platformAdmin) return;
  const membership = await transaction.get(db().doc(`memberships/${content.teamId}_${actor.uid}`));
  if (!membership.exists || membership.data()?.status !== 'active') throw new HttpsError('permission-denied', 'An active team membership is required.');
  if (!allowUnpublished && content.publicationStatus && content.publicationStatus !== 'published'
    && content.createdBy !== actor.uid && !['coach', 'teamLeader'].includes(String(membership.data()?.role))) {
    throw new HttpsError('not-found', 'Content is not published.');
  }
}

function questionFields(data: Record<string, unknown>, actor: TeamAdmin) {
  const visibility = parseVisibility(data.visibility);
  const teamId = parseTeamId(data.teamId, visibility);
  if (visibility === 'community' && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only approved community publishers can create community questions.');
  const title = requireString(data.title, 'Question title', 180);
  const body = requireString(data.body, 'Question body', 8000);
  const category = requireString(data.category ?? 'General', 'Question category', 60);
  const tags = parseTags(data.tags);
  const attachmentFileIds = parseIdList(data.attachmentFileIds, 'Attachment file ID', 5);
  if (attachmentFileIds.length > 0 && visibility === 'community') throw new HttpsError('failed-precondition', 'Private team attachments cannot be added to community questions.');
  return { visibility, teamId, title, body, category, tags, attachmentFileIds, searchTokens: searchTokens(title, body, category, ...tags) };
}

export const createQuestion = async (request: Phase5Request) => {
  const auth = requireAuth(request);
  const actor = inputRecord(request).visibility === 'community' ? auth : await requireTeamMember(request, requireString(getInput(request, 'teamId'), 'Team ID'));
  const fields = questionFields(inputRecord(request), actor);
  const questionId = optionalString(getInput(request, 'questionId'), 'Question ID', 128) ?? db().collection('questions').doc().id;
  const ref = db().doc(`questions/${questionId}`);
  const opRef = operationRef(fields.teamId, getInput(request, 'operationId'));
  const committed = await db().runTransaction(async (transaction) => {
    if (fields.teamId) await assertTeamMemberInTransaction(transaction, fields.teamId, actor.uid);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId: fields.teamId, actorUserId: actor.uid, kind: 'question.create' });
      return requireString(receipt.questionId, 'Stored question ID');
    }
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.createdBy !== actor.uid
        || (existing.data()?.teamId ?? null) !== (fields.teamId ?? null)
        || existing.data()?.visibility !== fields.visibility) throw new HttpsError('already-exists', 'Question ID is already used by another question operation.');
      return questionId;
    }
    for (const fileId of fields.attachmentFileIds) {
      const file = await transaction.get(db().doc(`fileMetadata/${fileId}`));
      const fileData = file.data();
      if (!file.exists || fileData?.teamId !== fields.teamId || fileData.status !== 'ready' || ['blocked', 'pending'].includes(String(fileData.scanStatus))) {
        throw new HttpsError('failed-precondition', 'Every attachment must be an approved team file.');
      }
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: questionId, ...fields, createdBy: actor.uid, status: 'open', moderationStatus: 'published', answerCount: 0, commentCount: 0, voteCount: 0, createdAt: now, updatedAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: fields.teamId ?? undefined, targetResource: `questions/${questionId}`, metadata: { action: 'question.created' } }));
    if (opRef) transaction.set(opRef, { teamId: fields.teamId ?? null, createdBy: actor.uid, kind: 'question.create', questionId, createdAt: now });
    return questionId;
  });
  return { questionId: committed };
};

export const searchQuestions = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const data = inputRecord(request);
  const term = normalizeText(requireString(data.query, 'Search query', 80)).toLowerCase().split(/\s+/)[0];
  const pageSize = parsePageSize(data.pageSize);
  const cursor = parseCursor(data.before);
  const teamId = data.teamId === undefined ? undefined : requireString(data.teamId, 'Team ID');
  if (teamId) await requireTeamMember(request, teamId);
  // Firestore rejects where() after startAfter(), so every filter is applied
  // before the cursor and the page limit.
  let query = db().collection('questions').where('searchTokens', 'array-contains', term);
  if (teamId) query = query.where('teamId', '==', teamId).where('visibility', '==', 'team') as typeof query;
  else query = query.where('visibility', '==', 'community').where('teamId', '==', null) as typeof query;
  query = query.orderBy('createdAt', 'desc').limit(MAX_SEARCH_SCAN) as typeof query;
  if (cursor) query = query.startAfter(cursor) as typeof query;
  const snapshots = await query.get();
  const category = data.category === undefined ? undefined : requireString(data.category, 'Category', 60).toLowerCase();
  const tag = data.tag === undefined ? undefined : requireString(data.tag, 'Tag', 32).toLowerCase();
  const status = data.status === undefined ? undefined : requireString(data.status, 'Status', 20);
  const results = snapshots.docs.map(asPlainDocument).filter((question) => {
    return (!category || String(question.category).toLowerCase() === category)
      && (!tag || (Array.isArray(question.tags) && question.tags.includes(tag)))
      && (!status || question.status === status)
      && question.moderationStatus === 'published';
  }).slice(0, pageSize);
  return { questions: results, nextBefore: searchNextBefore(results, snapshots, pageSize), actorUserId: actor.uid };
};

export const createAnswer = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const questionId = requireString(getInput(request, 'questionId'), 'Question ID');
  const body = requireString(getInput(request, 'body'), 'Answer body', 8000);
  const answerId = optionalString(getInput(request, 'answerId'), 'Answer ID', 128);
  const ref = answerId ? db().doc(`answers/${answerId}`) : db().collection('answers').doc();
  const questionRef = db().doc(`questions/${questionId}`);
  const operationId = getInput(request, 'operationId');
  const committed = await db().runTransaction(async (transaction) => {
    const questionSnapshot = await transaction.get(questionRef);
    if (!questionSnapshot.exists) throw new HttpsError('not-found', 'Question not found.');
    const question = questionSnapshot.data() ?? {};
    await assertContentAccessInTransaction(transaction, actor, question);
    const teamId = (question.teamId ?? null) as string | null;
    const opRef = operationRef(teamId, operationId);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: actor.uid, kind: 'answer.create' });
      if (receipt.questionId !== questionId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
      return requireString(receipt.answerId, 'Stored answer ID');
    }
    const existing = await transaction.get(ref);
    if (existing.exists) {
      // Without this check a client-supplied answer ID is an existence oracle for
      // other teams' answers, and lets one member squat another member's ID.
      if (existing.data()?.createdBy !== actor.uid || existing.data()?.questionId !== questionId) {
        throw new HttpsError('already-exists', 'Answer ID is already used by another answer operation.');
      }
      return ref.id;
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: ref.id, questionId, teamId, visibility: question.visibility, body, createdBy: actor.uid, accepted: false, moderationStatus: 'published', createdAt: now, updatedAt: now });
    transaction.update(questionRef, { answerCount: FieldValue.increment(1), updatedAt: now });
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'answer.create', questionId, answerId: ref.id, createdAt: now });
    return ref.id;
  });
  return { answerId: committed };
};

export const createQuestionComment = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const questionId = requireString(getInput(request, 'questionId'), 'Question ID');
  const body = requireString(getInput(request, 'body'), 'Comment body', 2000);
  const questionRef = db().doc(`questions/${questionId}`);
  const commentRef = db().collection('questionComments').doc();
  const operationId = getInput(request, 'operationId');
  // A retry used to post the comment twice AND increment `commentCount` twice,
  // permanently desynchronizing the counter from the comment list.
  const committed = await db().runTransaction(async (transaction) => {
    const question = await transaction.get(questionRef);
    if (!question.exists) throw new HttpsError('not-found', 'Question not found.');
    await assertContentAccessInTransaction(transaction, actor, question.data() ?? {});
    const teamId = (question.data()?.teamId ?? null) as string | null;
    const opRef = operationRef(teamId, operationId);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: actor.uid, kind: 'question-comment.create' });
      if (receipt.questionId !== questionId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
      return requireString(receipt.commentId, 'Stored comment ID');
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(commentRef, { id: commentRef.id, questionId, teamId, visibility: question.data()?.visibility, body, createdBy: actor.uid, moderationStatus: 'published', createdAt: now, updatedAt: now });
    transaction.update(questionRef, { commentCount: FieldValue.increment(1), updatedAt: now });
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'question-comment.create', questionId, commentId: commentRef.id, createdAt: now });
    return commentRef.id;
  });
  return { commentId: committed };
};

export const voteQuestion = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const questionId = requireString(getInput(request, 'questionId'), 'Question ID');
  const questionRef = db().doc(`questions/${questionId}`);
  const voteRef = db().doc(`questionVotes/${questionId}_${actor.uid}`);
  const operationId = getInput(request, 'operationId');
  let voted = false;
  await db().runTransaction(async (transaction) => {
    const question = await transaction.get(questionRef);
    if (!question.exists) throw new HttpsError('not-found', 'Question not found.');
    await assertContentAccessInTransaction(transaction, actor, question.data() ?? {});
    const teamId = (question.data()?.teamId ?? null) as string | null;
    const opRef = operationRef(teamId, operationId);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      // A vote is a toggle, so a blind retry would flip it back. Replay the
      // outcome the first attempt committed instead.
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: actor.uid, kind: 'question.vote' });
      if (receipt.questionId !== questionId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
      voted = receipt.voted === true;
      return;
    }
    const vote = await transaction.get(voteRef);
    const now = FieldValue.serverTimestamp();
    if (vote.exists) {
      transaction.delete(voteRef);
      transaction.update(questionRef, { voteCount: FieldValue.increment(-1), updatedAt: now });
      voted = false;
    } else {
      transaction.set(voteRef, { id: voteRef.id, questionId, teamId: question.data()?.teamId ?? null, voterUserId: actor.uid, createdAt: now });
      transaction.update(questionRef, { voteCount: FieldValue.increment(1), updatedAt: now });
      voted = true;
    }
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'question.vote', questionId, voted, createdAt: now });
  });
  return { questionId, voted };
};

export const acceptAnswer = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const questionId = requireString(getInput(request, 'questionId'), 'Question ID');
  const answerId = requireString(getInput(request, 'answerId'), 'Answer ID');
  const questionRef = db().doc(`questions/${questionId}`);
  const operationId = getInput(request, 'operationId');
  await db().runTransaction(async (transaction) => {
    const questionSnapshot = await transaction.get(questionRef);
    const answerRef = db().doc(`answers/${answerId}`);
    const answerSnapshot = await transaction.get(answerRef);
    if (!questionSnapshot.exists || !answerSnapshot.exists || answerSnapshot.data()?.questionId !== questionId) throw new HttpsError('not-found', 'Question or answer not found.');
    const question = questionSnapshot.data() ?? {};
    await assertContentAccessInTransaction(transaction, actor, question, true);
    const teamId = (question.teamId ?? null) as string | null;
    const opRef = operationRef(teamId, operationId);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: actor.uid, kind: 'answer.accept' });
      if (receipt.questionId !== questionId || receipt.answerId !== answerId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
      return;
    }
    if (question.createdBy !== actor.uid && !actor.platformAdmin) {
      const member = await transaction.get(db().doc(`memberships/${question.teamId}_${actor.uid}`));
      if (!['coach', 'teamLeader'].includes(String(member.data()?.role)) || member.data()?.status !== 'active') throw new HttpsError('permission-denied', 'Only the question author or a team coach can accept an answer.');
    }
    // Acceptance is exclusive, so only two documents can ever change: the answer
    // losing the flag and the one gaining it. Reading and rewriting EVERY answer
    // made a popular question permanently unacceptable once it passed the
    // 500-write transaction limit.
    const previouslyAccepted = await transaction.get(db().collection('answers')
      .where('questionId', '==', questionId)
      .where('accepted', '==', true)
      .limit(1));
    const now = FieldValue.serverTimestamp();
    for (const answer of previouslyAccepted.docs) {
      if (answer.id !== answerId) transaction.update(answer.ref, { accepted: false, updatedAt: now });
    }
    transaction.update(answerRef, { accepted: true, updatedAt: now });
    // Recording the pointer keeps the accepted answer discoverable without
    // scanning the answer list.
    transaction.update(questionRef, { status: 'solved', acceptedAnswerId: answerId, updatedAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: question.teamId ?? undefined, targetResource: `answers/${answerId}`, metadata: { action: 'answer.accepted', status: 'solved' } }));
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'answer.accept', questionId, answerId, createdAt: now });
  });
  return { questionId, answerId, accepted: true };
};

export const toggleSavedQuestion = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const questionId = requireString(getInput(request, 'questionId'), 'Question ID');
  const questionRef = db().doc(`questions/${questionId}`);
  const ref = db().doc(`savedQuestions/${actor.uid}_${questionId}`);
  let saved = false;
  await db().runTransaction(async (transaction) => {
    const question = await transaction.get(questionRef);
    const existing = await transaction.get(ref);
    if (!question.exists) throw new HttpsError('not-found', 'Question not found.');
    await assertContentAccessInTransaction(transaction, actor, question.data() ?? {});
    if (existing.exists) transaction.delete(ref);
    else transaction.set(ref, { id: ref.id, userId: actor.uid, questionId, teamId: question.data()?.teamId ?? null, createdAt: FieldValue.serverTimestamp() });
    saved = !existing.exists;
  });
  return { questionId, saved };
};

function videoFields(data: Record<string, unknown>, actor: TeamAdmin) {
  const visibility = parseVisibility(data.visibility);
  const teamId = parseTeamId(data.teamId, visibility);
  if (visibility === 'community' && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only approved community publishers can create community videos.');
  const category = requireString(data.category, 'Video category', 40) as VideoCategory;
  if (!(VIDEO_CATEGORIES as readonly string[]).includes(category)) throw new HttpsError('invalid-argument', 'Video category is not supported.');
  const title = requireString(data.title, 'Video title', 180);
  const description = requireString(data.description, 'Video description', 4000);
  const externalUrl = optionalUrl(data.externalUrl, 'External video URL');
  const storagePath = optionalStoragePath(data.storagePath);
  if ((!externalUrl && !storagePath) || (externalUrl && storagePath)) throw new HttpsError('invalid-argument', 'Provide exactly one video source.');
  const sourceAttribution = requireString(data.sourceAttribution ?? 'First Pit', 'Source attribution', 240);
  // Bound the array BEFORE parsing: validating a 100k-entry list and then
  // slicing to 8 burns a whole invocation's CPU on URLs that get discarded.
  if (data.captionTracks !== undefined && (!Array.isArray(data.captionTracks) || data.captionTracks.length > MAX_CAPTION_TRACKS)) {
    throw new HttpsError('invalid-argument', `Provide at most ${MAX_CAPTION_TRACKS} caption or transcript tracks.`);
  }
  const captionTracks = Array.isArray(data.captionTracks) ? data.captionTracks.map((track) => {
    if (!track || typeof track !== 'object') throw new HttpsError('invalid-argument', 'Caption metadata is invalid.');
    const entry = track as Record<string, unknown>;
    return { language: requireString(entry.language, 'Caption language', 20), url: requireUrl(entry.url, 'Caption URL'), kind: entry.kind === 'transcript' ? 'transcript' : 'captions' };
  }) : [];
  const relatedVideoIds = parseIdList(data.relatedVideoIds, 'Related video ID', 8);
  return { visibility, teamId, category, title, description, externalUrl: externalUrl ?? null, storagePath: storagePath ?? null, sourceAttribution, captionTracks, transcriptAvailable: captionTracks.some((track) => track.kind === 'transcript'), relatedVideoIds, searchTokens: searchTokens(title, description, category, sourceAttribution), publicationStatus: actor.platformAdmin ? 'published' : 'draft' as PublicationStatus };
}

export const createVideo = async (request: Phase5Request) => {
  const auth = requireAuth(request);
  const data = inputRecord(request);
  const actor = data.visibility === 'community' ? auth : await requireTeamMember(request, requireString(data.teamId, 'Team ID'));
  const fields = videoFields(data, actor);
  const videoId = optionalString(data.videoId, 'Video ID', 128) ?? db().collection('videos').doc().id;
  const ref = db().doc(`videos/${videoId}`);
  const opRef = operationRef(fields.teamId, data.operationId);
  const committed = await db().runTransaction(async (transaction) => {
    if (fields.teamId) await assertTeamMemberInTransaction(transaction, fields.teamId, actor.uid);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId: fields.teamId, actorUserId: actor.uid, kind: 'video.create' });
      return requireString(receipt.videoId, 'Stored video ID');
    }
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.createdBy !== actor.uid
        || (existing.data()?.teamId ?? null) !== (fields.teamId ?? null)
        || existing.data()?.visibility !== fields.visibility) throw new HttpsError('already-exists', 'Video ID is already used by another video operation.');
      return videoId;
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: videoId, ...fields, createdBy: actor.uid, createdAt: now, updatedAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: fields.teamId ?? undefined, targetResource: `videos/${videoId}`, metadata: { action: 'video.created', status: fields.publicationStatus } }));
    if (opRef) transaction.set(opRef, { teamId: fields.teamId ?? null, createdBy: actor.uid, kind: 'video.create', videoId, createdAt: now });
    return videoId;
  });
  return { videoId: committed };
};

export const searchVideos = async (request: Phase5Request) => {
  const auth = requireAuth(request);
  const data = inputRecord(request);
  const term = normalizeText(requireString(data.query, 'Search query', 80)).toLowerCase().split(/\s+/)[0];
  const pageSize = parsePageSize(data.pageSize);
  const cursor = parseCursor(data.before);
  const teamId = data.teamId === undefined ? undefined : requireString(data.teamId, 'Team ID');
  const actor: TeamAdmin = teamId ? await requireTeamMember(request, teamId) : auth;
  // Team admins (and each video's creator) must see drafts and unpublished
  // videos, or the created-as-draft publish workflow is unreachable.
  const managesTeamVideos = Boolean(teamId) && (actor.platformAdmin === true || ['coach', 'teamLeader'].includes(String(actor.role)));
  // Firestore rejects where() after startAfter(), so every filter is applied
  // before the cursor and the page limit.
  let query = db().collection('videos').where('searchTokens', 'array-contains', term);
  if (teamId) query = query.where('teamId', '==', teamId).where('visibility', '==', 'team') as typeof query;
  else query = query.where('publicationStatus', '==', 'published').where('visibility', '==', 'community').where('teamId', '==', null) as typeof query;
  query = query.orderBy('createdAt', 'desc').limit(MAX_SEARCH_SCAN) as typeof query;
  if (cursor) query = query.startAfter(cursor) as typeof query;
  const snapshots = await query.get();
  const category = data.category === undefined ? undefined : requireString(data.category, 'Category', 40);
  const videos = snapshots.docs.map(asPlainDocument).filter((video) => {
    if (category && video.category !== category) return false;
    if (video.publicationStatus === 'published') return true;
    if (video.publicationStatus === 'removed') return false;
    return managesTeamVideos || video.createdBy === actor.uid;
  }).slice(0, pageSize);
  return { videos, nextBefore: searchNextBefore(videos, snapshots, pageSize) };
};

export const toggleVideoFavorite = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const videoId = requireString(getInput(request, 'videoId'), 'Video ID');
  const videoRef = db().doc(`videos/${videoId}`);
  const ref = db().doc(`videoFavorites/${actor.uid}_${videoId}`);
  let favorite = false;
  await db().runTransaction(async (transaction) => {
    const video = await transaction.get(videoRef);
    const existing = await transaction.get(ref);
    if (!video.exists) throw new HttpsError('not-found', 'Video not found.');
    await assertContentAccessInTransaction(transaction, actor, video.data() ?? {});
    if (existing.exists) transaction.delete(ref);
    else transaction.set(ref, { id: ref.id, userId: actor.uid, videoId, teamId: video.data()?.teamId ?? null, createdAt: FieldValue.serverTimestamp() });
    favorite = !existing.exists;
  });
  return { videoId, favorite };
};

export const recordVideoWatch = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const videoId = requireString(getInput(request, 'videoId'), 'Video ID');
  const progressSeconds = getInput(request, 'progressSeconds') ?? 0;
  if (typeof progressSeconds !== 'number' || progressSeconds < 0 || progressSeconds > 24 * 60 * 60) throw new HttpsError('invalid-argument', 'Watch progress is invalid.');
  const video = await db().doc(`videos/${videoId}`).get();
  if (!video.exists) throw new HttpsError('not-found', 'Video not found.');
  await assertContentAccess(actor, video.data() ?? {});
  const ref = db().doc(`videoWatchHistory/${actor.uid}_${videoId}`);
  await ref.set({ id: ref.id, userId: actor.uid, videoId, teamId: video.data()?.teamId ?? null, progressSeconds, lastWatchedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { videoId, recorded: true };
};

export const updateVideoPublication = async (request: Phase5Request) => {
  const data = inputRecord(request);
  const videoId = requireString(data.videoId, 'Video ID');
  const publicationStatus = requireString(data.publicationStatus, 'Publication status', 20) as PublicationStatus;
  if (!(['draft', 'published', 'unpublished', 'removed'] as string[]).includes(publicationStatus)) throw new HttpsError('invalid-argument', 'Publication status is invalid.');
  const videoRef = db().doc(`videos/${videoId}`);
  const video = await videoRef.get();
  if (!video.exists) throw new HttpsError('not-found', 'Video not found.');
  const teamId = video.data()?.teamId;
  const actor = teamId ? await requireTeamAdmin(request, teamId) : requireAuth(request);
  if (!teamId && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only an approved community publisher can manage community videos.');
  await db().runTransaction(async (transaction) => {
    const current = await transaction.get(videoRef);
    if (!current.exists) throw new HttpsError('not-found', 'Video not found.');
    if (teamId) await assertTeamAdminInTransaction(transaction, teamId, actor);
    const now = FieldValue.serverTimestamp();
    transaction.update(videoRef, { publicationStatus, updatedAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: teamId ?? undefined, targetResource: `videos/${videoId}`, metadata: { action: 'video.publication.updated', status: publicationStatus } }));
  });
  return { videoId, publicationStatus };
};

function pollFields(data: Record<string, unknown>, actor: TeamAdmin) {
  const visibility = parseVisibility(data.visibility);
  const teamId = parseTeamId(data.teamId, visibility);
  if (visibility === 'community' && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only approved community publishers can create community polls.');
  const question = requireString(data.question, 'Poll question', 300);
  const options = parsePollOptions(data.options);
  const selection = data.selection === 'multiple' ? 'multiple' : 'single';
  const anonymous = data.anonymous === true;
  const resultsVisibility = data.resultsVisibility ?? (anonymous ? 'afterClose' : 'afterVote');
  if (!['never', 'afterVote', 'afterClose', 'always'].includes(String(resultsVisibility))) throw new HttpsError('invalid-argument', 'Results visibility is invalid.');
  const audienceRoles = data.audienceRoles === undefined ? [...POLL_ROLES] : parseIdList(data.audienceRoles, 'Audience role', 5);
  if (audienceRoles.some((role) => !(POLL_ROLES as readonly string[]).includes(role))) throw new HttpsError('invalid-argument', 'Audience role is invalid.');
  const expiresAt = parseDate(data.expiresAt, 'Expiration', false);
  if (expiresAt && expiresAt.toMillis() <= Date.now()) throw new HttpsError('invalid-argument', 'Expiration must be in the future.');
  return { visibility, teamId, question, options, selection, anonymous, resultsVisibility, audienceRoles, expiresAt, status: 'open' as const, totalVotes: 0, optionVoteCounts: Object.fromEntries(options.map((option) => [option.id, 0])) };
}

export const createPoll = async (request: Phase5Request) => {
  const auth = requireAuth(request);
  const data = inputRecord(request);
  const actor = data.visibility === 'community' ? auth : await requireTeamMember(request, requireString(data.teamId, 'Team ID'));
  const fields = pollFields(data, actor);
  const pollId = optionalString(data.pollId, 'Poll ID', 128) ?? db().collection('polls').doc().id;
  const pollRef = db().doc(`polls/${pollId}`);
  const opRef = operationRef(fields.teamId, data.operationId);
  const committed = await db().runTransaction(async (transaction) => {
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId: fields.teamId, actorUserId: actor.uid, kind: 'poll.create' });
      return requireString(receipt.pollId, 'Stored poll ID');
    }
    const existing = await transaction.get(pollRef);
    if (existing.exists) {
      if (existing.data()?.createdBy !== actor.uid
        || (existing.data()?.teamId ?? null) !== (fields.teamId ?? null)
        || existing.data()?.visibility !== fields.visibility) throw new HttpsError('already-exists', 'Poll ID is already used by another poll operation.');
      return pollId;
    }
    if (fields.teamId) await assertTeamMemberInTransaction(transaction, fields.teamId, actor.uid);
    const recipients = fields.teamId ? await activeAudience(transaction, fields.teamId, fields.audienceRoles) : [];
    const now = FieldValue.serverTimestamp();
    transaction.set(pollRef, { id: pollId, ...fields, createdBy: actor.uid, createdAt: now, updatedAt: now, closedAt: null });
    if (fields.teamId) writePollNotifications(transaction, fields.teamId, pollId, fields.question, recipients.filter((uid) => uid !== actor.uid));
    const historyRef = db().collection('pollHistory').doc();
    transaction.set(historyRef, { id: historyRef.id, pollId, teamId: fields.teamId, action: 'created', actorUserId: actor.uid, createdAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: fields.teamId ?? undefined, targetResource: `polls/${pollId}`, metadata: { action: 'poll.created', status: 'open' } }));
    if (opRef) transaction.set(opRef, { teamId: fields.teamId ?? null, createdBy: actor.uid, kind: 'poll.create', pollId, createdAt: now });
    return pollId;
  });
  return { pollId: committed };
};

export const closePoll = async (request: Phase5Request) => {
  const pollId = requireString(getInput(request, 'pollId'), 'Poll ID');
  const pollRef = db().doc(`polls/${pollId}`);
  const poll = await pollRef.get();
  if (!poll.exists) throw new HttpsError('not-found', 'Poll not found.');
  const actor = poll.data()?.teamId ? await requireTeamAdmin(request, requireString(poll.data()?.teamId, 'Team ID')) : requireAuth(request);
  if (!poll.data()?.teamId && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only an approved community publisher can close this poll.');
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(pollRef);
    if (snapshot.data()?.status === 'closed') return;
    if (poll.data()?.teamId) await assertTeamAdminInTransaction(transaction, String(poll.data()?.teamId), actor);
    const now = FieldValue.serverTimestamp();
    transaction.update(pollRef, { status: 'closed', closedAt: now, updatedAt: now });
    transaction.set(db().collection('pollHistory').doc(), { pollId, teamId: poll.data()?.teamId, action: 'closed', actorUserId: actor.uid, createdAt: now });
    transaction.set(db().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId: poll.data()?.teamId, targetResource: `polls/${pollId}`, metadata: { action: 'poll.closed', previousStatus: 'open', status: 'closed' } }));
  });
  return { pollId, status: 'closed' as const };
};

function pollIsClosed(poll: DocumentData) {
  return poll.status === 'closed' || (typeof poll.expiresAt?.toMillis === 'function' && poll.expiresAt.toMillis() <= Date.now());
}

export function pollResultsAreVisible(poll: DocumentData, hasVoted: boolean, isAdmin: boolean) {
  return isAdmin
    || poll.resultsVisibility === 'always'
    || (poll.resultsVisibility === 'afterVote' && hasVoted)
    || (poll.resultsVisibility === 'afterClose' && pollIsClosed(poll));
}

export function sanitizePollForList(poll: DocumentData, resultsVisible: boolean) {
  const sanitized: DocumentData = { ...poll, resultsVisible };
  if (!resultsVisible) {
    delete sanitized.totalVotes;
    delete sanitized.optionVoteCounts;
  }
  return sanitized;
}

export function validateVote(poll: DocumentData, selectedOptionIds: unknown) {
  if (pollIsClosed(poll)) throw new HttpsError('failed-precondition', 'This poll is closed or expired.');
  if (!Array.isArray(selectedOptionIds) || selectedOptionIds.length < 1 || selectedOptionIds.length > 8) throw new HttpsError('invalid-argument', 'Select at least one choice.');
  const unique = [...new Set(selectedOptionIds.map((id) => requireString(id, 'Choice ID', 40)))];
  if (poll.selection === 'single' && unique.length !== 1) throw new HttpsError('invalid-argument', 'Choose exactly one option.');
  const validOptions = new Set((poll.options as Array<{ id: string }>).map((option) => option.id));
  if (unique.some((id) => !validOptions.has(id))) throw new HttpsError('invalid-argument', 'Choice is not part of this poll.');
  return unique;
}

export const votePoll = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const pollId = requireString(getInput(request, 'pollId'), 'Poll ID');
  const pollRef = db().doc(`polls/${pollId}`);
  const voteRef = db().doc(`pollVotes/${pollId}_${actor.uid}`);
  const operationId = getInput(request, 'operationId');
  let resultsVisible = false;
  await db().runTransaction(async (transaction) => {
    const pollSnapshot = await transaction.get(pollRef);
    if (!pollSnapshot.exists) throw new HttpsError('not-found', 'Poll not found.');
    const poll = pollSnapshot.data() ?? {};
    const member = poll.visibility === 'team' ? await assertTeamMemberInTransaction(transaction, String(poll.teamId), actor.uid) : null;
    if (member && !pollAudienceIncludesRole(poll.audienceRoles, member.role)) throw new HttpsError('permission-denied', 'You are not in this poll audience.');
    const teamId = (poll.teamId ?? null) as string | null;
    const opRef = operationRef(teamId, operationId);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      // Without a receipt a retried vote surfaced as `already-exists`, which the
      // voter reads as "your vote was rejected" rather than "already counted".
      const receipt = phase5OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: actor.uid, kind: 'poll.vote' });
      if (receipt.pollId !== pollId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different knowledge operation.');
      resultsVisible = receipt.resultsVisible === true;
      return;
    }
    const choices = validateVote(poll, getInput(request, 'selectedOptionIds'));
    const existing = await transaction.get(voteRef);
    if (existing.exists) throw new HttpsError('already-exists', 'You have already voted in this poll.');
    const counts = { ...((poll.optionVoteCounts ?? {}) as Record<string, number>) };
    for (const optionId of choices) counts[optionId] = Number(counts[optionId] ?? 0) + 1;
    const now = FieldValue.serverTimestamp();
    transaction.set(voteRef, { id: voteRef.id, pollId, teamId: poll.teamId, voterUserId: actor.uid, selectedOptionIds: choices, anonymous: poll.anonymous === true, createdAt: now });
    transaction.update(pollRef, { totalVotes: FieldValue.increment(1), optionVoteCounts: counts, updatedAt: now });
    resultsVisible = poll.resultsVisibility === 'always' || poll.resultsVisibility === 'afterVote';
    if (opRef) transaction.set(opRef, { teamId, createdBy: actor.uid, kind: 'poll.vote', pollId, resultsVisible, createdAt: now });
  });
  return { pollId, voted: true, resultsVisible };
};

export const getPollResults = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const pollId = requireString(getInput(request, 'pollId'), 'Poll ID');
  const pollSnapshot = await db().doc(`polls/${pollId}`).get();
  if (!pollSnapshot.exists) throw new HttpsError('not-found', 'Poll not found.');
  const poll = pollSnapshot.data() ?? {};
  if (poll.visibility === 'team') {
    const member = await requireTeamMember(request, String(poll.teamId));
    if (!pollAudienceIncludesRole(poll.audienceRoles, member.role)) throw new HttpsError('permission-denied', 'You are not in this poll audience.');
    const vote = await db().doc(`pollVotes/${pollId}_${actor.uid}`).get();
    const allowed = pollResultsAreVisible(poll, vote.exists, ['coach', 'teamLeader'].includes(String(member.role)));
    if (!allowed) throw new HttpsError('permission-denied', 'Poll results are not available yet.');
  } else {
    const vote = await db().doc(`pollVotes/${pollId}_${actor.uid}`).get();
    const allowed = pollResultsAreVisible(poll, vote.exists, false);
    if (!allowed) throw new HttpsError('permission-denied', 'Poll results are not available yet.');
  }
  return { pollId, totalVotes: Number(poll.totalVotes ?? 0), optionVoteCounts: poll.optionVoteCounts ?? {}, anonymous: poll.anonymous === true };
};

export const listPolls = async (request: Phase5Request) => {
  const actor = requireAuth(request);
  const teamId = requireString(getInput(request, 'teamId'), 'Team ID');
  const member = await requireTeamMember(request, teamId);
  const snapshots = await db().collection('polls').where('teamId', '==', teamId).where('visibility', '==', 'team').orderBy('createdAt', 'desc').limit(MAX_PAGE_SIZE).get();
  const audiencePolls = snapshots.docs.filter((snapshot) => pollAudienceIncludesRole(snapshot.data().audienceRoles, member.role));
  const votes = await Promise.all(audiencePolls.map((snapshot) => db().doc(`pollVotes/${snapshot.id}_${actor.uid}`).get()));
  const isAdmin = ['coach', 'teamLeader'].includes(String(member.role));
  const polls = audiencePolls.map((snapshot, index) => {
    const poll = asPlainDocument(snapshot);
    return sanitizePollForList(poll, pollResultsAreVisible(poll, votes[index].exists, isAdmin));
  });
  return { polls, actorUserId: actor.uid };
};
