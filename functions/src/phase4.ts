import { FieldValue, getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  assertTeamMemberInTransaction,
  getInput,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember,
  requireString,
  auditRecord,
  type TeamAdmin
} from './phase2.js';

type Phase4Request = CallableRequest<Record<string, unknown>>;
type ChannelVisibility = 'team' | 'coaches' | 'direct';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_SEARCH_PAGE = 25;
const REACTION_SET = new Set(['👍', '❤️', '🎉', '🚀', '😂', '🤔', '👏', '✅']);

function record(request: Phase4Request) {
  return request.data ?? {};
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, label);
}

function boundedStringArray(value: unknown, label: string, maxItems: number, maxLength = 128): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} is too large.`);
  return [...new Set(value.map((entry) => requireString(entry, label, maxLength)))];
}

function isAdmin(actor: TeamAdmin) {
  return actor.platformAdmin || actor.role === 'coach' || actor.role === 'teamLeader';
}

function isCoach(actor: TeamAdmin) {
  return isAdmin(actor);
}

function parseMessageBody(value: unknown) {
  return requireString(value, 'Message body', MAX_MESSAGE_LENGTH);
}

function searchTokens(body: string) {
  return [...new Set(body.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,63}/g) ?? [])].slice(0, 40);
}

function mentionIds(body: string) {
  return [...new Set(body.match(/@([A-Za-z0-9_-]{1,64})/g)?.map((mention) => mention.slice(1)) ?? [])];
}

async function teamPolicy(transaction: Transaction, teamId: string) {
  const snapshot = await transaction.get(getFirestore().doc(`teamPolicies/${teamId}`));
  if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Team safety policy is missing.');
  return snapshot.data() ?? {};
}

async function channelFor(transaction: Transaction, teamId: string, channelId: string) {
  const snapshot = await transaction.get(getFirestore().doc(`channels/${channelId}`));
  if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Channel not found in this team.');
  return { ref: snapshot.ref, data: snapshot.data() ?? {} };
}

/**
 * The team's `parentVisibility` policy, resolved conservatively.
 *
 * Anything other than an explicit `teamMembers` opt-in — including a missing or
 * malformed policy document — keeps parents out of the team conversation, which
 * is the default the product promises and `DEFAULT_TEAM_POLICY` sets.
 */
export function parentsCanReadTeamContent(policy: Record<string, unknown>) {
  return policy.parentVisibility === 'teamMembers';
}

/**
 * The single channel-authorization rule. Phase 7 search imports this rather than
 * keeping its own copy, so the two cannot drift apart.
 *
 * A parent reaches a team channel only when the team has opted into
 * `parentVisibility: 'teamMembers'`; coach and direct channels already exclude
 * parents through `isCoach`. A platform admin is not a team parent, so the
 * admin/coach shortcut is evaluated first.
 */
export function canAccessChannel(actor: TeamAdmin, channel: Record<string, unknown>, policy: Record<string, unknown>) {
  if (channel.visibility === 'team') return actor.role === 'parent' ? parentsCanReadTeamContent(policy) : true;
  if (channel.visibility === 'coaches') return isCoach(actor);
  if (channel.visibility === 'direct') {
    if (policy.directMessaging !== 'coachesOnly' || !isCoach(actor)) return false;
    return Array.isArray(channel.participantUserIds) && channel.participantUserIds.includes(actor.uid);
  }
  return false;
}

async function assertChannelAccess(transaction: Transaction, teamId: string, actor: TeamAdmin, channelId: string) {
  const policy = await teamPolicy(transaction, teamId);
  const channel = await channelFor(transaction, teamId, channelId);
  if (channel.data.archived === true) throw new HttpsError('failed-precondition', 'This channel is archived.');
  if (!canAccessChannel(actor, channel.data, policy)) throw new HttpsError('permission-denied', 'You are not permitted to use this channel.');
  return { ...channel, policy };
}

async function activeMembers(transaction: Transaction, teamId: string) {
  const snapshots = await transaction.get(getFirestore().collection('memberships').where('teamId', '==', teamId).where('status', '==', 'active'));
  return snapshots.docs.map((snapshot) => ({ uid: String(snapshot.data().userId), role: String(snapshot.data().role) }));
}

async function assertActiveUserIds(transaction: Transaction, teamId: string, userIds: string[]) {
  const members = await activeMembers(transaction, teamId);
  const valid = new Set(members.map((member) => member.uid));
  if (userIds.some((userId) => !valid.has(userId))) throw new HttpsError('not-found', 'Every conversation participant must be an active team member.');
  return members;
}

function notificationId(recipientUserId: string, teamId: string, dedupeKey: string) {
  return Buffer.from(`${recipientUserId}_${teamId}_${dedupeKey}`).toString('base64url');
}

async function notificationStates(
  transaction: Transaction,
  teamId: string,
  recipients: string[],
  dedupeKey: string,
  channelId: string
) {
  const db = getFirestore();
  const unique = [...new Set(recipients)].filter(Boolean);
  const refs = unique.map((uid) => db.doc(`notifications/${notificationId(uid, teamId, dedupeKey)}`));
  const muteRefs = unique.map((uid) => db.doc(`channelMutes/${teamId}_${uid}_${channelId}`));
  const snapshots = await Promise.all([...refs, ...muteRefs].map((ref) => transaction.get(ref)));
  return refs
    .map((ref, index) => ({ ref, exists: snapshots[index].exists, muted: snapshots[refs.length + index].data()?.muted === true, recipientUserId: unique[index] }))
    .filter((record) => !record.muted)
    .map((record) => ({ ref: record.ref, exists: record.exists, recipientUserId: record.recipientUserId }));
}

function writeNotifications(
  transaction: Transaction,
  records: Array<{ ref: FirebaseFirestore.DocumentReference; exists: boolean; recipientUserId: string }>,
  teamId: string,
  type: string,
  title: string,
  body: string,
  deepLink: string,
  dedupeKey: string
) {
  const now = FieldValue.serverTimestamp();
  records.forEach((record) => {
    if (record.exists) return;
    transaction.set(record.ref, {
      id: record.ref.id, teamId, createdBy: 'system', recipientUserId: record.recipientUserId, type, title, body, deepLink,
      dedupeKey, mandatory: false, readAt: null, createdAt: now, updatedAt: now
    });
  });
}

function channelRecipients(actor: TeamAdmin, channel: Record<string, unknown>, members: Array<{ uid: string; role: string }>, policy: Record<string, unknown>) {
  if (channel.visibility === 'direct') return (channel.participantUserIds as string[]).filter((uid) => uid !== actor.uid);
  if (channel.visibility === 'coaches') return members.filter((member) => ['coach', 'teamLeader'].includes(member.role)).map((member) => member.uid).filter((uid) => uid !== actor.uid);
  // Recipients double as the allowed-mention set, so a parent who cannot read the
  // channel is neither notified about it nor mentionable in it.
  return members
    .filter((member) => member.role !== 'parent' || parentsCanReadTeamContent(policy))
    .map((member) => member.uid)
    .filter((uid) => uid !== actor.uid);
}

export const createChannel = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const input = record(request);
  const name = requireString(input.name, 'Channel name', 80);
  const visibility = (input.visibility ?? 'team') as ChannelVisibility;
  if (!['team', 'coaches', 'direct'].includes(visibility)) throw new HttpsError('invalid-argument', 'Channel visibility is invalid.');
  const participantUserIds = boundedStringArray(input.participantUserIds, 'Participants', 8);
  const channelId = optionalId(input.channelId, 'Channel ID') ?? getFirestore().collection('channels').doc().id;
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const policy = await teamPolicy(transaction, teamId);
    const ref = db.doc(`channels/${channelId}`);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.teamId !== teamId || existing.data()?.createdBy !== actor.uid) throw new HttpsError('already-exists', 'Channel ID is already used by another channel operation.');
      return;
    }
    if (visibility === 'direct') {
      if (policy.directMessaging !== 'coachesOnly' || !isCoach(actor)) throw new HttpsError('permission-denied', 'Direct messaging is disabled or limited to coaches.');
      if (participantUserIds.length !== 2 || !participantUserIds.includes(actor.uid)) throw new HttpsError('invalid-argument', 'A direct channel needs exactly two participants including you.');
      const members = await assertActiveUserIds(transaction, teamId, participantUserIds);
      if (participantUserIds.some((userId) => !['coach', 'teamLeader'].includes(members.find((member) => member.uid === userId)?.role ?? ''))) throw new HttpsError('permission-denied', 'Direct channels may only include coaches under the current team policy.');
    } else if (participantUserIds.length > 0) {
      throw new HttpsError('invalid-argument', 'Team channels cannot provide a private participant list.');
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: channelId, teamId, name, description: input.description === undefined ? '' : requireString(input.description, 'Channel description', 240), visibility, participantUserIds, archived: false, createdBy: actor.uid, createdAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `channels/${channelId}`, metadata: { action: 'channel.created' } }));
  });
  return { channelId };
};

export const archiveChannel = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const channelId = requireString(getInput(request, 'channelId'), 'Channel ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const { ref } = await channelFor(transaction, teamId, channelId);
    transaction.update(ref, { archived: true, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `channels/${channelId}`, metadata: { action: 'channel.archived' } }));
  });
  return { channelId, archived: true as const };
};

export const sendMessage = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const input = record(request);
  const channelId = requireString(input.channelId, 'Channel ID');
  const body = parseMessageBody(input.body);
  const parentMessageId = optionalId(input.parentMessageId, 'Parent message ID');
  const attachmentFileIds = boundedStringArray(input.attachmentFileIds, 'Attachments', 5);
  const requestedMessageId = optionalId(input.messageId, 'Message ID');
  const messageId = requestedMessageId ?? (input.operationId === undefined ? getFirestore().collection('messages').doc().id : `message_${requireString(input.operationId, 'Operation ID', 96)}`);
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const { data: channel, policy } = await assertChannelAccess(transaction, teamId, actor, channelId);
    if (attachmentFileIds.length > 0) {
      if (policy.fileSharing !== 'teamOnly') throw new HttpsError('permission-denied', 'Attachments are disabled by the team policy.');
      const files = await Promise.all(attachmentFileIds.map((fileId) => transaction.get(db.doc(`fileMetadata/${fileId}`))));
      if (files.some((file) => !file.exists || file.data()?.teamId !== teamId || file.data()?.status !== 'ready' || !['clean', 'notConfigured'].includes(String(file.data()?.scanStatus)))) throw new HttpsError('permission-denied', 'Every attachment must be a ready, team-scoped file.');
    }
    let parent: FirebaseFirestore.DocumentData | undefined;
    if (parentMessageId) {
      const parentSnapshot = await transaction.get(db.doc(`messages/${parentMessageId}`));
      parent = parentSnapshot.data();
      if (!parentSnapshot.exists || parent?.teamId !== teamId || parent.channelId !== channelId || parent.deletedAt) throw new HttpsError('not-found', 'Thread parent not found.');
    }
    const mentionUserIds = mentionIds(body);
    const members = await activeMembers(transaction, teamId);
    const memberIds = new Set(members.map((member) => member.uid));
    if (mentionUserIds.some((uid) => !memberIds.has(uid))) throw new HttpsError('not-found', 'Every mention must reference an active team member.');
    const allowedMentionIds = new Set(channelRecipients(actor, channel, members, policy));
    if (mentionUserIds.some((uid) => !allowedMentionIds.has(uid))) throw new HttpsError('permission-denied', 'Every mention must reference someone who can read this channel.');
    const ref = db.doc(`messages/${messageId}`);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.teamId !== teamId || existing.data()?.channelId !== channelId || existing.data()?.authorUserId !== actor.uid) throw new HttpsError('already-exists', 'Message ID is already used by another message operation.');
      return;
    }
    const recipients = [...new Set([...mentionUserIds, ...(channel.visibility === 'direct' ? channelRecipients(actor, channel, members, policy) : []), parent?.authorUserId as string | undefined].filter((uid): uid is string => Boolean(uid && uid !== actor.uid)))];
    const notificationType = parentMessageId ? 'chat.reply' : mentionUserIds.length > 0 ? 'chat.mention' : channel.visibility === 'direct' ? 'chat.directMessage' : 'chat.message';
    const notificationRecords = recipients.length > 0 ? await notificationStates(transaction, teamId, recipients, `message:${messageId}`, channelId) : [];
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: messageId, teamId, channelId, visibility: channel.visibility, participantUserIds: channel.participantUserIds ?? [], authorUserId: actor.uid, body, kind: 'message', parentMessageId, mentionUserIds, attachmentFileIds, searchTokens: searchTokens(body), reactions: {}, replyCount: 0, deletedAt: null, createdAt: now, updatedAt: now });
    if (parentMessageId) transaction.update(db.doc(`messages/${parentMessageId}`), { replyCount: FieldValue.increment(1), updatedAt: now });
    if (notificationRecords.length > 0) writeNotifications(transaction, notificationRecords, teamId, notificationType, channel.visibility === 'direct' ? 'New direct message' : mentionUserIds.length > 0 ? 'You were mentioned' : 'New team message', body.slice(0, 160), `/chat?channel=${channelId}`, `message:${messageId}`);
  });
  return { messageId };
};

export const toggleReaction = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const messageId = requireString(getInput(request, 'messageId'), 'Message ID');
  const reaction = requireString(getInput(request, 'reaction'), 'Reaction', 8);
  if (!REACTION_SET.has(reaction)) throw new HttpsError('invalid-argument', 'Reaction is not supported.');
  const db = getFirestore();
  let added = false;
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const messageSnapshot = await transaction.get(db.doc(`messages/${messageId}`));
    const message = messageSnapshot.data();
    if (!messageSnapshot.exists || message?.teamId !== teamId) throw new HttpsError('not-found', 'Message not found.');
    const channel = await channelFor(transaction, teamId, String(message.channelId));
    const policy = await teamPolicy(transaction, teamId);
    if (!canAccessChannel(actor, channel.data, policy)) throw new HttpsError('permission-denied', 'You cannot react in this channel.');
    const reactions = (message.reactions ?? {}) as Record<string, unknown>;
    const users = Array.isArray(reactions[reaction]) ? [...(reactions[reaction] as unknown[]).map(String)] : [];
    if (users.includes(actor.uid)) {
      reactions[reaction] = users.filter((uid) => uid !== actor.uid);
      added = false;
    } else {
      if (users.length >= 100) throw new HttpsError('resource-exhausted', 'This reaction has reached its limit.');
      reactions[reaction] = [...users, actor.uid];
      added = true;
    }
    transaction.update(messageSnapshot.ref, { reactions, updatedAt: FieldValue.serverTimestamp() });
  });
  return { messageId, reaction, added };
};

export const markChannelRead = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const channelId = requireString(getInput(request, 'channelId'), 'Channel ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    await assertChannelAccess(transaction, teamId, actor, channelId);
    const ref = db.doc(`channelReads/${teamId}_${actor.uid}_${channelId}`);
    transaction.set(ref, { id: ref.id, teamId, channelId, userId: actor.uid, lastReadAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { channelId, read: true as const };
};

export const toggleChannelMute = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const channelId = requireString(getInput(request, 'channelId'), 'Channel ID');
  const muted = getInput(request, 'muted');
  if (typeof muted !== 'boolean') throw new HttpsError('invalid-argument', 'Muted must be boolean.');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    await assertChannelAccess(transaction, teamId, actor, channelId);
    const ref = db.doc(`channelMutes/${teamId}_${actor.uid}_${channelId}`);
    transaction.set(ref, { id: ref.id, teamId, channelId, userId: actor.uid, muted, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { channelId, muted };
};

export const deleteMessage = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const messageId = requireString(getInput(request, 'messageId'), 'Message ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const ref = db.doc(`messages/${messageId}`);
    const snapshot = await transaction.get(ref);
    const message = snapshot.data();
    if (!snapshot.exists || message?.teamId !== teamId) throw new HttpsError('not-found', 'Message not found.');
    if (message.authorUserId !== actor.uid && !isAdmin(actor)) throw new HttpsError('permission-denied', 'Only the author or a team admin can delete this message.');
    transaction.update(ref, { body: '[Message removed]', searchTokens: [], attachmentFileIds: [], deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // Deleting a message is a moderation action and has to leave a trail. The
    // body is deliberately never recorded — only who removed what, and where.
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'moderation.updated',
      actorUserId: actor.uid,
      teamId,
      targetUserId: String(message.authorUserId),
      targetResource: `messages/${messageId}`,
      metadata: { action: 'message.deleted' }
    }));
  });
  return { messageId, deleted: true as const };
};

export const createAnnouncement = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const input = record(request);
  const channelId = requireString(input.channelId, 'Channel ID');
  const title = requireString(input.title, 'Announcement title', 160);
  const body = parseMessageBody(input.body);
  const acknowledgementRequired = input.acknowledgementRequired !== false;
  const announcementId = optionalId(input.announcementId, 'Announcement ID') ?? getFirestore().collection('announcements').doc().id;
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const { data: channel, policy } = await assertChannelAccess(transaction, teamId, actor, channelId);
    const members = await activeMembers(transaction, teamId);
    const ref = db.doc(`announcements/${announcementId}`);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.teamId !== teamId || existing.data()?.channelId !== channelId || existing.data()?.createdBy !== actor.uid) throw new HttpsError('already-exists', 'Announcement ID is already used by another announcement operation.');
      return;
    }
    const recipients = channelRecipients(actor, channel, members, policy);
    const notificationRecords = recipients.length > 0 ? await notificationStates(transaction, teamId, recipients, `announcement:${announcementId}`, channelId) : [];
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: announcementId, teamId, channelId, title, body, acknowledgementRequired, createdBy: actor.uid, createdAt: now, updatedAt: now });
    if (notificationRecords.length > 0) writeNotifications(transaction, notificationRecords, teamId, 'chat.announcement', `Announcement: ${title}`, body.slice(0, 160), `/chat?channel=${channelId}&announcement=${announcementId}`, `announcement:${announcementId}`);
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `announcements/${announcementId}`, metadata: { action: 'announcement.created' } }));
  });
  return { announcementId };
};

export const acknowledgeAnnouncement = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const announcementId = requireString(getInput(request, 'announcementId'), 'Announcement ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const ref = db.doc(`announcements/${announcementId}`);
    const snapshot = await transaction.get(ref);
    const announcement = snapshot.data();
    if (!snapshot.exists || announcement?.teamId !== teamId) throw new HttpsError('not-found', 'Announcement not found.');
    await assertChannelAccess(transaction, teamId, actor, String(announcement.channelId));
    const ackRef = db.doc(`announcementAcknowledgements/${announcementId}_${actor.uid}`);
    transaction.set(ackRef, { id: ackRef.id, teamId, announcementId, userId: actor.uid, acknowledgedAt: FieldValue.serverTimestamp() });
  });
  return { announcementId, acknowledged: true as const };
};

export const searchMessages = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const term = requireString(getInput(request, 'query'), 'Search query', 64).toLowerCase();
  if (term.length < 2) throw new HttpsError('invalid-argument', 'Search query must be at least two characters.');
  const pageSizeValue = Number(getInput(request, 'pageSize') ?? MAX_SEARCH_PAGE);
  const pageSize = Number.isInteger(pageSizeValue) ? Math.min(Math.max(pageSizeValue, 1), MAX_SEARCH_PAGE) : MAX_SEARCH_PAGE;
  const before = getInput(request, 'before');
  const db = getFirestore();
  const policy = await db.doc(`teamPolicies/${teamId}`).get();
  if (!policy.exists) throw new HttpsError('failed-precondition', 'Team safety policy is missing.');
  let cursor: Timestamp | undefined;
  if (before !== undefined && before !== null) {
    const date = new Date(String(before));
    if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Search cursor is invalid.');
    cursor = Timestamp.fromDate(date);
  }
  const results = [];
  let lastSeen: Timestamp | null = null;
  let lastReturned: Timestamp | null = null;
  let exhausted = false;
  for (let page = 0; page < 4 && results.length < pageSize; page += 1) {
    let search = db.collection('messages').where('teamId', '==', teamId).where('searchTokens', 'array-contains', term).orderBy('createdAt', 'desc').limit(Math.min(100, pageSize * 4));
    if (cursor) search = search.startAfter(cursor);
    const snapshots = await search.get();
    if (snapshots.empty) {
      exhausted = true;
      break;
    }
    lastSeen = snapshots.docs.at(-1)?.data().createdAt instanceof Timestamp ? snapshots.docs.at(-1)?.data().createdAt as Timestamp : null;
    const channelIds = [...new Set(snapshots.docs.map((snapshot) => String(snapshot.data().channelId)))];
    const channels = await Promise.all(channelIds.map(async (channelId) => [channelId, await db.doc(`channels/${channelId}`).get()] as const));
    const channelMap = new Map(channels);
    for (const snapshot of snapshots.docs) {
      const message = snapshot.data();
      const channel = channelMap.get(String(message.channelId));
      if (!channel?.exists || !canAccessChannel(actor, channel.data() ?? {}, policy.data() ?? {})) continue;
      results.push({ id: snapshot.id, teamId, channelId: message.channelId, authorUserId: message.authorUserId, body: message.body, parentMessageId: message.parentMessageId ?? null, createdAt: message.createdAt instanceof Timestamp ? message.createdAt.toDate().toISOString() : null });
      if (message.createdAt instanceof Timestamp) lastReturned = message.createdAt;
      if (results.length >= pageSize) break;
    }
    if (snapshots.size < Math.min(100, pageSize * 4)) {
      exhausted = true;
      break;
    }
    if (!lastSeen) break;
    cursor = lastSeen;
  }
  // The cursor must resume after the last RETURNED match: results between the
  // pageSize cut-off and the end of the scan batch would otherwise be skipped.
  // When the page came up short but the scan was not exhausted, resume after
  // the last scanned doc so filtered-out spans do not end pagination early.
  const nextBefore = results.length >= pageSize ? lastReturned : exhausted ? null : lastSeen;
  return { messages: results, nextBefore: nextBefore?.toDate().toISOString() ?? null };
};

export const MESSAGE_PURGE_PAGE_SIZE = 100;

/**
 * Resolves the retention window a purge run should apply.
 *
 * `messageRetentionDays` is the only policy value that decides whether a team's
 * chat history is destroyed, so an absent or corrupt setting must fall back to
 * the longest supported window rather than deleting more than the team agreed
 * to. `validatePolicy` only ever stores 30, 90, or 365.
 */
export function messageRetentionDays(value: unknown): 30 | 90 | 365 {
  return value === 30 || value === 90 || value === 365 ? value : 365;
}

export function retentionCutoff(retentionDays: number, nowMillis = Date.now()) {
  return Timestamp.fromMillis(nowMillis - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Applies one team's `messageRetentionDays` policy to a single page of expired
 * messages. Shared by the coach-invoked callable and the nightly scheduler, so
 * retention behaves identically however it is triggered.
 *
 * `actorUserId` is the coach for a manual run and `system` for the scheduled
 * one; both write the same audit record.
 */
export async function purgeExpiredMessagesForTeam(teamId: string, actorUserId: string) {
  const db = getFirestore();
  let deletedCount = 0;
  let retentionDays: number = 365;
  await db.runTransaction(async (transaction) => {
    const policy = await transaction.get(db.doc(`teamPolicies/${teamId}`));
    if (!policy.exists) throw new HttpsError('failed-precondition', 'Team safety policy is missing.');
    retentionDays = messageRetentionDays(policy.data()?.messageRetentionDays);
    const cutoff = retentionCutoff(retentionDays);
    const snapshots = await transaction.get(db.collection('messages').where('teamId', '==', teamId).where('createdAt', '<', cutoff).where('deletedAt', '==', null).limit(MESSAGE_PURGE_PAGE_SIZE));
    deletedCount = snapshots.size;
    if (deletedCount === 0) return;
    snapshots.docs.forEach((snapshot) => transaction.update(snapshot.ref, { body: '[Message retained no longer]', searchTokens: [], attachmentFileIds: [], deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId, teamId, targetResource: `messages?retention=${retentionDays}`, metadata: { action: 'messages.retention-purged' } }));
  });
  return { deletedCount, retentionDays, hasMore: deletedCount === MESSAGE_PURGE_PAGE_SIZE };
}

/**
 * The coach-invoked path, for clearing a backlog immediately. The nightly
 * `enforceMessageRetention` schedule is what makes the policy truthful; this
 * exists so a coach who shortens retention does not have to wait for it.
 */
export const purgeExpiredMessages = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  await getFirestore().runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
  });
  return purgeExpiredMessagesForTeam(teamId, actor.uid);
};

export const exportTeamMessages = async (request: Phase4Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const channelId = optionalId(getInput(request, 'channelId'), 'Channel ID');
  const db = getFirestore();
  let messages: Array<Record<string, unknown>> = [];
  let truncated = false;
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const policy = await teamPolicy(transaction, teamId);
    const selectedChannel = channelId ? await channelFor(transaction, teamId, channelId) : null;
    if (selectedChannel && (selectedChannel.data.archived === true || !canAccessChannel(actor, selectedChannel.data, policy))) {
      throw new HttpsError('permission-denied', 'You are not permitted to export this channel.');
    }
    let messageQuery = db.collection('messages').where('teamId', '==', teamId).limit(500);
    if (channelId) messageQuery = messageQuery.where('channelId', '==', channelId);
    const snapshot = await transaction.get(messageQuery);
    const channelIds = channelId ? [] : [...new Set(snapshot.docs.map((document) => String(document.data().channelId)))];
    const channelSnapshots = await Promise.all(channelIds.map((id) => transaction.get(db.doc(`channels/${id}`))));
    const channels = new Map(channelSnapshots.map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));
    if (selectedChannel) channels.set(channelId!, selectedChannel.data);
    messages = snapshot.docs.filter((document) => {
      const channel = channels.get(String(document.data().channelId));
      return channel !== undefined && channel.archived !== true && canAccessChannel(actor, channel, policy);
    }).map((document) => {
      const data = document.data();
      return { id: document.id, channelId: data.channelId, authorUserId: data.authorUserId, body: data.body, parentMessageId: data.parentMessageId ?? null, mentionUserIds: data.mentionUserIds ?? [], attachmentFileIds: data.attachmentFileIds ?? [], createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null, deletedAt: data.deletedAt instanceof Timestamp ? data.deletedAt.toDate().toISOString() : null };
    });
    truncated = snapshot.size === 500;
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: actor.uid,
      teamId,
      targetResource: channelId ? `channels/${channelId}` : `messages?team=${teamId}`,
      metadata: { action: 'messages.exported' }
    }));
  });
  return { teamId, channelId, messages, truncated };
};
