import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import type { Answer, Poll, Question, Video, VideoCategory } from './domain';
import { AppError } from './app-error';
import { toDate } from './dates';
import { call } from './callable';


export type QuestionSearchResult = { questions: Question[]; nextBefore: string | null };
export type VideoSearchResult = { videos: Video[]; nextBefore: string | null };
export type PollListItem = Omit<Poll, 'totalVotes' | 'optionVoteCounts'> & {
  resultsVisible: boolean;
  totalVotes?: number;
  optionVoteCounts?: Record<string, number>;
};

export type QuestionComment = {
  id: string;
  questionId: string;
  teamId: string | null;
  createdBy: string;
  body: string;
  createdAt: unknown;
};

export type KnowledgeCursor = QueryDocumentSnapshot<DocumentData>;

/**
 * Every list below fetches `size + 1` documents so "there is another page" is a
 * fact rather than the guess `docs.length === size`, which lies when the final
 * page is exactly full.
 */
export const KNOWLEDGE_PAGE_SIZE = 25;
export const PERSONAL_PAGE_SIZE = 50;
/** Firestore caps `documentId() in` at 30 values per query. */
const DOCUMENT_ID_CHUNK = 30;

export function isKnowledgeTargetInContext(
  target: Pick<Question | Video, 'teamId' | 'visibility'>,
  activeTeamId: string | null
) {
  return target.visibility === 'community'
    || (Boolean(activeTeamId) && target.teamId === activeTeamId);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Field-by-field parsers. A spread cast
 * (`{ ...snapshot.data() } as Question`) trusts every field to exist, so one
 * document written before `tags` or `captionTracks` existed crashes the detail
 * view on `.join` / `.length`. Dates go through `toDate` so a Firestore
 * `Timestamp` and a replayed ISO string render the same label.
 */
export function parseQuestion(id: string, data: Record<string, unknown>): Question {
  return {
    id,
    teamId: data.teamId ? String(data.teamId) : null,
    visibility: data.visibility === 'community' ? 'community' : 'team',
    createdBy: String(data.createdBy ?? ''),
    title: String(data.title ?? 'Untitled question'),
    body: String(data.body ?? ''),
    category: String(data.category ?? 'General'),
    tags: stringList(data.tags),
    attachmentFileIds: stringList(data.attachmentFileIds),
    status: data.status === 'solved' || data.status === 'closed' ? data.status : 'open',
    moderationStatus: data.moderationStatus === 'removed' ? 'removed' : 'published',
    answerCount: Number(data.answerCount ?? 0),
    commentCount: Number(data.commentCount ?? 0),
    voteCount: Number(data.voteCount ?? 0),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

export function parseAnswer(id: string, data: Record<string, unknown>): Answer {
  return {
    id,
    teamId: data.teamId ? String(data.teamId) : null,
    visibility: data.visibility === 'community' ? 'community' : 'team',
    createdBy: String(data.createdBy ?? ''),
    questionId: String(data.questionId ?? ''),
    body: String(data.body ?? ''),
    accepted: data.accepted === true,
    moderationStatus: data.moderationStatus === 'removed' ? 'removed' : 'published',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

export function parseQuestionComment(id: string, data: Record<string, unknown>): QuestionComment {
  return {
    id,
    questionId: String(data.questionId ?? ''),
    teamId: data.teamId ? String(data.teamId) : null,
    createdBy: String(data.createdBy ?? ''),
    body: String(data.body ?? ''),
    createdAt: toDate(data.createdAt)
  };
}

export function parseVideo(id: string, data: Record<string, unknown>): Video {
  const captionTracks = Array.isArray(data.captionTracks) ? data.captionTracks : [];
  const publicationStatus = ['draft', 'published', 'unpublished', 'removed'].includes(String(data.publicationStatus))
    ? data.publicationStatus as Video['publicationStatus']
    : 'draft';
  return {
    id,
    teamId: data.teamId ? String(data.teamId) : null,
    visibility: data.visibility === 'community' ? 'community' : 'team',
    createdBy: String(data.createdBy ?? ''),
    category: String(data.category ?? 'Programming') as VideoCategory,
    title: String(data.title ?? 'Untitled video'),
    description: String(data.description ?? ''),
    externalUrl: data.externalUrl ? String(data.externalUrl) : null,
    storagePath: data.storagePath ? String(data.storagePath) : null,
    sourceAttribution: String(data.sourceAttribution ?? 'Unattributed'),
    captionTracks: captionTracks.map((track) => {
      const entry = track && typeof track === 'object' ? track as Record<string, unknown> : {};
      return { language: String(entry.language ?? 'en'), url: String(entry.url ?? ''), kind: entry.kind === 'transcript' ? 'transcript' as const : 'captions' as const };
    }),
    transcriptAvailable: data.transcriptAvailable === true,
    relatedVideoIds: stringList(data.relatedVideoIds),
    publicationStatus,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

export type PersonalKnowledgeCursors = {
  savedQuestions?: KnowledgeCursor | null;
  videoFavorites?: KnowledgeCursor | null;
  videoWatchHistory?: KnowledgeCursor | null;
};

function personalQuery(firestore: Firestore, collectionName: string, orderField: string, uid: string, cursor: KnowledgeCursor | null | undefined) {
  const constraints: QueryConstraint[] = [where('userId', '==', uid), orderBy(orderField, 'desc')];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(PERSONAL_PAGE_SIZE + 1));
  return query(collection(firestore, collectionName), ...constraints);
}

function personalPage(result: PromiseSettledResult<QuerySnapshot<DocumentData>>, field: string) {
  if (result.status !== 'fulfilled') return { ids: undefined, cursor: null, hasMore: false };
  const hasMore = result.value.docs.length > PERSONAL_PAGE_SIZE;
  const docs = result.value.docs.slice(0, PERSONAL_PAGE_SIZE);
  return { ids: docs.map((entry) => String(entry.data()[field] ?? '')), cursor: docs.at(-1) ?? null, hasMore };
}

/**
 * The three personal libraries are read independently — one denied read must not
 * hide the other two — and each is ordered newest first with a cursor so a member
 * with more than a page of saved records can still reach the rest.
 * `videoWatchHistory` is stamped with `lastWatchedAt`, not `createdAt`.
 */
export async function loadPersonalKnowledgeRecords(firestore: Firestore, uid: string, cursors: PersonalKnowledgeCursors = {}) {
  const [saved, favorites, watched] = await Promise.allSettled([
    getDocs(personalQuery(firestore, 'savedQuestions', 'createdAt', uid, cursors.savedQuestions)),
    getDocs(personalQuery(firestore, 'videoFavorites', 'createdAt', uid, cursors.videoFavorites)),
    getDocs(personalQuery(firestore, 'videoWatchHistory', 'lastWatchedAt', uid, cursors.videoWatchHistory))
  ]);
  const savedPage = personalPage(saved, 'questionId');
  const favoritesPage = personalPage(favorites, 'videoId');
  const watchedPage = personalPage(watched, 'videoId');
  return {
    savedQuestionIds: savedPage.ids,
    favoriteVideoIds: favoritesPage.ids,
    watchedVideoIds: watchedPage.ids,
    cursors: {
      savedQuestions: savedPage.cursor,
      videoFavorites: favoritesPage.cursor,
      videoWatchHistory: watchedPage.cursor
    } satisfies PersonalKnowledgeCursors,
    hasMore: { savedQuestions: savedPage.hasMore, videoFavorites: favoritesPage.hasMore, videoWatchHistory: watchedPage.hasMore },
    errors: [saved, favorites, watched].flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  };
}

export function createQuestion(input: { questionId?: string; teamId?: string; visibility?: 'team' | 'community'; title: string; body: string; category: string; tags?: string[]; attachmentFileIds?: string[]; operationId: string }) {
  return call<typeof input, { questionId: string }>('createQuestion', input);
}

export function searchQuestions(input: { query: string; teamId?: string; category?: string; tag?: string; status?: Question['status']; pageSize?: number; before?: string | null }) {
  return call<typeof input, QuestionSearchResult>('searchQuestions', input);
}

/**
 * Default browse listing. Search is the only other way into Questions, so without
 * this a team that has never searched sees an empty module.
 */
export async function listTeamQuestions(firestore: Firestore, teamId: string, cursor: KnowledgeCursor | null = null) {
  const constraints: QueryConstraint[] = [where('teamId', '==', teamId), where('visibility', '==', 'team'), where('moderationStatus', '==', 'published'), orderBy('createdAt', 'desc')];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(KNOWLEDGE_PAGE_SIZE + 1));
  const snapshot = await getDocs(query(collection(firestore, 'questions'), ...constraints));
  const hasMore = snapshot.docs.length > KNOWLEDGE_PAGE_SIZE;
  const docs = snapshot.docs.slice(0, KNOWLEDGE_PAGE_SIZE);
  return { questions: docs.map((entry) => parseQuestion(entry.id, entry.data() as Record<string, unknown>)), cursor: docs.at(-1) ?? null, hasMore };
}

/**
 * Saved questions are stored as bare ids. Resolving them to titles is a bounded
 * `documentId() in` lookup; a chunk that the rules deny (a question removed, or in
 * a team the member has left) is dropped rather than failing the whole panel.
 */
export async function listQuestionsByIds(firestore: Firestore, questionIds: string[]) {
  const unique = [...new Set(questionIds.filter(Boolean))];
  const resolved = new Map<string, Question>();
  if (unique.length === 0) return resolved;
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += DOCUMENT_ID_CHUNK) chunks.push(unique.slice(index, index + DOCUMENT_ID_CHUNK));
  const snapshots = await Promise.allSettled(chunks.map((chunk) => getDocs(query(
    collection(firestore, 'questions'),
    where(documentId(), 'in', chunk),
    limit(chunk.length)
  ))));
  for (const snapshot of snapshots) {
    if (snapshot.status !== 'fulfilled') continue;
    for (const entry of snapshot.value.docs) resolved.set(entry.id, parseQuestion(entry.id, entry.data() as Record<string, unknown>));
  }
  return resolved;
}

export async function getQuestionTarget(firestore: Firestore, questionId: string) {
  const snapshot = await getDoc(doc(firestore, 'questions', questionId));
  if (!snapshot.exists()) throw new AppError('not-found', 'The linked question was not found or is no longer available.');
  return parseQuestion(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export type ThreadQuestion = Pick<Question, 'id' | 'teamId' | 'visibility'>;

/**
 * Firestore rules are not filters: a list query is refused unless its own
 * constraints prove every result readable. Answer and comment reads are gated
 * on the parent question's `teamId`/`visibility` (`canReadQuestion`), so the
 * thread query has to pin those two fields, not just `questionId`.
 */
function threadConstraints(question: ThreadQuestion): QueryConstraint[] {
  const scope = question.visibility === 'team' && question.teamId
    ? [where('teamId', '==', question.teamId), where('visibility', '==', 'team')]
    : [where('teamId', '==', null), where('visibility', '==', 'community')];
  return [where('questionId', '==', question.id), ...scope, where('moderationStatus', '==', 'published'), orderBy('createdAt', 'asc')];
}

export async function listQuestionAnswers(firestore: Firestore, question: ThreadQuestion, cursor: KnowledgeCursor | null = null) {
  const constraints = threadConstraints(question);
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(KNOWLEDGE_PAGE_SIZE + 1));
  const snapshot = await getDocs(query(collection(firestore, 'answers'), ...constraints));
  const hasMore = snapshot.docs.length > KNOWLEDGE_PAGE_SIZE;
  const docs = snapshot.docs.slice(0, KNOWLEDGE_PAGE_SIZE);
  return { answers: docs.map((entry) => parseAnswer(entry.id, entry.data() as Record<string, unknown>)), cursor: docs.at(-1) ?? null, hasMore };
}

export async function listQuestionComments(firestore: Firestore, question: ThreadQuestion, cursor: KnowledgeCursor | null = null) {
  const constraints = threadConstraints(question);
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(KNOWLEDGE_PAGE_SIZE + 1));
  const snapshot = await getDocs(query(collection(firestore, 'questionComments'), ...constraints));
  const hasMore = snapshot.docs.length > KNOWLEDGE_PAGE_SIZE;
  const docs = snapshot.docs.slice(0, KNOWLEDGE_PAGE_SIZE);
  return { comments: docs.map((entry) => parseQuestionComment(entry.id, entry.data() as Record<string, unknown>)), cursor: docs.at(-1) ?? null, hasMore };
}

export function createAnswer(input: { questionId: string; body: string; answerId?: string; operationId: string }) {
  return call<typeof input, { answerId: string }>('createAnswer', input);
}

export function createQuestionComment(input: { questionId: string; body: string; operationId: string }) {
  return call<typeof input, { commentId: string }>('createQuestionComment', input);
}

export function voteQuestion(questionId: string) {
  return call<{ questionId: string }, { questionId: string; voted: boolean }>('voteQuestion', { questionId });
}

export function acceptAnswer(input: { questionId: string; answerId: string }) {
  return call<typeof input, { questionId: string; answerId: string; accepted: true }>('acceptAnswer', input);
}

export function toggleSavedQuestion(questionId: string) {
  return call<{ questionId: string }, { questionId: string; saved: boolean }>('toggleSavedQuestion', { questionId });
}

export function createVideo(input: { videoId?: string; teamId?: string; visibility?: 'team' | 'community'; category: VideoCategory; title: string; description: string; externalUrl?: string; storagePath?: string; sourceAttribution?: string; captionTracks?: Array<{ language: string; url: string; kind?: 'captions' | 'transcript' }>; relatedVideoIds?: string[]; operationId: string }) {
  return call<typeof input, { videoId: string }>('createVideo', input);
}

export function searchVideos(input: { query: string; teamId?: string; category?: VideoCategory; pageSize?: number; before?: string | null }) {
  return call<typeof input, VideoSearchResult>('searchVideos', input);
}

export async function getVideoTarget(firestore: Firestore, videoId: string) {
  const snapshot = await getDoc(doc(firestore, 'videos', videoId));
  if (!snapshot.exists()) throw new AppError('not-found', 'The linked video was not found or is no longer available.');
  return parseVideo(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export function toggleVideoFavorite(videoId: string) {
  return call<{ videoId: string }, { videoId: string; favorite: boolean }>('toggleVideoFavorite', { videoId });
}

export function recordVideoWatch(videoId: string, progressSeconds = 0) {
  return call<{ videoId: string; progressSeconds: number }, { videoId: string; recorded: true }>('recordVideoWatch', { videoId, progressSeconds });
}

export function updateVideoPublication(videoId: string, publicationStatus: Video['publicationStatus']) {
  return call<{ videoId: string; publicationStatus: Video['publicationStatus'] }, { videoId: string; publicationStatus: Video['publicationStatus'] }>('updateVideoPublication', { videoId, publicationStatus });
}

export function createPoll(input: { pollId?: string; teamId: string; visibility?: 'team'; question: string; options: string[]; selection?: 'single' | 'multiple'; anonymous?: boolean; audienceRoles?: string[]; resultsVisibility?: Poll['resultsVisibility']; expiresAt?: string; operationId: string }) {
  return call<typeof input, { pollId: string }>('createPoll', input);
}

export function listPolls(teamId: string) {
  return call<{ teamId: string }, { polls: PollListItem[] }>('listPolls', { teamId });
}

export function closePoll(pollId: string) {
  return call<{ pollId: string }, { pollId: string; status: 'closed' }>('closePoll', { pollId });
}

export function votePoll(input: { pollId: string; selectedOptionIds: string[] }) {
  return call<typeof input, { pollId: string; voted: true; resultsVisible: boolean }>('votePoll', input);
}

export function getPollResults(pollId: string) {
  return call<{ pollId: string }, { pollId: string; totalVotes: number; optionVoteCounts: Record<string, number>; anonymous: boolean }>('getPollResults', { pollId });
}
