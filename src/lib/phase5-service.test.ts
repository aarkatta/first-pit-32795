import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  doc: vi.fn((_db: unknown, name: string, id: string) => ({ name, id })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ value })),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  startAfter: vi.fn((cursor: unknown) => ({ cursor })),
  where: vi.fn((...parts: unknown[]) => ({ parts })),
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(() => ({ functions: 'functions' }))
}));

vi.mock('firebase/firestore', () => ({ collection: mocks.collection, doc: mocks.doc, documentId: mocks.documentId, getDoc: mocks.getDoc, getDocs: mocks.getDocs, limit: mocks.limit, orderBy: mocks.orderBy, query: mocks.query, startAfter: mocks.startAfter, where: mocks.where }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import {
  acceptAnswer,
  closePoll,
  createAnswer,
  createPoll,
  createQuestion,
  createQuestionComment,
  createVideo,
  getPollResults,
  getQuestionTarget,
  getVideoTarget,
  isKnowledgeTargetInContext,
  listPolls,
  listQuestionAnswers,
  listQuestionComments,
  listQuestionsByIds,
  listTeamQuestions,
  loadPersonalKnowledgeRecords,
  parseVideo,
  recordVideoWatch,
  searchQuestions,
  searchVideos,
  toggleSavedQuestion,
  toggleVideoFavorite,
  updateVideoPublication,
  votePoll,
  voteQuestion
} from './phase5-service';

describe('Phase 5 client service contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockImplementation((_functions, name) => async (input: unknown) => ({ data: { name, input } }));
  });

  it('keeps successful personal libraries when another read fails', async () => {
    mocks.getDocs
      .mockRejectedValueOnce(new Error('saved questions denied'))
      .mockResolvedValueOnce({ docs: [{ data: () => ({ videoId: 'video-1' }) }] })
      .mockResolvedValueOnce({ docs: [{ data: () => ({ videoId: 'video-2' }) }] });
    const result = await loadPersonalKnowledgeRecords('firestore' as never, 'user-1');
    expect(result.savedQuestionIds).toBeUndefined();
    expect(result.favoriteVideoIds).toEqual(['video-1']);
    expect(result.watchedVideoIds).toEqual(['video-2']);
    expect(result.hasMore).toEqual({ savedQuestions: false, videoFavorites: false, videoWatchHistory: false });
    expect(result.errors).toEqual([expect.objectContaining({ message: 'saved questions denied' })]);
    // Watch history is stamped with lastWatchedAt, not createdAt.
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.orderBy).toHaveBeenCalledWith('lastWatchedAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(51);
  });

  it('maps all personal library identifiers when reads succeed', async () => {
    mocks.getDocs
      .mockResolvedValueOnce({ docs: [{ data: () => ({ questionId: 'question-1' }) }] })
      .mockResolvedValueOnce({ docs: [{ data: () => ({ videoId: 'favorite-1' }) }] })
      .mockResolvedValueOnce({ docs: [{ data: () => ({ videoId: 'watched-1' }) }] });
    await expect(loadPersonalKnowledgeRecords('firestore' as never, 'user-1')).resolves.toEqual(expect.objectContaining({
      savedQuestionIds: ['question-1'],
      favoriteVideoIds: ['favorite-1'],
      watchedVideoIds: ['watched-1'],
      errors: []
    }));
  });

  it('validates question and video target existence', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getQuestionTarget('db' as never, 'missing')).rejects.toThrow(/question was not found/i);
    // A document missing tags/attachmentFileIds must still parse instead of
    // crashing the detail view on `.join`.
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, id: 'question-1', data: () => ({ title: 'Question' }) });
    await expect(getQuestionTarget('db' as never, 'question-1')).resolves.toEqual(expect.objectContaining({ id: 'question-1', title: 'Question', tags: [], attachmentFileIds: [], answerCount: 0, status: 'open', createdAt: null }));

    mocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getVideoTarget('db' as never, 'missing')).rejects.toThrow(/video was not found/i);
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, id: 'video-1', data: () => ({ title: 'Video' }) });
    await expect(getVideoTarget('db' as never, 'video-1')).resolves.toEqual(expect.objectContaining({ id: 'video-1', title: 'Video', captionTracks: [], relatedVideoIds: [], publicationStatus: 'draft' }));
  });

  it('pages team questions, answers, and comments with cursors', async () => {
    const questionDocs = Array.from({ length: 26 }, (_, index) => ({ id: `question-${index}`, data: () => ({ teamId: 'team-1', visibility: 'team', title: `Question ${index}` }) }));
    mocks.getDocs.mockResolvedValueOnce({ docs: questionDocs });
    const page = await listTeamQuestions('db' as never, 'team-1');
    expect(page.questions).toHaveLength(25);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe(questionDocs[24]);
    // A removed document in the result set would fail the whole list under the rules.
    expect(mocks.where).toHaveBeenCalledWith('moderationStatus', '==', 'published');
    expect(mocks.limit).toHaveBeenCalledWith(26);

    mocks.getDocs.mockResolvedValueOnce({ docs: [{ id: 'answer-1', data: () => ({ questionId: 'question-1', body: 'Answer', accepted: true }) }] });
    await expect(listQuestionAnswers('db' as never, 'question-1')).resolves.toEqual(expect.objectContaining({
      hasMore: false,
      answers: [expect.objectContaining({ id: 'answer-1', accepted: true })]
    }));

    mocks.getDocs.mockResolvedValueOnce({ docs: [{ id: 'comment-1', data: () => ({ questionId: 'question-1', body: 'Comment' }) }] });
    await expect(listQuestionComments('db' as never, 'question-1', questionDocs[24] as never)).resolves.toEqual(expect.objectContaining({
      comments: [expect.objectContaining({ id: 'comment-1', body: 'Comment' })]
    }));
    expect(mocks.startAfter).toHaveBeenCalledWith(questionDocs[24]);
  });

  it('resolves saved question titles and drops a denied chunk', async () => {
    await expect(listQuestionsByIds('db' as never, [])).resolves.toEqual(new Map());
    expect(mocks.getDocs).not.toHaveBeenCalled();

    mocks.getDocs
      .mockResolvedValueOnce({ docs: [{ id: 'question-1', data: () => ({ title: 'Sensors' }) }] })
      .mockRejectedValueOnce(new Error('permission denied'));
    const resolved = await listQuestionsByIds('db' as never, Array.from({ length: 31 }, (_, index) => `question-${index}`));
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(resolved.get('question-1')?.title).toBe('Sensors');
  });

  it('parses a video document that is missing optional fields', () => {
    expect(parseVideo('video-1', { captionTracks: [{ language: 'es', url: 'https://example.com/es.vtt', kind: 'transcript' }], publicationStatus: 'bogus' })).toEqual(expect.objectContaining({
      captionTracks: [{ language: 'es', url: 'https://example.com/es.vtt', kind: 'transcript' }],
      publicationStatus: 'draft',
      relatedVideoIds: [],
      externalUrl: null,
      teamId: null
    }));
  });

  it('keeps direct Knowledge targets inside the active team while allowing community records', () => {
    expect(isKnowledgeTargetInContext({ teamId: 'team-1', visibility: 'team' }, 'team-1')).toBe(true);
    expect(isKnowledgeTargetInContext({ teamId: 'team-2', visibility: 'team' }, 'team-1')).toBe(false);
    expect(isKnowledgeTargetInContext({ teamId: 'team-2', visibility: 'team' }, null)).toBe(false);
    expect(isKnowledgeTargetInContext({ teamId: null, visibility: 'community' }, 'team-1')).toBe(true);
    expect(isKnowledgeTargetInContext({ teamId: null, visibility: 'community' }, null)).toBe(true);
  });

  it('preserves every callable name, payload, defaults, and returned data', async () => {
    // operationId is the server-side idempotency key: a double-clicked submit must
    // send the same value so the receipt replays instead of posting twice.
    const question = { questionId: 'question-1', teamId: 'team-1', visibility: 'team' as const, title: 'Sensors', body: 'How?', category: 'Robot', tags: ['sensor'], operationId: 'question-1' };
    const video = { videoId: 'video-1', teamId: 'team-1', visibility: 'team' as const, category: 'CAD' as const, title: 'CAD', description: 'Guide', externalUrl: 'https://example.com/video', operationId: 'video-1' };
    const poll = { pollId: 'poll-1', teamId: 'team-1', question: 'When?', options: ['A', 'B'], resultsVisibility: 'afterClose' as const, operationId: 'poll-1' };
    const cases: Array<[string, () => Promise<unknown>, unknown]> = [
      ['createQuestion', () => createQuestion(question), question],
      ['searchQuestions', () => searchQuestions({ query: 'sensor', teamId: 'team-1', category: 'Robot', tag: 'sensor', status: 'open', pageSize: 10, before: 'cursor' }), { query: 'sensor', teamId: 'team-1', category: 'Robot', tag: 'sensor', status: 'open', pageSize: 10, before: 'cursor' }],
      ['createAnswer', () => createAnswer({ questionId: 'question-1', body: 'Answer', answerId: 'answer-1', operationId: 'answer-1' }), { questionId: 'question-1', body: 'Answer', answerId: 'answer-1', operationId: 'answer-1' }],
      ['createQuestionComment', () => createQuestionComment({ questionId: 'question-1', body: 'Comment', operationId: 'comment-1' }), { questionId: 'question-1', body: 'Comment', operationId: 'comment-1' }],
      ['voteQuestion', () => voteQuestion('question-1'), { questionId: 'question-1' }],
      ['acceptAnswer', () => acceptAnswer({ questionId: 'question-1', answerId: 'answer-1' }), { questionId: 'question-1', answerId: 'answer-1' }],
      ['toggleSavedQuestion', () => toggleSavedQuestion('question-1'), { questionId: 'question-1' }],
      ['createVideo', () => createVideo(video), video],
      ['searchVideos', () => searchVideos({ query: 'cad', teamId: 'team-1', category: 'CAD', pageSize: 5, before: null }), { query: 'cad', teamId: 'team-1', category: 'CAD', pageSize: 5, before: null }],
      ['toggleVideoFavorite', () => toggleVideoFavorite('video-1'), { videoId: 'video-1' }],
      ['recordVideoWatch', () => recordVideoWatch('video-1'), { videoId: 'video-1', progressSeconds: 0 }],
      ['updateVideoPublication', () => updateVideoPublication('video-1', 'published'), { videoId: 'video-1', publicationStatus: 'published' }],
      ['createPoll', () => createPoll(poll), poll],
      ['listPolls', () => listPolls('team-1'), { teamId: 'team-1' }],
      ['closePoll', () => closePoll('poll-1'), { pollId: 'poll-1' }],
      ['votePoll', () => votePoll({ pollId: 'poll-1', selectedOptionIds: ['option-1'] }), { pollId: 'poll-1', selectedOptionIds: ['option-1'] }],
      ['getPollResults', () => getPollResults('poll-1'), { pollId: 'poll-1' }]
    ];

    for (const [name, invoke, input] of cases) {
      await expect(invoke()).resolves.toEqual({ name, input });
      expect(mocks.httpsCallable).toHaveBeenLastCalledWith('functions', name);
    }

    await expect(recordVideoWatch('video-1', 42)).resolves.toEqual({ name: 'recordVideoWatch', input: { videoId: 'video-1', progressSeconds: 42 } });
  });

  it('propagates callable rejection without an implicit retry', async () => {
    const failure = new Error('unavailable');
    mocks.httpsCallable.mockReturnValueOnce(vi.fn().mockRejectedValue(failure));
    await expect(listPolls('team-1')).rejects.toBe(failure);
    expect(mocks.httpsCallable).toHaveBeenCalledOnce();
  });
});
