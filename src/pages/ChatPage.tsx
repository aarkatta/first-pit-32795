import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { useSearchParams } from 'react-router-dom';
import { GoogleChatPanel } from '@/features/google/GoogleChatPanel';
import { useAuth } from '@/lib/auth-context';
import { createReport } from '@/lib/phase2-service';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { isCoachOrLeader } from '@/lib/domain';
import { initialsOf, listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import { useTeamContext } from '@/lib/team-context';
import { useOnlineStatus } from '@/lib/use-online-status';
import {
  acknowledgeAnnouncement,
  archiveChannel,
  type ChannelCursors,
  type ChatChannel,
  type ChatMessage,
  createAnnouncement,
  createChannel,
  deleteMessage,
  exportTeamMessages,
  getChannelMute,
  getMessageTarget,
  type ListCursor,
  loadAcknowledgedAnnouncementIds,
  loadAnnouncementPage,
  loadChannelPage,
  loadOlderMessages,
  markChannelRead,
  purgeExpiredMessages,
  type MessageCursor,
  type SearchResult,
  searchTeamMessages,
  sendMessage,
  subscribeToLatestMessages,
  type TeamAnnouncement,
  toggleChannelMute,
  toggleReaction
} from '@/lib/phase4-service';
import { toDate } from '@/lib/dates';
import { createOperationId } from '@/lib/ids';

/**
 * A retried submit has to reuse the identifier it sent the first time, otherwise
 * the server records a second receipt and the message posts twice. The retained id
 * is both the resource id and the idempotency key for that one operation.
 */
function retainedOperation(ref: { current: { fingerprint: string; id: string } | null }, fingerprint: string, prefix: string) {
  if (ref.current?.fingerprint === fingerprint) return ref.current.id;
  const id = createOperationId(prefix);
  ref.current = { fingerprint, id };
  return id;
}

function formatDate(value: unknown) {
  const date = toDate(value);
  return date ? date.toLocaleString() : 'Just now';
}

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  // Error handlers read the online flag through a ref so connectivity flips do
  // not tear down the message listener and refetch data the client already had.
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const userId = user?.uid ?? '';
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelCursors, setChannelCursors] = useState<ChannelCursors>({});
  const [hasMoreChannels, setHasMoreChannels] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [latestMessages, setLatestMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<MessageCursor | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [announcementCursor, setAnnouncementCursor] = useState<ListCursor | null>(null);
  const [hasMoreAnnouncements, setHasMoreAnnouncements] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Map<string, TeamMember>>(new Map());
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [muted, setMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const channelsRequest = useRef(0);
  const messagesRequest = useRef(0);
  const targetRequest = useRef(0);
  const readBoundary = useRef('');
  const pageContextRef = useRef('');
  const channelContextRef = useRef('');
  const messageOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const channelOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const announcementOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const reportOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const deepLinkChannelId = searchParams.get('channel');
  const deepLinkMessageId = searchParams.get('message');

  const currentChannels = useMemo(() => channels.filter((channel) => channel.teamId === teamId), [channels, teamId]);
  const activeChannel = useMemo(() => currentChannels.find((channel) => channel.id === channelId) ?? currentChannels[0] ?? null, [channelId, currentChannels]);
  // The subscription and the per-channel loads key off these primitives, not off
  // the channel object: reloading the channel list rebuilds every ChatChannel, and
  // an object-identity dependency would resubscribe and discard loaded history.
  const activeChannelId = activeChannel?.id ?? null;
  const activeChannelVisibility = activeChannel?.visibility ?? null;
  const pageContextKey = `${userId}:${teamId ?? ''}`;
  const channelContextKey = `${pageContextKey}:${activeChannelId ?? ''}`;
  pageContextRef.current = pageContextKey;
  channelContextRef.current = channelContextKey;
  const messages = useMemo(() => {
    const byId = new Map([...olderMessages, ...latestMessages].map((message) => [message.id, message]));
    return [...byId.values()].sort((left, right) => {
      const millis = (value: unknown) => value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function' ? (value as { toMillis: () => number }).toMillis() : new Date(String(value ?? '')).getTime();
      return millis(left.createdAt) - millis(right.createdAt);
    });
  }, [latestMessages, olderMessages]);
  const canManage = isCoachOrLeader(activeTeam);

  const loadChannels = useCallback(async (cursors: ChannelCursors | null = null) => {
    const contextKey = `${user?.uid ?? ''}:${teamId ?? ''}`;
    if (pageContextRef.current !== contextKey) return;
    if (!teamId) {
      channelsRequest.current += 1;
      setLoading(false);
      return;
    }
    if (!cursors) setLoading(true);
    setError(null);
    const requestId = ++channelsRequest.current;
    try {
      // Direct channels are readable only while the team policy enables them, so the
      // policy has to be known before the channel queries are built.
      const policy = await getDoc(doc(firestore, 'teamPolicies', teamId));
      if (requestId !== channelsRequest.current || pageContextRef.current !== contextKey) return;
      const directMessagingEnabled = policy.data()?.directMessaging === 'coachesOnly';
      const page = await loadChannelPage(firestore, teamId, activeTeam?.role, user?.uid ?? '', directMessagingEnabled, cursors ?? {});
      if (requestId !== channelsRequest.current || pageContextRef.current !== contextKey) return;
      setChannelCursors(page.cursors);
      setHasMoreChannels(page.hasMore);
      if (cursors) {
        setChannels((current) => [...current, ...page.channels.filter((channel) => !current.some((entry) => entry.id === channel.id))]);
        return;
      }
      setChannels(page.channels);
      setChannelId((current) => deepLinkChannelId && page.channels.some((channel) => channel.id === deepLinkChannelId) ? deepLinkChannelId : current && page.channels.some((channel) => channel.id === current) ? current : page.channels[0]?.id ?? null);
    } catch (nextError) {
      if (requestId !== channelsRequest.current || pageContextRef.current !== contextKey) return;
      setError(nextError instanceof Error ? nextError : new Error('Chat channels could not load.'));
    } finally {
      if (requestId === channelsRequest.current && pageContextRef.current === contextKey) setLoading(false);
    }
  }, [activeTeam?.role, deepLinkChannelId, firestore, teamId, user?.uid]);

  const loadChannel = useCallback(async () => {
    if (!teamId || !activeChannelId || !userId) {
      messagesRequest.current += 1;
      return;
    }
    const contextKey = `${userId}:${teamId}:${activeChannelId}`;
    if (channelContextRef.current !== contextKey) return;
    const requestId = ++messagesRequest.current;
    try {
      const [announcementPage, nextMuted] = await Promise.all([
        loadAnnouncementPage(firestore, teamId, activeChannelId),
        getChannelMute(firestore, teamId, userId, activeChannelId)
      ]);
      if (requestId !== messagesRequest.current || channelContextRef.current !== contextKey) return;
      // Acknowledgements are read for the announcements that are actually on screen.
      const acknowledgedIds = await loadAcknowledgedAnnouncementIds(firestore, userId, announcementPage.announcements.map((announcement) => announcement.id));
      if (requestId !== messagesRequest.current || channelContextRef.current !== contextKey) return;
      setAnnouncements(announcementPage.announcements);
      setAnnouncementCursor(announcementPage.cursor);
      setHasMoreAnnouncements(announcementPage.hasMore);
      setAcknowledged(acknowledgedIds);
      setMuted(nextMuted);
      setMuteLoading(false);
    } catch (nextError) {
      if (requestId !== messagesRequest.current || channelContextRef.current !== contextKey) return;
      setMuteLoading(false);
      setRequestState(getRequestState(nextError, onlineRef.current));
    }
  }, [activeChannelId, firestore, teamId, userId]);

  useEffect(() => {
    channelsRequest.current += 1;
    setChannels([]);
    setChannelCursors({});
    setHasMoreChannels(false);
    setChannelId(null);
    setNewChannelName('');
    setSearchTerm('');
    setSearchResults([]);
    setSearchCursor(null);
    setRequestState(null);
    setBusy(false);
    channelOperation.current = null;
    reportOperation.current = null;
    void loadChannels();
  }, [loadChannels, pageContextKey]);
  useEffect(() => {
    messagesRequest.current += 1;
    setAnnouncements([]);
    setAnnouncementCursor(null);
    setHasMoreAnnouncements(false);
    setAcknowledged(new Set());
    setMuted(false);
    setMuteLoading(Boolean(activeChannelId));
    setBody('');
    setReplyTo(null);
    setAnnouncementTitle('');
    setAnnouncementBody('');
    messageOperation.current = null;
    announcementOperation.current = null;
    void loadChannel();
  }, [activeChannelId, channelContextKey, loadChannel]);
  useEffect(() => {
    // `users/{uid}` is private, so the roster callable is the only way to turn an
    // author id into a name instead of rendering a raw Firebase UID.
    if (!teamId) {
      setMembers(new Map());
      setDirectoryLoaded(false);
      return undefined;
    }
    let cancelled = false;
    setDirectoryLoaded(false);
    void listTeamMembers(teamId).then((roster) => {
      if (cancelled) return;
      setMembers(memberMap(roster.members));
      setDirectoryLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setMembers(new Map());
      setDirectoryLoaded(false);
    });
    return () => {
      cancelled = true;
    };
  }, [teamId]);
  useEffect(() => {
    if (!teamId || !activeChannelId || !activeChannelVisibility || !userId) return undefined;
    setLatestMessages([]);
    setOlderMessages([]);
    setMessageCursor(null);
    setHasOlderMessages(false);
    setLoadingMessages(true);
    readBoundary.current = '';
    return subscribeToLatestMessages(firestore, teamId, activeChannelId, activeChannelVisibility, userId, (page) => {
      setLatestMessages(page.messages);
      setMessageCursor(page.cursor);
      setHasOlderMessages(page.hasOlder);
      setLoadingMessages(false);
      const newestRendered = page.messages.at(-1);
      const boundary = newestRendered ? `${activeChannelId}:${newestRendered.id}` : '';
      if (boundary && boundary !== readBoundary.current) {
        readBoundary.current = boundary;
        void markChannelRead(teamId, activeChannelId).catch((nextError: unknown) => setRequestState(getRequestState(nextError, onlineRef.current)));
      }
    }, (nextError) => {
      setLoadingMessages(false);
      setRequestState(getRequestState(nextError, onlineRef.current));
    });
  }, [activeChannelId, activeChannelVisibility, firestore, teamId, userId]);
  useEffect(() => {
    const requestId = ++targetRequest.current;
    if (!teamId || !activeChannelId || !deepLinkMessageId || activeChannelId !== deepLinkChannelId || messages.some((message) => message.id === deepLinkMessageId)) return;
    void getMessageTarget(firestore, teamId, activeChannelId, deepLinkMessageId).then((target) => {
      if (requestId !== targetRequest.current) return;
      setOlderMessages((current) => current.some((message) => message.id === target.id) ? current : [...current, target]);
    }).catch((nextError: unknown) => {
      if (requestId === targetRequest.current) setRequestState(getRequestState(nextError, onlineRef.current));
    });
  }, [activeChannelId, deepLinkChannelId, deepLinkMessageId, firestore, messages, teamId]);
  useEffect(() => {
    if (!deepLinkMessageId || !messages.some((message) => message.id === deepLinkMessageId)) return;
    const target = document.getElementById(`message-${deepLinkMessageId}`);
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
  }, [deepLinkMessageId, messages]);

  /**
   * `refresh` is deliberately opt-in. Reloading the channel list rebuilds every
   * ChatChannel object, and message-scoped work (sending, reacting, paging back)
   * is already delivered by the live subscription — refetching it here used to
   * blank the thread and throw away the page "Load older messages" had just added.
   */
  async function run(action: () => Promise<unknown>, refresh: 'none' | 'channels' | 'channel' = 'none') {
    const contextKey = pageContextKey;
    if (pageContextRef.current !== contextKey) return;
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      if (pageContextRef.current !== contextKey) return;
      if (refresh === 'channels') await loadChannels();
      if (refresh === 'channel') await loadChannel();
    }
    catch (nextError) { if (pageContextRef.current === contextKey) setRequestState(getRequestState(nextError, online)); }
    finally { if (pageContextRef.current === contextKey) setBusy(false); }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !activeChannel || !body.trim()) return;
    const contextKey = channelContextKey;
    const fingerprint = JSON.stringify([teamId, activeChannel.id, body.trim(), replyTo]);
    const operationId = retainedOperation(messageOperation, fingerprint, 'message');
    void run(async () => {
      await sendMessage({ teamId, channelId: activeChannel.id, body, parentMessageId: replyTo, operationId });
      if (channelContextRef.current === contextKey) {
        messageOperation.current = null;
        setBody('');
        setReplyTo(null);
      }
    });
  }

  function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !newChannelName.trim()) return;
    const contextKey = pageContextKey;
    const channelId = retainedOperation(channelOperation, JSON.stringify([teamId, newChannelName.trim()]), 'channel');
    void run(async () => { const result = await createChannel({ teamId, channelId, name: newChannelName, operationId: channelId }); if (pageContextRef.current === contextKey) { channelOperation.current = null; setNewChannelName(''); setChannelId(result.channelId); } }, 'channels');
  }

  function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !activeChannel || !announcementTitle.trim() || !announcementBody.trim()) return;
    const contextKey = channelContextKey;
    const fingerprint = JSON.stringify([teamId, activeChannel.id, announcementTitle.trim(), announcementBody.trim()]);
    const announcementId = retainedOperation(announcementOperation, fingerprint, 'announcement');
    void run(async () => { await createAnnouncement({ teamId, channelId: activeChannel.id, announcementId, title: announcementTitle, body: announcementBody, operationId: announcementId }); if (channelContextRef.current === contextKey) { announcementOperation.current = null; setAnnouncementTitle(''); setAnnouncementBody(''); } }, 'channel');
  }

  function loadMoreAnnouncements() {
    if (!teamId || !activeChannelId || !announcementCursor) return;
    void run(async () => {
      const page = await loadAnnouncementPage(firestore, teamId, activeChannelId, announcementCursor);
      const acknowledgedIds = await loadAcknowledgedAnnouncementIds(firestore, userId, page.announcements.map((announcement) => announcement.id));
      setAnnouncements((current) => [...current, ...page.announcements.filter((announcement) => !current.some((entry) => entry.id === announcement.id))]);
      setAnnouncementCursor(page.cursor);
      setHasMoreAnnouncements(page.hasMore);
      setAcknowledged((current) => new Set([...current, ...acknowledgedIds]));
    });
  }

  async function changeMute() {
    if (!teamId || !activeChannel || muteLoading) return;
    const contextKey = channelContextKey;
    const next = !muted;
    setBusy(true);
    setRequestState(null);
    try {
      const result = await toggleChannelMute(teamId, activeChannel.id, next);
      if (channelContextRef.current === contextKey) setMuted(result.muted);
    } catch (nextError) {
      if (channelContextRef.current === contextKey) setRequestState(getRequestState(nextError, online));
    } finally {
      if (channelContextRef.current === contextKey) setBusy(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !searchTerm.trim()) return;
    void run(async () => { const result = await searchTeamMessages({ teamId, query: searchTerm }); setSearchResults(result.messages); setSearchCursor(result.nextBefore); });
  }

  function loadMoreSearchResults() {
    if (!teamId || !searchTerm.trim() || !searchCursor) return;
    void run(async () => { const result = await searchTeamMessages({ teamId, query: searchTerm, before: searchCursor }); setSearchResults((current) => [...current, ...result.messages]); setSearchCursor(result.nextBefore); });
  }

  // Names degrade to a neutral label rather than a UID when the roster is denied
  // or still loading; `nameOf` alone would read "Former member" for everybody.
  function authorName(authorUserId: string) {
    if (authorUserId && authorUserId === userId) return 'You';
    return directoryLoaded ? nameOf(members, authorUserId) : 'Teammate';
  }

  function authorInitials(authorUserId: string) {
    if (authorUserId && authorUserId === userId) return 'YOU';
    return directoryLoaded ? initialsOf(members, authorUserId) : '—';
  }

  function reportMessage(messageId: string) {
    if (!teamId) return;
    const operationId = retainedOperation(reportOperation, `report:${messageId}`, 'report');
    // Built as a value first: `operationId` is the server's idempotency key for the
    // report, and passing it inline would be an excess-property error until the
    // shared input type carries it.
    const report = { teamId, targetType: 'content' as const, targetResource: `messages/${messageId}`, reasonCode: 'chat-content', description: 'Reported from team chat.', operationId };
    void run(() => createReport(report));
  }

  function channelName(searchChannelId: string) {
    return currentChannels.find((channel) => channel.id === searchChannelId)?.name ?? 'Another channel';
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading team chat" message="Checking your active team membership before opening private channels." />;
  if (!user || !teamId || teamStatus === 'idle') return <StatePanel variant="empty" title="Choose a team" message="Team chat becomes available after an active team membership is selected." />;
  if (loading) return <StatePanel variant="loading" title="Loading team chat" message="Checking private channels and recent messages." />;
  if (error) return <StatePanel variant="error" title="Chat could not load" message={error.message} actionLabel="Retry" onAction={() => void loadChannels()} />;

  return (
    <div className="reference-page">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Recent chat may be stale. Sending and acknowledgement actions need a connection." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}
      <section className="chip-panel"><div><span className="eyebrow">TEAM CHAT</span><h3>{activeTeam?.team?.name ?? 'Team'} conversations</h3></div><div><span>Team channels</span><span>Threads</span><span>Mentions</span><span>Reactions</span><span>Authorized search</span></div></section>
      <section className="chat-layout">
        <aside className="channels"><span className="eyebrow">CHANNELS</span>{currentChannels.length === 0 ? <p className="muted">No channels yet.</p> : currentChannels.map((channel) => <button className={channel.id === activeChannel?.id ? 'active' : ''} type="button" key={channel.id} onClick={() => setChannelId(channel.id)}><span>{channel.visibility === 'coaches' ? '🔒' : '#'}</span>{channel.name}</button>)}{hasMoreChannels ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void loadChannels(channelCursors)}>Load more channels</button> : null}{canManage ? <form className="channel-create" onSubmit={submitChannel}><input aria-label="New channel" value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} placeholder="New channel" required /><button type="submit" aria-label="Create channel" disabled={busy}>＋</button></form> : null}</aside>
        <div className="conversation">
          <div className="conversation-head"><div><strong># {activeChannel?.name ?? 'No channel selected'}</strong><small>{activeChannel?.description || (activeChannel?.visibility === 'coaches' ? 'Restricted coach channel' : 'Team-wide updates')}</small></div>{activeChannel ? <button className="filter-button" type="button" disabled={busy || muteLoading} onClick={() => void changeMute()}>{muteLoading ? 'Loading mute…' : muted ? 'Unmute' : 'Mute'}</button> : null}</div>
          {announcements.length ? <div className="announcement-strip">{announcements.map((announcement) => <article key={announcement.id}><span className="eyebrow">ANNOUNCEMENT</span><strong>{announcement.title}</strong><p>{announcement.body}</p>{announcement.acknowledgementRequired ? <button type="button" disabled={busy || acknowledged.has(announcement.id)} onClick={() => void run(async () => { await acknowledgeAnnouncement(teamId, announcement.id); setAcknowledged((current) => new Set(current).add(announcement.id)); })}>{acknowledged.has(announcement.id) ? 'Acknowledged' : 'Acknowledge'}</button> : null}</article>)}{hasMoreAnnouncements ? <button className="button button--ghost" type="button" disabled={busy} onClick={loadMoreAnnouncements}>Load earlier announcements</button> : null}</div> : null}
          {loadingMessages ? <p className="muted messages">Loading newest messages…</p> : messages.length === 0 ? <p className="empty-inline messages">No messages yet. Start the conversation.</p> : <div className="messages">{hasOlderMessages && messageCursor ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void run(async () => { const page = await loadOlderMessages(firestore, teamId, activeChannel!.id, activeChannel!.visibility, user.uid, messageCursor); setOlderMessages((current) => [...page.messages.filter((message) => !current.some((entry) => entry.id === message.id)), ...current]); setMessageCursor(page.cursor); setHasOlderMessages(page.hasOlder); })}>Load older messages</button> : null}<div className="date-chip">NEWEST MESSAGES</div>{messages.map((message) => <div id={`message-${message.id}`} tabIndex={-1} className={`message ${message.authorUserId === user.uid ? 'mine' : ''}${message.id === deepLinkMessageId ? ' message--target' : ''}`} key={message.id}><span className="message-avatar">{authorInitials(message.authorUserId)}</span><div><small>{authorName(message.authorUserId)} · {formatDate(message.createdAt)}</small><p>{message.body}</p><div className="message-actions"><button type="button" aria-label={`Toggle thumbs up reaction, ${message.reactions['👍']?.length ?? 0} reactions`} disabled={busy} onClick={() => void run(() => toggleReaction(teamId, message.id, '👍'))}>👍 {message.reactions['👍']?.length ?? 0}</button>{!message.parentMessageId ? <button type="button" disabled={busy} onClick={() => setReplyTo(message.id)}>Reply</button> : null}<button type="button" disabled={busy} onClick={() => reportMessage(message.id)}>Report</button>{canManage ? <button className="danger-text" type="button" disabled={busy || !online} onClick={() => void run(() => deleteMessage(teamId, message.id), 'channel')}>Delete</button> : null}</div></div></div>)}</div>}
          {activeChannel ? <form className="composer" onSubmit={submitMessage}><button type="button" aria-label={replyTo ? 'Cancel reply' : 'Clear message'} onClick={() => { setReplyTo(null); if (!replyTo) setBody(''); }}>{replyTo ? '×' : '＋'}</button><input aria-label={replyTo ? `Replying to ${replyTo}` : 'Message'} value={body} onChange={(event) => setBody(event.target.value)} placeholder={replyTo ? 'Write a reply…' : `Message ${activeChannel.name}`} maxLength={4000} required /><button className="send" type="submit" aria-label="Send message" disabled={busy || !online}>↑</button></form> : null}
        </div>
      </section>
      {activeChannel && canManage ? <form className="feature-panel inline-create" onSubmit={submitAnnouncement}><span className="eyebrow">POST ANNOUNCEMENT</span><label>Title<input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="Practice moved to Saturday" required /></label><label>Message<textarea value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} required /></label><button className="button" type="submit" disabled={busy}>Post</button></form> : null}
      {canManage && activeChannel ? <section className="feature-panel"><span className="eyebrow">CHANNEL MODERATION</span><h3>Manage #{activeChannel.name}</h3><p>Archiving hides a channel from the team without deleting its history. Exporting downloads this channel's messages for a safeguarding or records request.</p><div className="form-actions"><button className="button secondary" type="button" disabled={busy || !online} onClick={() => void run(async () => {
        const result = await exportTeamMessages(teamId, activeChannel.id);
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = `first-pit-${activeChannel.name}-messages.json`;
        link.click();
        URL.revokeObjectURL(href);
      })}>Export channel messages</button><button className="danger-text" type="button" disabled={busy || !online} onClick={() => void run(() => archiveChannel(teamId, activeChannel.id), 'channels')}>Archive channel</button><button className="button secondary" type="button" disabled={busy || !online} onClick={() => void run(() => purgeExpiredMessages(teamId), 'channel')}>Apply retention now</button></div></section> : null}
      <GoogleChatPanel teamId={teamId} canManage={canManage} online={online} />
      <section className="search-hero"><div><span className="eyebrow light">AUTHORIZED SEARCH</span><h3>Search team messages.</h3><p>Results stay team-scoped and exclude channels you cannot access.</p></div><form onSubmit={search}><label><span>Search messages</span><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search messages" /></label><button className="button" type="submit" disabled={busy || !online}>Search</button></form></section>
      {searchResults.length ? <section className="feed-list">{searchResults.map((result) => <article key={result.id}><span className="eyebrow">MESSAGE</span><strong>{result.body}</strong><p># {channelName(result.channelId)} · {authorName(result.authorUserId)}</p><button type="button" onClick={() => { setChannelId(result.channelId); setSearchResults([]); setSearchCursor(null); }}>Open channel</button></article>)}{searchCursor ? <button className="button" type="button" disabled={busy || !online} onClick={loadMoreSearchResults}>Load more</button> : null}</section> : null}
    </div>
  );
}
