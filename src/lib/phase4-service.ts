import { collection, doc, documentId, endBefore, getDoc, getDocs, limit, limitToLast, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { AppError } from './app-error';
import { call } from './callable';

export type ChatChannel = {
  id: string;
  teamId: string;
  name: string;
  description: string;
  visibility: 'team' | 'coaches' | 'direct';
  participantUserIds: string[];
  archived: boolean;
};

export type ChatMessage = {
  id: string;
  teamId: string;
  channelId: string;
  authorUserId: string;
  body: string;
  parentMessageId: string | null;
  mentionUserIds: string[];
  attachmentFileIds: string[];
  reactions: Record<string, string[]>;
  replyCount: number;
  deletedAt: unknown;
  createdAt: unknown;
};

export type TeamAnnouncement = {
  id: string;
  teamId: string;
  channelId: string;
  title: string;
  body: string;
  acknowledgementRequired: boolean;
  createdAt: unknown;
};

export type MessageCursor = QueryDocumentSnapshot<DocumentData>;
export type ListCursor = QueryDocumentSnapshot<DocumentData>;
export type ChannelCursors = Partial<Record<ChatChannel['visibility'], ListCursor | null>>;

/**
 * Page sizes are declared once because every query fetches `size + 1` documents:
 * the extra row is what makes "there is another page" a fact instead of the guess
 * `docs.length === size`, which lies whenever the last page is exactly full and
 * leaves a "Load more" control that fetches nothing.
 */
export const CHANNEL_PAGE_SIZE = 50;
export const MESSAGE_PAGE_SIZE = 50;
export const ANNOUNCEMENT_PAGE_SIZE = 25;
/** Firestore caps `in` / `documentId() in` at 30 values per query. */
const DOCUMENT_ID_CHUNK = 30;


/**
 * Mirrors `canReadChannel` in firestore.rules. Asking for a channel class the rules
 * forbid is denied outright, and one denied query fails the whole channel load — so
 * the coaches and direct queries must be gated exactly as the rules gate them.
 *
 * Each visibility is its own query, so paging is per visibility: `cursors` carries
 * the last document seen for each of them.
 */
export function buildChannelQueries(
  firestore: Firestore,
  teamId: string,
  role: string | undefined,
  userId: string,
  directMessagingEnabled = false,
  cursors: ChannelCursors = {}
) {
  const isCoach = role === 'coach' || role === 'teamLeader';
  const visibilities: Array<ChatChannel['visibility']> = ['team'];
  if (isCoach) visibilities.push('coaches');
  if (isCoach && directMessagingEnabled) visibilities.push('direct');
  return visibilities.map((visibility) => {
    const constraints: QueryConstraint[] = [where('teamId', '==', teamId), where('archived', '==', false), where('visibility', '==', visibility)];
    if (visibility === 'direct') constraints.push(where('participantUserIds', 'array-contains', userId));
    constraints.push(orderBy('createdAt', 'asc'));
    const cursor = cursors[visibility];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(CHANNEL_PAGE_SIZE + 1));
    return { visibility, query: query(collection(firestore, 'channels'), ...constraints) };
  });
}

export function parseChannel(id: string, data: Record<string, unknown>): ChatChannel {
  return { id, teamId: String(data.teamId ?? ''), name: String(data.name ?? 'Untitled channel'), description: String(data.description ?? ''), visibility: (data.visibility ?? 'team') as ChatChannel['visibility'], participantUserIds: Array.isArray(data.participantUserIds) ? data.participantUserIds.map(String) : [], archived: data.archived === true };
}

export async function loadChannelPage(
  firestore: Firestore,
  teamId: string,
  role: string | undefined,
  userId: string,
  directMessagingEnabled = false,
  cursors: ChannelCursors = {}
) {
  const queries = buildChannelQueries(firestore, teamId, role, userId, directMessagingEnabled, cursors);
  const snapshots = await Promise.all(queries.map((entry) => getDocs(entry.query)));
  const channels: ChatChannel[] = [];
  const nextCursors: ChannelCursors = {};
  let hasMore = false;
  queries.forEach((entry, index) => {
    const docs = snapshots[index].docs;
    const page = docs.slice(0, CHANNEL_PAGE_SIZE);
    if (docs.length > CHANNEL_PAGE_SIZE) hasMore = true;
    nextCursors[entry.visibility] = page.at(-1) ?? cursors[entry.visibility] ?? null;
    for (const channel of page) channels.push(parseChannel(channel.id, channel.data() as Record<string, unknown>));
  });
  return { channels, cursors: nextCursors, hasMore };
}

