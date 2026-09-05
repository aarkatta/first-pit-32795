import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  doc: vi.fn((_db: unknown, name: string, id: string) => ({ name, id })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  endBefore: vi.fn((cursor: unknown) => ({ kind: 'endBefore', cursor })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  limitToLast: vi.fn((value: number) => ({ kind: 'limitToLast', value })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field: string, direction: string) => ({ kind: 'orderBy', field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  startAfter: vi.fn((cursor: unknown) => ({ kind: 'startAfter', cursor })),
  where: vi.fn((...parts: unknown[]) => ({ kind: 'where', parts })),
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(() => ({ functions: 'functions' }))
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  documentId: mocks.documentId,
  endBefore: mocks.endBefore,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  limit: mocks.limit,
  limitToLast: mocks.limitToLast,
  onSnapshot: mocks.onSnapshot,
  orderBy: mocks.orderBy,
  query: mocks.query,
  startAfter: mocks.startAfter,
  where: mocks.where
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import {
  acknowledgeAnnouncement,
  archiveChannel,
  buildAnnouncementQuery,
  buildChannelQueries,
  buildMessageQuery,
  buildOlderMessageQuery,
  createAnnouncement,
  createChannel,
  deleteMessage,
  exportTeamMessages,
  getChannelMute,
  getMessageTarget,
  loadAcknowledgedAnnouncementIds,
  loadAnnouncementPage,
  loadChannelPage,
  loadOlderMessages,
  markChannelRead,
  parseChatMessage,
  searchTeamMessages,
  sendMessage,
  subscribeToLatestMessages,
  toggleChannelMute,
  toggleReaction
} from './phase4-service';

function messageDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      teamId: 'team-1',
      channelId: 'channel-1',
      visibility: 'team',
      authorUserId: 'user-1',
      body: id,
      createdAt: id,
      ...overrides
    })
  };
}