export function buildMessageQuery(firestore: Firestore, teamId: string, channelId: string, visibility: ChatChannel['visibility'], userId: string) {
  const constraints = [where('teamId', '==', teamId), where('channelId', '==', channelId), where('visibility', '==', visibility), orderBy('createdAt', 'asc'), limitToLast(MESSAGE_PAGE_SIZE + 1)];
  if (visibility === 'direct') constraints.push(where('participantUserIds', 'array-contains', userId));
  return query(collection(firestore, 'messages'), ...constraints);
}

export function buildOlderMessageQuery(firestore: Firestore, teamId: string, channelId: string, visibility: ChatChannel['visibility'], userId: string, cursor: MessageCursor) {
  const constraints = [where('teamId', '==', teamId), where('channelId', '==', channelId), where('visibility', '==', visibility), orderBy('createdAt', 'asc'), endBefore(cursor), limitToLast(MESSAGE_PAGE_SIZE + 1)];
  if (visibility === 'direct') constraints.push(where('participantUserIds', 'array-contains', userId));
  return query(collection(firestore, 'messages'), ...constraints);
}

export function parseChatMessage(id: string, data: Record<string, unknown>): ChatMessage {
  const reactions = data.reactions && typeof data.reactions === 'object' ? data.reactions as Record<string, unknown> : {};
  return { id, teamId: String(data.teamId ?? ''), channelId: String(data.channelId ?? ''), authorUserId: String(data.authorUserId ?? ''), body: String(data.body ?? ''), parentMessageId: data.parentMessageId ? String(data.parentMessageId) : null, mentionUserIds: Array.isArray(data.mentionUserIds) ? data.mentionUserIds.map(String) : [], attachmentFileIds: Array.isArray(data.attachmentFileIds) ? data.attachmentFileIds.map(String) : [], reactions: Object.fromEntries(Object.entries(reactions).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : []])), replyCount: Number(data.replyCount ?? 0), deletedAt: data.deletedAt ?? null, createdAt: data.createdAt };
}

function messagePage(snapshot: { docs: MessageCursor[] }) {
  // The query asks for one message more than the page renders, so the surplus row
  // is the proof that an older page exists. It is dropped before the page is built
  // and the cursor is taken from the retained documents.
  const hasOlder = snapshot.docs.length > MESSAGE_PAGE_SIZE;
  const docs = hasOlder ? snapshot.docs.slice(snapshot.docs.length - MESSAGE_PAGE_SIZE) : snapshot.docs;
  return {
    messages: docs.map((entry) => parseChatMessage(entry.id, entry.data() as Record<string, unknown>)),
    cursor: docs[0] ?? null,
    hasOlder
  };
}

export function subscribeToLatestMessages(firestore: Firestore, teamId: string, channelId: string, visibility: ChatChannel['visibility'], userId: string, onNext: (page: { messages: ChatMessage[]; cursor: MessageCursor | null; hasOlder: boolean }) => void, onError: (error: Error) => void) {
  return onSnapshot(buildMessageQuery(firestore, teamId, channelId, visibility, userId), (snapshot) => onNext(messagePage(snapshot)), onError);
}

export async function loadOlderMessages(firestore: Firestore, teamId: string, channelId: string, visibility: ChatChannel['visibility'], userId: string, cursor: MessageCursor) {
  return messagePage(await getDocs(buildOlderMessageQuery(firestore, teamId, channelId, visibility, userId, cursor)));
}

export async function getMessageTarget(firestore: Firestore, teamId: string, channelId: string, messageId: string) {
  const snapshot = await getDoc(doc(firestore, 'messages', messageId));
  if (!snapshot.exists()) throw new AppError('not-found', 'The linked message was not found or is no longer available.');
  const data = snapshot.data() as Record<string, unknown>;
  if (data.teamId !== teamId || data.channelId !== channelId) throw new AppError('permission-denied', 'The linked message does not belong to this team channel.');
  return parseChatMessage(snapshot.id, data);
}

export function buildAnnouncementQuery(firestore: Firestore, teamId: string, channelId: string, cursor: ListCursor | null = null) {
  const constraints: QueryConstraint[] = [where('teamId', '==', teamId), where('channelId', '==', channelId), orderBy('createdAt', 'desc')];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(ANNOUNCEMENT_PAGE_SIZE + 1));
  return query(collection(firestore, 'announcements'), ...constraints);
}

export function parseAnnouncement(id: string, data: Record<string, unknown>): TeamAnnouncement {
  return { id, teamId: String(data.teamId ?? ''), channelId: String(data.channelId ?? ''), title: String(data.title ?? ''), body: String(data.body ?? ''), acknowledgementRequired: data.acknowledgementRequired !== false, createdAt: data.createdAt };
}

export async function loadAnnouncementPage(firestore: Firestore, teamId: string, channelId: string, cursor: ListCursor | null = null) {
  const snapshot = await getDocs(buildAnnouncementQuery(firestore, teamId, channelId, cursor));
  const hasMore = snapshot.docs.length > ANNOUNCEMENT_PAGE_SIZE;
  const docs = snapshot.docs.slice(0, ANNOUNCEMENT_PAGE_SIZE);
  return {
    announcements: docs.map((entry) => parseAnnouncement(entry.id, entry.data() as Record<string, unknown>)),
    cursor: docs.at(-1) ?? null,
    hasMore
  };
}

/**
 * Acknowledgement ids are deterministic (`{announcementId}_{userId}`), so the
 * acknowledged set is a bounded `documentId()` lookup over the announcements that
 * are actually on screen. Querying by `teamId` + `userId` instead would scan every
 * acknowledgement the member has ever written — one document per announcement per
 * team, with no upper bound.
 */
export async function loadAcknowledgedAnnouncementIds(firestore: Firestore, userId: string, announcementIds: string[]) {
  if (announcementIds.length === 0) return new Set<string>();
  const ids = announcementIds.map((announcementId) => `${announcementId}_${userId}`);
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += DOCUMENT_ID_CHUNK) chunks.push(ids.slice(index, index + DOCUMENT_ID_CHUNK));
  const snapshots = await Promise.all(chunks.map((chunk) => getDocs(query(
    collection(firestore, 'announcementAcknowledgements'),
    where(documentId(), 'in', chunk),
    limit(chunk.length)
  ))));
  return new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((entry) => String(entry.data().announcementId ?? ''))));
}

export async function getChannelMute(firestore: Firestore, teamId: string, userId: string, channelId: string) {
  const snapshot = await getDocs(query(
    collection(firestore, 'channelMutes'),
    where('teamId', '==', teamId),
    where('userId', '==', userId),
    where('channelId', '==', channelId),
    limit(1)
  ));
  return snapshot.docs[0]?.data().muted === true;
}

export function createChannel(input: { teamId: string; channelId?: string; name: string; description?: string; visibility?: 'team' | 'coaches' | 'direct'; participantUserIds?: string[]; operationId: string }) {
  return call<typeof input, { channelId: string }>('createChannel', input);
}

export function archiveChannel(teamId: string, channelId: string) {
  return call<{ teamId: string; channelId: string }, { channelId: string; archived: true }>('archiveChannel', { teamId, channelId });
}

export function sendMessage(input: { teamId: string; channelId: string; body: string; parentMessageId?: string | null; attachmentFileIds?: string[]; operationId: string }) {
  return call<typeof input, { messageId: string }>('sendMessage', input);
}

export function toggleReaction(teamId: string, messageId: string, reaction: string) {
  return call<{ teamId: string; messageId: string; reaction: string }, { messageId: string; reaction: string; added: boolean }>('toggleReaction', { teamId, messageId, reaction });
}

export function markChannelRead(teamId: string, channelId: string) {
  return call<{ teamId: string; channelId: string }, { channelId: string; read: true }>('markChannelRead', { teamId, channelId });
}

export function toggleChannelMute(teamId: string, channelId: string, muted: boolean) {
  return call<{ teamId: string; channelId: string; muted: boolean }, { channelId: string; muted: boolean }>('toggleChannelMute', { teamId, channelId, muted });
}

export function deleteMessage(teamId: string, messageId: string) {
  return call<{ teamId: string; messageId: string }, { messageId: string; deleted: true }>('deleteMessage', { teamId, messageId });
}

/** Applies the team's retention policy immediately instead of waiting for the nightly schedule. */
export function purgeExpiredMessages(teamId: string) {
  return call<{ teamId: string }, { teamId: string; purged: number; hasMore: boolean }>('purgeExpiredMessages', { teamId });
}

export function exportTeamMessages(teamId: string, channelId?: string) {
  return call<{ teamId: string; channelId?: string }, { teamId: string; channelId: string | null; messages: ChatMessage[]; truncated: boolean }>('exportTeamMessages', { teamId, ...(channelId ? { channelId } : {}) });
}

export function createAnnouncement(input: { teamId: string; channelId: string; announcementId?: string; title: string; body: string; acknowledgementRequired?: boolean; operationId: string }) {
  return call<typeof input, { announcementId: string }>('createAnnouncement', input);
}

export function acknowledgeAnnouncement(teamId: string, announcementId: string) {
  return call<{ teamId: string; announcementId: string }, { announcementId: string; acknowledged: true }>('acknowledgeAnnouncement', { teamId, announcementId });
}

export type SearchResult = Pick<ChatMessage, 'id' | 'teamId' | 'channelId' | 'authorUserId' | 'body' | 'parentMessageId'> & { createdAt: string | null };

export function searchTeamMessages(input: { teamId: string; query: string; pageSize?: number; before?: string | null }) {
  return call<typeof input, { messages: SearchResult[]; nextBefore: string | null }>('searchMessages', input);
}