describe('Phase 4 client service contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockImplementation((_functions, name) => async (input: unknown) => ({ data: { name, input } }));
  });

  it('builds bounded role-aware channel and message queries', () => {
    // canReadChannel in firestore.rules gates coaches channels on role, and direct
    // channels on role AND the team policy. Asking for either without qualifying is
    // denied, and one denied query rejects the whole channel load.
    expect(buildChannelQueries('db' as never, 'team-1', 'student', 'user-1')).toHaveLength(1);
    expect(buildChannelQueries('db' as never, 'team-1', 'student', 'user-1', true)).toHaveLength(1);
    expect(buildChannelQueries('db' as never, 'team-1', 'coach', 'user-1')).toHaveLength(2);
    expect(buildChannelQueries('db' as never, 'team-1', 'teamLeader', 'user-1')).toHaveLength(2);
    expect(buildChannelQueries('db' as never, 'team-1', 'coach', 'user-1', true)).toHaveLength(3);
    expect(mocks.where).toHaveBeenCalledWith('visibility', '==', 'coaches');
    expect(mocks.where).toHaveBeenCalledWith('visibility', '==', 'direct');

    const cursor = messageDoc('oldest');
    buildMessageQuery('db' as never, 'team-1', 'channel-1', 'direct', 'user-1');
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(mocks.limitToLast).toHaveBeenCalledWith(51);
    expect(mocks.where).toHaveBeenCalledWith('participantUserIds', 'array-contains', 'user-1');

    buildOlderMessageQuery('db' as never, 'team-1', 'channel-1', 'team', 'user-1', cursor as never);
    expect(mocks.endBefore).toHaveBeenCalledWith(cursor);
    buildAnnouncementQuery('db' as never, 'team-1', 'channel-1');
    expect(mocks.limit).toHaveBeenCalledWith(26);
  });

  it('parses defaults and normalizes message arrays and reaction members', () => {
    expect(parseChatMessage('message-1', {
      parentMessageId: 42,
      mentionUserIds: [1, 'user-2'],
      attachmentFileIds: [3],
      reactions: { like: [1, 'user-2'], invalid: 'user-3' }
    })).toEqual(expect.objectContaining({
      id: 'message-1',
      teamId: '',
      parentMessageId: '42',
      mentionUserIds: ['1', 'user-2'],
      attachmentFileIds: ['3'],
      reactions: { like: ['1', 'user-2'], invalid: [] },
      replyCount: 0,
      deletedAt: null
    }));
  });

  it('delivers newest and older pages, errors, and cleanup exactly once', async () => {
    const unsubscribe = vi.fn();
    const onError = vi.fn();
    mocks.onSnapshot.mockImplementation((_query, next, error) => {
      next({ docs: [messageDoc('message-1'), messageDoc('message-2')] });
      error(new Error('listener failed'));
      return unsubscribe;
    });
    const onNext = vi.fn();
    const cleanup = subscribeToLatestMessages('db' as never, 'team-1', 'channel-1', 'team', 'user-1', onNext, onError);
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ id: 'message-1' }), expect.objectContaining({ id: 'message-2' })],
      hasOlder: false
    }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener failed' }));
    expect(cleanup).toBe(unsubscribe);

    // A page is only "full" when the surplus 51st document comes back; exactly
    // PAGE_SIZE documents means the caller has reached the oldest message.
    const fifty = Array.from({ length: 50 }, (_, index) => messageDoc(`message-${index}`));
    mocks.getDocs.mockResolvedValueOnce({ docs: fifty });
    await expect(loadOlderMessages('db' as never, 'team-1', 'channel-1', 'team', 'user-1', fifty[0] as never)).resolves.toEqual(expect.objectContaining({
      cursor: fifty[0],
      hasOlder: false
    }));

    const fiftyOne = Array.from({ length: 51 }, (_, index) => messageDoc(`message-${index}`));
    mocks.getDocs.mockResolvedValueOnce({ docs: fiftyOne });
    await expect(loadOlderMessages('db' as never, 'team-1', 'channel-1', 'team', 'user-1', fiftyOne[0] as never)).resolves.toEqual(expect.objectContaining({
      cursor: fiftyOne[1],
      hasOlder: true
    }));
  });

  it('pages channels and announcements with a truthful hasMore', async () => {
    const channelDocs = Array.from({ length: 51 }, (_, index) => ({ id: `channel-${index}`, data: () => ({ teamId: 'team-1', name: `Channel ${index}`, visibility: 'team' }) }));
    mocks.getDocs.mockResolvedValueOnce({ docs: channelDocs });
    const page = await loadChannelPage('db' as never, 'team-1', 'student', 'user-1');
    expect(page.channels).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.cursors.team).toBe(channelDocs[49]);

    mocks.getDocs.mockResolvedValueOnce({ docs: channelDocs.slice(0, 3) });
    const tail = await loadChannelPage('db' as never, 'team-1', 'student', 'user-1', false, page.cursors);
    expect(tail.channels).toHaveLength(3);
    expect(tail.hasMore).toBe(false);
    expect(mocks.startAfter).toHaveBeenCalledWith(channelDocs[49]);

    const announcementDocs = Array.from({ length: 26 }, (_, index) => ({ id: `announcement-${index}`, data: () => ({ teamId: 'team-1', channelId: 'channel-1', title: `Announcement ${index}` }) }));
    mocks.getDocs.mockResolvedValueOnce({ docs: announcementDocs });
    const announcements = await loadAnnouncementPage('db' as never, 'team-1', 'channel-1');
    expect(announcements.announcements).toHaveLength(25);
    expect(announcements.hasMore).toBe(true);
    expect(announcements.cursor).toBe(announcementDocs[24]);
  });

  it('reads acknowledgements only for the announcements on screen', async () => {
    await expect(loadAcknowledgedAnnouncementIds('db' as never, 'user-1', [])).resolves.toEqual(new Set());
    expect(mocks.getDocs).not.toHaveBeenCalled();

    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ announcementId: 'announcement-0' }) }] });
    const result = await loadAcknowledgedAnnouncementIds('db' as never, 'user-1', Array.from({ length: 31 }, (_, index) => `announcement-${index}`));
    // 31 ids exceed the 30-value `in` cap, so the lookup is chunked.
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(mocks.where).toHaveBeenCalledWith({ kind: 'documentId' }, 'in', expect.arrayContaining(['announcement-0_user-1']));
    expect(result.has('announcement-0')).toBe(true);
  });

  it('validates linked-message scope and loads mute state', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getMessageTarget('db' as never, 'team-1', 'channel-1', 'missing')).rejects.toThrow(/not found/i);

    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, id: 'wrong', data: () => ({ teamId: 'team-2', channelId: 'channel-1' }) });
    await expect(getMessageTarget('db' as never, 'team-1', 'channel-1', 'wrong')).rejects.toThrow(/does not belong/i);

    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, ...messageDoc('message-1') });
    await expect(getMessageTarget('db' as never, 'team-1', 'channel-1', 'message-1')).resolves.toEqual(expect.objectContaining({ id: 'message-1' }));

    mocks.getDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ muted: true }) }] }).mockResolvedValueOnce({ docs: [] });
    await expect(getChannelMute('db' as never, 'team-1', 'user-1', 'channel-1')).resolves.toBe(true);
    await expect(getChannelMute('db' as never, 'team-1', 'user-1', 'channel-2')).resolves.toBe(false);
    expect(mocks.limit).toHaveBeenCalledWith(1);
  });

  it('preserves every callable name, complete payload, and returned data', async () => {
    const cases: Array<[string, () => Promise<unknown>, unknown]> = [
      ['createChannel', () => createChannel({ teamId: 'team-1', channelId: 'channel-1', name: 'General', visibility: 'team', operationId: 'op-1' }), { teamId: 'team-1', channelId: 'channel-1', name: 'General', visibility: 'team', operationId: 'op-1' }],
      ['archiveChannel', () => archiveChannel('team-1', 'channel-1'), { teamId: 'team-1', channelId: 'channel-1' }],
      ['sendMessage', () => sendMessage({ teamId: 'team-1', channelId: 'channel-1', body: 'Hello', operationId: 'op-1' }), { teamId: 'team-1', channelId: 'channel-1', body: 'Hello', operationId: 'op-1' }],
      ['toggleReaction', () => toggleReaction('team-1', 'message-1', 'like'), { teamId: 'team-1', messageId: 'message-1', reaction: 'like' }],
      ['markChannelRead', () => markChannelRead('team-1', 'channel-1'), { teamId: 'team-1', channelId: 'channel-1' }],
      ['toggleChannelMute', () => toggleChannelMute('team-1', 'channel-1', true), { teamId: 'team-1', channelId: 'channel-1', muted: true }],
      ['deleteMessage', () => deleteMessage('team-1', 'message-1'), { teamId: 'team-1', messageId: 'message-1' }],
      ['exportTeamMessages', () => exportTeamMessages('team-1', 'channel-1'), { teamId: 'team-1', channelId: 'channel-1' }],
      ['createAnnouncement', () => createAnnouncement({ teamId: 'team-1', channelId: 'channel-1', announcementId: 'announcement-1', title: 'Practice', body: 'Saturday', operationId: 'op-2' }), { teamId: 'team-1', channelId: 'channel-1', announcementId: 'announcement-1', title: 'Practice', body: 'Saturday', operationId: 'op-2' }],
      ['acknowledgeAnnouncement', () => acknowledgeAnnouncement('team-1', 'announcement-1'), { teamId: 'team-1', announcementId: 'announcement-1' }],
      ['searchMessages', () => searchTeamMessages({ teamId: 'team-1', query: 'practice', pageSize: 10, before: 'cursor' }), { teamId: 'team-1', query: 'practice', pageSize: 10, before: 'cursor' }]
    ];

    for (const [name, invoke, input] of cases) {
      await expect(invoke()).resolves.toEqual({ name, input });
      expect(mocks.httpsCallable).toHaveBeenLastCalledWith('functions', name);
    }

    await expect(exportTeamMessages('team-1')).resolves.toEqual({ name: 'exportTeamMessages', input: { teamId: 'team-1' } });
  });

  it('propagates callable rejection without retrying or rewriting it', async () => {
    const failure = new Error('permission denied');
    mocks.httpsCallable.mockReturnValueOnce(vi.fn().mockRejectedValue(failure));
    await expect(archiveChannel('team-1', 'channel-1')).rejects.toBe(failure);
    expect(mocks.httpsCallable).toHaveBeenCalledOnce();
  });
});
