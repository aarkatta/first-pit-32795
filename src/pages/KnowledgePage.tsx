import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { getFirebaseServices } from '@/lib/firebase';
import { useTeamContext } from '@/lib/team-context';
import { canEditKnowledge, type Answer, type Question, type Video, type VideoCategory } from '@/lib/domain';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { acceptAnswer, closePoll, createAnswer, createPoll, createQuestion, createQuestionComment, createVideo, getPollResults, getQuestionTarget, getVideoTarget, isKnowledgeTargetInContext, listPolls, listQuestionAnswers, listQuestionComments, listQuestionsByIds, listTeamQuestions, loadPersonalKnowledgeRecords, recordVideoWatch, searchQuestions, searchVideos, toggleSavedQuestion, toggleVideoFavorite, updateVideoPublication, votePoll, voteQuestion, type KnowledgeCursor, type PollListItem, type QuestionComment, type ThreadQuestion } from '@/lib/phase5-service';
import { createReport } from '@/lib/phase2-service';
import { listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import { useOnlineStatus } from '@/lib/use-online-status';
import { toDate } from '@/lib/dates';
import { createOperationId as createResourceId } from '@/lib/ids';

type Tab = 'questions' | 'videos' | 'polls';
const tabs: Tab[] = ['questions', 'videos', 'polls'];
const categories: VideoCategory[] = ['Drivetrain', 'Programming', 'CAD', 'Electronics', 'Autonomous', 'Pit Tips'];

type QuestionThread = {
  questionId: string;
  answers: Answer[];
  answerCursor: KnowledgeCursor | null;
  answerHasMore: boolean;
  comments: QuestionComment[];
  commentCursor: KnowledgeCursor | null;
  commentHasMore: boolean;
};

function displayDate(value: unknown) {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : 'Recently';
}

export function KnowledgePage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'videos' || requested === 'polls' ? requested : 'questions';
  });
  const [queryText, setQueryText] = useState('');
  const [scope, setScope] = useState<'team' | 'community'>('team');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionCursor, setQuestionCursor] = useState<KnowledgeCursor | null>(null);
  const [hasMoreQuestions, setHasMoreQuestions] = useState(false);
  const [questionStatus, setQuestionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [questionError, setQuestionError] = useState<unknown>(null);
  const [listMode, setListMode] = useState<'browse' | 'search'>('browse');
  const [videos, setVideos] = useState<Video[]>([]);
  const [polls, setPolls] = useState<PollListItem[]>([]);
  const [savedQuestionIds, setSavedQuestionIds] = useState<string[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<Map<string, Question>>(new Map());
  const [savedHasMore, setSavedHasMore] = useState(false);
  const [favoriteVideoIds, setFavoriteVideoIds] = useState<string[]>([]);
  const [watchedVideoIds, setWatchedVideoIds] = useState<string[]>([]);
  const [members, setMembers] = useState<Map<string, TeamMember>>(new Map());
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [personalStatus, setPersonalStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [personalError, setPersonalError] = useState<unknown>(null);
  const [pollStatus, setPollStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pollResults, setPollResults] = useState<Record<string, { totalVotes: number; optionVoteCounts: Record<string, number>; anonymous: boolean }>>({});
  const [votedPollIds, setVotedPollIds] = useState<Set<string>>(new Set());
  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(new Set());
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [thread, setThread] = useState<QuestionThread | null>(null);
  const [threadStatus, setThreadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [threadError, setThreadError] = useState<unknown>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [targetMismatch, setTargetMismatch] = useState<'question' | 'video' | null>(null);
  const [busy, setBusy] = useState(false);
  const [newQuestion, setNewQuestion] = useState({ title: '', body: '', category: 'Programming', tags: '' });
  const [newPoll, setNewPoll] = useState({ question: '', options: 'Yes\nNo', expiresAt: '', anonymous: true });
  const [newVideo, setNewVideo] = useState({ title: '', description: '', category: 'Programming' as VideoCategory, externalUrl: '' });
  const personalGeneration = useRef(0);
  const targetGeneration = useRef(0);
  const pollGeneration = useRef(0);
  const questionGeneration = useRef(0);
  const threadGeneration = useRef(0);
  const contextRef = useRef('');
  const questionOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const answerOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const commentOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const videoOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const pollOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const reportOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const canManage = canEditKnowledge(activeTeam);
  const contextKey = `${user?.uid ?? ''}:${teamId ?? ''}`;
  const savedQuestionKey = savedQuestionIds.join(',');
  contextRef.current = contextKey;

  const refreshPersonal = useCallback(async () => {
    const refreshContext = `${user?.uid ?? ''}:${teamId ?? ''}`;
    if (contextRef.current !== refreshContext) return;
    const generation = ++personalGeneration.current;
    if (!user) return;
    setPersonalStatus('loading');
    setPersonalError(null);
    try {
      const records = await loadPersonalKnowledgeRecords(firestore, user.uid);
      if (generation !== personalGeneration.current || contextRef.current !== refreshContext) return;
      if (records.savedQuestionIds) setSavedQuestionIds(records.savedQuestionIds);
      if (records.favoriteVideoIds) setFavoriteVideoIds(records.favoriteVideoIds);
      if (records.watchedVideoIds) setWatchedVideoIds(records.watchedVideoIds);
      setSavedHasMore(records.hasMore.savedQuestions);
      if (records.errors.length) {
        setPersonalError(records.errors[0]);
        setPersonalStatus('error');
      } else {
        setPersonalStatus('ready');
      }
    } catch (error) {
      // Without this the page keeps rendering the loading panel forever and the
      // only trace of the failure is a console error.
      if (generation !== personalGeneration.current || contextRef.current !== refreshContext) return;
      setPersonalError(error);
      setPersonalStatus('error');
    }
  }, [firestore, teamId, user]);

  const refreshQuestions = useCallback(async (cursor: KnowledgeCursor | null = null) => {
    const refreshContext = `${user?.uid ?? ''}:${teamId ?? ''}`;
    if (contextRef.current !== refreshContext) return;
    if (!teamId) {
      questionGeneration.current += 1;
      setQuestionStatus('idle');
      return;
    }
    const generation = ++questionGeneration.current;
    if (!cursor) setQuestionStatus('loading');
    setQuestionError(null);
    try {
      const page = await listTeamQuestions(firestore, teamId, cursor);
      if (generation !== questionGeneration.current || contextRef.current !== refreshContext) return;
      setQuestions((current) => cursor ? [...current, ...page.questions.filter((question) => !current.some((entry) => entry.id === question.id))] : page.questions);
      setQuestionCursor(page.cursor);
      setHasMoreQuestions(page.hasMore);
      setListMode('browse');
      setQuestionStatus('ready');
    } catch (error) {
      if (generation !== questionGeneration.current || contextRef.current !== refreshContext) return;
      setQuestionError(error);
      setQuestionStatus('error');
    }
  }, [firestore, teamId, user?.uid]);

  const loadThread = useCallback(async (question: ThreadQuestion) => {
    const threadContext = contextRef.current;
    const generation = ++threadGeneration.current;
    setThreadStatus('loading');
    setThreadError(null);
    try {
      const [answerPage, commentPage] = await Promise.all([
        listQuestionAnswers(firestore, question),
        listQuestionComments(firestore, question)
      ]);
      if (generation !== threadGeneration.current || contextRef.current !== threadContext) return;
      setThread({ questionId: question.id, answers: answerPage.answers, answerCursor: answerPage.cursor, answerHasMore: answerPage.hasMore, comments: commentPage.comments, commentCursor: commentPage.cursor, commentHasMore: commentPage.hasMore });
      setThreadStatus('ready');
    } catch (error) {
      if (generation !== threadGeneration.current || contextRef.current !== threadContext) return;
      setThreadError(error);
      setThreadStatus('error');
    }
  }, [firestore]);

  const refreshPolls = useCallback(async () => {
    const refreshContext = `${user?.uid ?? ''}:${teamId ?? ''}`;
    if (contextRef.current !== refreshContext) return;
    if (!teamId) return;
    const generation = ++pollGeneration.current;
    setPollStatus('loading');
    try {
      const result = await listPolls(teamId);
      if (generation !== pollGeneration.current || contextRef.current !== refreshContext) return;
      setPolls(result.polls);
      setPollStatus('ready');
    } catch (error) {
      if (generation !== pollGeneration.current || contextRef.current !== refreshContext) return;
      setPollStatus('error');
      throw error;
    }
  }, [teamId, user?.uid]);

  useEffect(() => {
    personalGeneration.current += 1;
    pollGeneration.current += 1;
    targetGeneration.current += 1;
    questionGeneration.current += 1;
    threadGeneration.current += 1;
    questionOperation.current = null;
    answerOperation.current = null;
    commentOperation.current = null;
    videoOperation.current = null;
    pollOperation.current = null;
    reportOperation.current = null;
    setQueryText('');
    setScope(teamId ? 'team' : 'community');
    setQuestions([]);
    setQuestionCursor(null);
    setHasMoreQuestions(false);
    setListMode('browse');
    setVideos([]);
    setPolls([]);
    setSavedQuestionIds([]);
    setSavedQuestions(new Map());
    setSavedHasMore(false);
    setFavoriteVideoIds([]);
    setWatchedVideoIds([]);
    setPollResults({});
    setVotedPollIds(new Set());
    setVotedQuestionIds(new Set());
    setExpandedQuestionId(null);
    setThread(null);
    setThreadStatus('idle');
    setThreadError(null);
    setAnswerDraft('');
    setCommentDraft('');
    setPersonalStatus(user ? 'loading' : 'ready');
    setPersonalError(null);
    setPollStatus(teamId ? 'loading' : 'idle');
    setQuestionStatus(teamId ? 'loading' : 'idle');
    setQuestionError(null);
    setRequestState(null);
    setTargetMismatch(null);
    setBusy(false);
    setNewQuestion({ title: '', body: '', category: 'Programming', tags: '' });
    setNewPoll({ question: '', options: 'Yes\nNo', expiresAt: '', anonymous: true });
    setNewVideo({ title: '', description: '', category: 'Programming', externalUrl: '' });
  }, [contextKey, teamId, user]);
  useEffect(() => {
    void refreshPersonal().catch((error: unknown) => {
      setPersonalError(error);
      setPersonalStatus('error');
    });
    return () => { personalGeneration.current += 1; };
  }, [refreshPersonal]);
  useEffect(() => {
    void refreshQuestions().catch((error: unknown) => {
      setQuestionError(error);
      setQuestionStatus('error');
    });
    return () => { questionGeneration.current += 1; };
  }, [refreshQuestions]);
  useEffect(() => { void refreshPolls().catch((error) => setRequestState(getRequestState(error, online))); }, [online, refreshPolls]);
  useEffect(() => {
    // Saved questions are stored as bare ids; the titles make the panel readable
    // and give each entry somewhere to go. The dependency is the joined key, not
    // the array, so refreshing the personal records after every action does not
    // re-run the lookup for an unchanged set.
    if (!savedQuestionKey) {
      setSavedQuestions(new Map());
      return undefined;
    }
    let cancelled = false;
    void listQuestionsByIds(firestore, savedQuestionKey.split(',')).then((resolved) => {
      if (!cancelled) setSavedQuestions(resolved);
    }).catch(() => {
      if (!cancelled) setSavedQuestions(new Map());
    });
    return () => { cancelled = true; };
  }, [firestore, savedQuestionKey]);
  useEffect(() => {
    // `users/{uid}` is private, so the roster callable is what turns an author id
    // into a name instead of a raw Firebase UID.
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
    return () => { cancelled = true; };
  }, [teamId]);
  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested === 'questions' || requested === 'videos' || requested === 'polls') setTab(requested);
  }, [searchParams]);
  useEffect(() => {
    const questionId = searchParams.get('question');
    const videoId = searchParams.get('video');
    const targetContext = contextKey;
    const generation = ++targetGeneration.current;
    if (questionId && !questions.some((question) => question.id === questionId)) {
      void getQuestionTarget(firestore, questionId).then((question) => {
        if (generation !== targetGeneration.current || contextRef.current !== targetContext) return;
        if (!isKnowledgeTargetInContext(question, teamId)) {
          setTargetMismatch('question');
          return;
        }
        setTargetMismatch(null);
        setQuestions((current) => current.some((entry) => entry.id === question.id) ? current : [question, ...current]);
      }).catch((error: unknown) => { if (generation === targetGeneration.current && contextRef.current === targetContext) setRequestState(getRequestState(error, online)); });
    } else if (videoId && !videos.some((video) => video.id === videoId)) {
      void getVideoTarget(firestore, videoId).then((video) => {
        if (generation !== targetGeneration.current || contextRef.current !== targetContext) return;
        if (!isKnowledgeTargetInContext(video, teamId)) {
          setTargetMismatch('video');
          return;
        }
        setTargetMismatch(null);
        setVideos((current) => current.some((entry) => entry.id === video.id) ? current : [video, ...current]);
      }).catch((error: unknown) => { if (generation === targetGeneration.current && contextRef.current === targetContext) setRequestState(getRequestState(error, online)); });
    }
  }, [contextKey, firestore, online, questions, searchParams, teamId, videos]);
  useEffect(() => {
    const target = searchParams.get('question') ?? searchParams.get('video') ?? searchParams.get('poll');
    if (!target) return;
    const type = searchParams.get('question') ? 'question' : searchParams.get('video') ? 'video' : 'poll';
    const node = document.getElementById(`${type}-${target}`);
    node?.scrollIntoView({ block: 'center' });
    node?.focus();
  }, [polls, questions, searchParams, videos]);

  async function run(action: () => Promise<unknown>) {
    const actionContext = contextKey;
    if (contextRef.current !== actionContext) return false;
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      if (contextRef.current !== actionContext) return false;
      void refreshPersonal();
      return true;
    } catch (error) {
      if (contextRef.current === actionContext) setRequestState(getRequestState(error, online));
      return false;
    } finally { if (contextRef.current === actionContext) setBusy(false); }
  }

  /** ARIA tabs keyboard pattern: arrows move between tabs, Home/End jump to the ends. */
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    setTab(target);
    document.getElementById(`knowledge-tab-${target}`)?.focus();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queryText.trim()) return;
    const actionContext = contextKey;
    void run(async () => {
      if (tab === 'questions') {
        const result = await searchQuestions({ query: queryText, ...(scope === 'team' && teamId ? { teamId } : {}) });
        if (contextRef.current !== actionContext) return;
        setQuestions(result.questions);
        setQuestionCursor(null);
        setHasMoreQuestions(false);
        setListMode('search');
        setQuestionStatus('ready');
      } else if (tab === 'videos') {
        const result = await searchVideos({ query: queryText, ...(scope === 'team' && teamId ? { teamId } : {}) });
        if (contextRef.current === actionContext) setVideos(result.videos);
      }
    });
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !newQuestion.title.trim() || !newQuestion.body.trim()) return;
    const actionContext = contextKey;
    const fingerprint = JSON.stringify([teamId, newQuestion]);
    const questionId = questionOperation.current?.fingerprint === fingerprint ? questionOperation.current.id : createResourceId('question');
    questionOperation.current = { fingerprint, id: questionId };
    void run(async () => {
      // The retained resource id doubles as the idempotency key, so a retried
      // submit replays the first receipt instead of posting a second question.
      await createQuestion({ questionId, teamId, visibility: 'team', title: newQuestion.title, body: newQuestion.body, category: newQuestion.category, tags: newQuestion.tags.split(',').map((tag) => tag.trim()).filter(Boolean), operationId: questionId });
      if (contextRef.current !== actionContext) return;
      questionOperation.current = null;
      setNewQuestion({ title: '', body: '', category: 'Programming', tags: '' });
      await refreshQuestions();
    });
  }

  function toggleThread(question: Question) {
    if (expandedQuestionId === question.id) {
      threadGeneration.current += 1;
      setExpandedQuestionId(null);
      setThread(null);
      setThreadStatus('idle');
      setThreadError(null);
      return;
    }
    setExpandedQuestionId(question.id);
    setThread(null);
    setAnswerDraft('');
    setCommentDraft('');
    void loadThread(question);
  }

  function submitAnswer(event: FormEvent<HTMLFormElement>, question: Question) {
    event.preventDefault();
    if (!answerDraft.trim()) return;
    const actionContext = contextKey;
    const fingerprint = JSON.stringify([question.id, answerDraft.trim()]);
    const answerId = answerOperation.current?.fingerprint === fingerprint ? answerOperation.current.id : createResourceId('answer');
    answerOperation.current = { fingerprint, id: answerId };
    void run(async () => {
      await createAnswer({ questionId: question.id, answerId, body: answerDraft, operationId: answerId });
      if (contextRef.current !== actionContext) return;
      answerOperation.current = null;
      setAnswerDraft('');
      setQuestions((current) => current.map((entry) => entry.id === question.id ? { ...entry, answerCount: entry.answerCount + 1 } : entry));
      await loadThread(question);
    });
  }

  function submitComment(event: FormEvent<HTMLFormElement>, question: Question) {
    event.preventDefault();
    if (!commentDraft.trim()) return;
    const actionContext = contextKey;
    const fingerprint = JSON.stringify([question.id, commentDraft.trim()]);
    const commentId = commentOperation.current?.fingerprint === fingerprint ? commentOperation.current.id : createResourceId('comment');
    commentOperation.current = { fingerprint, id: commentId };
    void run(async () => {
      await createQuestionComment({ questionId: question.id, body: commentDraft, operationId: commentId });
      if (contextRef.current !== actionContext) return;
      commentOperation.current = null;
      setCommentDraft('');
      setQuestions((current) => current.map((entry) => entry.id === question.id ? { ...entry, commentCount: entry.commentCount + 1 } : entry));
      await loadThread(question);
    });
  }

  function submitVote(question: Question) {
    const actionContext = contextKey;
    void run(async () => {
      const result = await voteQuestion(question.id);
      if (contextRef.current !== actionContext) return;
      setVotedQuestionIds((current) => {
        const next = new Set(current);
        if (result.voted) next.add(question.id); else next.delete(question.id);
        return next;
      });
      setQuestions((current) => current.map((entry) => entry.id === question.id ? { ...entry, voteCount: Math.max(0, entry.voteCount + (result.voted ? 1 : -1)) } : entry));
    });
  }

  function submitAcceptAnswer(question: Question, answerId: string) {
    const actionContext = contextKey;
    void run(async () => {
      await acceptAnswer({ questionId: question.id, answerId });
      if (contextRef.current !== actionContext) return;
      setQuestions((current) => current.map((entry) => entry.id === question.id ? { ...entry, status: 'solved' } : entry));
      await loadThread(question);
    });
  }

  function loadMoreAnswers(question: ThreadQuestion, cursor: KnowledgeCursor) {
    void run(async () => {
      const page = await listQuestionAnswers(firestore, question, cursor);
      setThread((current) => current && current.questionId === question.id
        ? { ...current, answers: [...current.answers, ...page.answers.filter((answer) => !current.answers.some((entry) => entry.id === answer.id))], answerCursor: page.cursor, answerHasMore: page.hasMore }
        : current);
    });
  }

  function loadMoreComments(question: ThreadQuestion, cursor: KnowledgeCursor) {
    void run(async () => {
      const page = await listQuestionComments(firestore, question, cursor);
      setThread((current) => current && current.questionId === question.id
        ? { ...current, comments: [...current.comments, ...page.comments.filter((comment) => !current.comments.some((entry) => entry.id === comment.id))], commentCursor: page.cursor, commentHasMore: page.hasMore }
        : current);
    });
  }

  /** Retained per target so a double-clicked report replays one receipt. */
  function reportKnowledgeContent(reportTeamId: string, targetResource: string, reasonCode: string, description: string) {
    if (!reportTeamId) return;
    const operationId = reportOperation.current?.fingerprint === targetResource ? reportOperation.current.id : createResourceId('report');
    reportOperation.current = { fingerprint: targetResource, id: operationId };
    // Built as a value first: `operationId` is the server's idempotency key for the
    // report, and passing it inline would be an excess-property error until the
    // shared input type carries it.
    const report = { teamId: reportTeamId, targetType: 'content' as const, targetResource, reasonCode, description, operationId };
    void run(() => createReport(report));
  }

  function submitPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !newPoll.question.trim()) return;
    const actionContext = contextKey;
    const fingerprint = JSON.stringify([teamId, newPoll]);
    const pollId = pollOperation.current?.fingerprint === fingerprint ? pollOperation.current.id : createResourceId('poll');
    pollOperation.current = { fingerprint, id: pollId };
    void run(async () => {
      await createPoll({ pollId, teamId, question: newPoll.question, options: newPoll.options.split('\n').map((option) => option.trim()).filter(Boolean), anonymous: newPoll.anonymous, resultsVisibility: newPoll.anonymous ? 'afterClose' : 'afterVote', ...(newPoll.expiresAt ? { expiresAt: new Date(newPoll.expiresAt).toISOString() } : {}), operationId: pollId });
      if (contextRef.current !== actionContext) return;
      pollOperation.current = null;
      setNewPoll({ question: '', options: 'Yes\nNo', expiresAt: '', anonymous: true });
      await refreshPolls();
    });
  }

  function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !newVideo.title.trim() || !newVideo.description.trim() || !newVideo.externalUrl.trim()) return;
    const actionContext = contextKey;
    const fingerprint = JSON.stringify([teamId, newVideo]);
    const videoId = videoOperation.current?.fingerprint === fingerprint ? videoOperation.current.id : createResourceId('video');
    videoOperation.current = { fingerprint, id: videoId };
    void run(async () => {
      await createVideo({ videoId, teamId, visibility: 'team', ...newVideo, sourceAttribution: 'Team library', operationId: videoId });
      if (contextRef.current === actionContext) { videoOperation.current = null; setNewVideo({ title: '', description: '', category: 'Programming', externalUrl: '' }); }
    });
  }

  if (!user) return <StatePanel variant="permission" title="Sign in to learn with your team" message="Questions, videos, saved records, and polls are available after authentication." />;

  const visibleQuestions = questions.filter((question) => isKnowledgeTargetInContext(question, teamId));
  const visibleVideos = videos.filter((video) => isKnowledgeTargetInContext(video, teamId));
  // Names degrade to a neutral label rather than a UID when the roster is denied
  // or still loading; `nameOf` alone would read "Former member" for everybody.
  const authorName = (authorUserId: string) => authorUserId === user.uid ? 'You' : directoryLoaded ? nameOf(members, authorUserId) : 'Teammate';

  return (
    <div className="page-stack">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Questions, videos, and polls may be stale. Posting and voting need a connection." /> : null}
      <section className="search-hero"><div><span className="eyebrow light">KNOWLEDGE & DECISIONS</span><h3>Learn, ask, decide.</h3><p>Questions, how-to videos, and polls stay inside their authorized team or explicitly shared scope.</p></div>{tab !== 'polls' ? <form onSubmit={submitSearch}><label htmlFor="knowledge-search">Search {tab}<input id="knowledge-search" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder={`Search ${tab} by keyword`} /></label><label>Scope<select aria-label="Visibility scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="team" disabled={!teamId}>Current team</option><option value="community">Shared library</option></select></label><button type="submit" disabled={busy || !queryText.trim()}>Search</button></form> : null}</section>
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}
      {targetMismatch ? <KnowledgeTargetMismatch targetType={targetMismatch} /> : null}
      {personalStatus === 'loading' ? <StatePanel variant="loading" title="Loading your knowledge library" message="Fetching saved questions, favorite videos, and watch history." /> : null}
      {personalStatus === 'error' ? <StatePanel {...getRequestState(personalError, online)} title="Some personal knowledge records could not load" actionLabel="Retry personal records" onAction={() => void refreshPersonal()} /> : null}
      <section className="board-toolbar"><div className="view-tabs" role="tablist" aria-label="Knowledge modules">{tabs.map((item, index) => <button id={`knowledge-tab-${item}`} aria-controls={`knowledge-panel-${item}`} className={tab === item ? 'active' : ''} type="button" role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} key={item} onKeyDown={(event) => onTabKeyDown(event, index)} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div></section>

      {tab === 'questions' ? <div id="knowledge-panel-questions" role="tabpanel" aria-labelledby="knowledge-tab-questions" tabIndex={0}>
        <section className="split-panels"><article className="feature-panel"><span className="eyebrow">ASK YOUR TEAM</span><h3>Start a question</h3><p>Private team questions never enter the shared library unless explicitly published.</p><form className="form-stack" onSubmit={submitQuestion}><label>Title<input value={newQuestion.title} onChange={(event) => setNewQuestion({ ...newQuestion, title: event.target.value })} required maxLength={180} /></label><label>Question<textarea value={newQuestion.body} onChange={(event) => setNewQuestion({ ...newQuestion, body: event.target.value })} required maxLength={8000} /></label><label>Category<input value={newQuestion.category} onChange={(event) => setNewQuestion({ ...newQuestion, category: event.target.value })} /></label><label>Tags<input value={newQuestion.tags} onChange={(event) => setNewQuestion({ ...newQuestion, tags: event.target.value })} placeholder="programming, sensors" /></label><button className="button" type="submit" disabled={busy || !teamId}>Post team question</button></form></article><article className="feature-panel"><span className="eyebrow">SAVED QUESTIONS</span><h3>Your quick reference</h3>{savedQuestionIds.length ? <ul className="stack">{savedQuestionIds.map((id) => <li key={id}>{savedQuestions.has(id) ? <Link to={`?question=${id}`}>{savedQuestions.get(id)?.title}</Link> : <span className="muted">Saved question is no longer available to you.</span>}</li>)}</ul> : <p>Save a question to find it here after you sign in again.</p>}{savedHasMore ? <p className="muted">Showing your most recent saved questions.</p> : null}</article></section>
        {questionStatus === 'loading' ? <StatePanel variant="loading" title="Loading team questions" message="Fetching the most recent questions for your team." />
          : questionStatus === 'error' ? <StatePanel {...getRequestState(questionError, online)} title="Questions could not load" actionLabel="Retry" onAction={() => void refreshQuestions()} />
          : visibleQuestions.length === 0 ? <StatePanel variant="empty" title={listMode === 'search' ? 'No questions matched that search' : 'No team questions yet'} message={listMode === 'search' ? 'Try a different keyword, or clear the search to see the most recent team questions.' : 'Ask the first question above and your team can answer it here.'} actionLabel={listMode === 'search' ? 'Show recent questions' : undefined} onAction={listMode === 'search' ? () => void refreshQuestions() : undefined} />
          : <section className="feed-list">
            {listMode === 'search' ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void refreshQuestions()}>Show recent questions</button> : null}
            {visibleQuestions.map((question) => <article id={`question-${question.id}`} tabIndex={-1} key={question.id}>
              <span className="eyebrow">{question.category} · {question.status} · {displayDate(question.createdAt)}</span>
              <strong>{question.title}</strong>
              <p>{question.body}</p>
              <p className="muted">Asked by {authorName(question.createdBy)} · {question.tags.join(' · ') || 'No tags'} · {question.answerCount} answer{question.answerCount === 1 ? '' : 's'} · {question.voteCount} helpful</p>
              <div>
                <button type="button" aria-expanded={expandedQuestionId === question.id} aria-controls={`thread-${question.id}`} disabled={busy} onClick={() => toggleThread(question)}>{expandedQuestionId === question.id ? 'Hide answers' : 'Answers & comments'}</button>
                <button type="button" disabled={busy || !online} onClick={() => submitVote(question)}>{votedQuestionIds.has(question.id) ? 'Helpful ✓' : 'Mark helpful'}</button>
                <button type="button" disabled={busy} onClick={() => void run(async () => { await toggleSavedQuestion(question.id); })}>{savedQuestionIds.includes(question.id) ? 'Saved' : 'Save question'}</button>
                <button type="button" disabled={busy || !question.teamId} onClick={() => reportKnowledgeContent(question.teamId ?? '', `questions/${question.id}`, 'knowledge-content', 'Reported from Questions.')}>Report</button>
              </div>
              {expandedQuestionId === question.id ? <div id={`thread-${question.id}`} className="stack">
                {threadStatus === 'loading' ? <StatePanel variant="loading" title="Loading answers" message="Fetching the answers and comments on this question." /> : null}
                {threadStatus === 'error' ? <StatePanel {...getRequestState(threadError, online)} title="Answers could not load" actionLabel="Retry answers" onAction={() => void loadThread(question)} /> : null}
                {threadStatus === 'ready' && thread && thread.questionId === question.id ? <>
                  <span className="eyebrow">ANSWERS</span>
                  {thread.answers.length === 0 ? <p className="empty-inline">No answers yet. Post the first one.</p> : thread.answers.map((answer) => <article className="card" key={answer.id}>
                    <p className="eyebrow">{answer.accepted ? 'ACCEPTED ANSWER · ' : ''}{authorName(answer.createdBy)} · {displayDate(answer.createdAt)}</p>
                    <p>{answer.body}</p>
                    {!answer.accepted && (question.createdBy === user.uid || canManage) ? <button className="text-button" type="button" disabled={busy || !online} onClick={() => submitAcceptAnswer(question, answer.id)}>Accept this answer</button> : null}
                  </article>)}
                  {thread.answerHasMore && thread.answerCursor ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => loadMoreAnswers(question, thread.answerCursor!)}>Load more answers</button> : null}
                  <form className="form-stack" onSubmit={(event) => submitAnswer(event, question)}><label>Your answer<textarea value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} maxLength={8000} required /></label><button className="button" type="submit" disabled={busy || !online || !answerDraft.trim()}>Post answer</button></form>
                  <span className="eyebrow">COMMENTS</span>
                  {thread.comments.length === 0 ? <p className="empty-inline">No comments yet.</p> : thread.comments.map((comment) => <p key={comment.id} className="muted">{authorName(comment.createdBy)} · {displayDate(comment.createdAt)} — {comment.body}</p>)}
                  {thread.commentHasMore && thread.commentCursor ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => loadMoreComments(question, thread.commentCursor!)}>Load more comments</button> : null}
                  <form className="form-stack" onSubmit={(event) => submitComment(event, question)}><label>Add a comment<input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={2000} required /></label><button className="button button--ghost" type="submit" disabled={busy || !online || !commentDraft.trim()}>Post comment</button></form>
                </> : null}
              </div> : null}
            </article>)}
            {listMode === 'browse' && hasMoreQuestions && questionCursor ? <button className="button" type="button" disabled={busy} onClick={() => void refreshQuestions(questionCursor)}>Load more questions</button> : null}
          </section>}
      </div> : null}

      {tab === 'videos' ? <section id="knowledge-panel-videos" role="tabpanel" aria-labelledby="knowledge-tab-videos" tabIndex={0} className="stack"><article className="card"><p className="eyebrow">Video catalog</p><p className="muted">Required categories: {categories.join(' · ')}. Captions and transcript availability are shown before watching.</p>{canManage ? <form className="form-stack" onSubmit={submitVideo}><label>Title<input value={newVideo.title} onChange={(event) => setNewVideo({ ...newVideo, title: event.target.value })} required /></label><label>Description<textarea value={newVideo.description} onChange={(event) => setNewVideo({ ...newVideo, description: event.target.value })} required /></label><label>Category<select value={newVideo.category} onChange={(event) => setNewVideo({ ...newVideo, category: event.target.value as VideoCategory })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>External source URL<input type="url" value={newVideo.externalUrl} onChange={(event) => setNewVideo({ ...newVideo, externalUrl: event.target.value })} required /></label><button className="button" type="submit" disabled={busy}>Add draft video</button></form> : null}</article>{visibleVideos.length === 0 ? <p className="empty-inline">Search for a video by title, category, or skill.</p> : visibleVideos.map((video) => <article id={`video-${video.id}`} tabIndex={-1} className="card" key={video.id}><p className="eyebrow">{video.category} · {video.publicationStatus}</p><h2>{video.title}</h2><p>{video.description}</p><p className="muted">Source: {video.sourceAttribution} · {video.captionTracks.length ? `${video.captionTracks.length} caption/transcript track(s)` : 'No captions listed'}</p><div className="hero-actions">{video.externalUrl ? <a className="button" href={video.externalUrl} target="_blank" rel="noreferrer" onClick={() => void run(() => recordVideoWatch(video.id))}>Watch video</a> : <button className="button" type="button" onClick={() => void run(() => recordVideoWatch(video.id))}>Record watch</button>}<button className="button button--ghost" type="button" disabled={busy} onClick={() => void run(() => toggleVideoFavorite(video.id))}>{favoriteVideoIds.includes(video.id) ? 'Favorited' : 'Favorite'}</button>{canManage && video.teamId === teamId ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => void run(() => updateVideoPublication(video.id, video.publicationStatus === 'published' ? 'unpublished' : 'published'))}>{video.publicationStatus === 'published' ? 'Unpublish' : 'Publish'}</button> : null}<button className="text-button" type="button" disabled={busy || !video.teamId} onClick={() => reportKnowledgeContent(video.teamId ?? '', `videos/${video.id}`, 'knowledge-video', 'Reported from How-to Videos.')}>Report</button></div></article>)}</section> : null}

      {tab === 'polls' ? <div id="knowledge-panel-polls" role="tabpanel" aria-labelledby="knowledge-tab-polls" tabIndex={0}><section className="feature-panel"><span className="eyebrow">CREATE A TEAM POLL</span><h3>Make a team decision</h3><p>Anonymous poll results remain hidden until close.</p><form className="form-stack" onSubmit={submitPoll}><label>Question<input value={newPoll.question} onChange={(event) => setNewPoll({ ...newPoll, question: event.target.value })} required /></label><label>Choices<textarea value={newPoll.options} onChange={(event) => setNewPoll({ ...newPoll, options: event.target.value })} /></label><label>Expires at<input type="datetime-local" value={newPoll.expiresAt} onChange={(event) => setNewPoll({ ...newPoll, expiresAt: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={newPoll.anonymous} onChange={(event) => setNewPoll({ ...newPoll, anonymous: event.target.checked })} /> Anonymous votes · results after close</label><button className="button" type="submit" disabled={busy || !teamId}>Create poll</button></form></section>{pollStatus === 'loading' ? <StatePanel variant="loading" title="Loading team polls" message="Checking current poll visibility and result permissions." /> : polls.length === 0 ? <StatePanel variant="empty" title="No team polls yet" message="Create a private poll to collect a team decision." /> : <section className="feed-list">{polls.map((poll) => <PollCard key={poll.id} poll={poll} result={pollResults[poll.id] ?? (poll.resultsVisible && poll.optionVoteCounts ? { totalVotes: poll.totalVotes ?? 0, optionVoteCounts: poll.optionVoteCounts, anonymous: poll.anonymous } : null)} busy={busy} canManage={canManage} submitted={votedPollIds.has(poll.id)} onClose={() => { const actionContext = contextKey; void run(async () => { await closePoll(poll.id); if (contextRef.current === actionContext) await refreshPolls(); }); }} onVote={async (selectedOptionIds) => { const actionContext = contextKey; return run(async () => { await votePoll({ pollId: poll.id, selectedOptionIds }); if (contextRef.current !== actionContext) return; setVotedPollIds((current) => new Set(current).add(poll.id)); await refreshPolls(); }); }} onResults={() => { const actionContext = contextKey; void run(async () => { const result = await getPollResults(poll.id); if (contextRef.current === actionContext) setPollResults((current) => ({ ...current, [poll.id]: result })); }); }} />)}</section>}</div> : null}
      <p className="muted">{watchedVideoIds.length ? `${watchedVideoIds.length} recently watched video record(s) saved to your account.` : 'Recently watched videos will appear here after playback.'}</p>
    </div>
  );
}

export function PollCard({ poll, result, busy, canManage, submitted, onClose, onVote, onResults }: { poll: PollListItem; result: { totalVotes: number; optionVoteCounts: Record<string, number>; anonymous: boolean } | null; busy: boolean; canManage: boolean; submitted: boolean; onClose: () => void; onVote: (choices: string[]) => Promise<boolean>; onResults: () => void }) {
  const [choices, setChoices] = useState<string[]>([]);
  return <article id={`poll-${poll.id}`} tabIndex={-1} className="latest-poll"><span className="eyebrow">TEAM POLL · {poll.status} · {poll.anonymous ? 'ANONYMOUS' : 'NAMED'}</span><strong>{poll.question}</strong><div className="form-stack">{poll.options.map((option) => <label className="checkbox-label" key={option.id}><input type={poll.selection === 'single' ? 'radio' : 'checkbox'} name={`poll-${poll.id}`} checked={choices.includes(option.id)} disabled={submitted || poll.status !== 'open'} onChange={() => setChoices((current) => poll.selection === 'single' ? [option.id] : current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id])} />{option.label}</label>)}</div>{result ? <div className="poll-results" aria-live="polite"><strong>{result.totalVotes} authorized vote{result.totalVotes === 1 ? '' : 's'}</strong>{poll.options.map((option) => <p key={option.id}>{option.label}: {result.optionVoteCounts[option.id] ?? 0}</p>)}</div> : <p className="muted">Results are hidden until this poll’s configured visibility rule allows them.</p>}<div className="form-actions"><button type="button" disabled={busy || submitted || poll.status !== 'open' || choices.length === 0} onClick={() => void onVote(choices).then((saved) => { if (saved) setChoices([]); })}>{submitted ? 'Vote submitted' : 'Submit vote'}</button>{poll.resultsVisible ? <button className="button button--ghost" type="button" disabled={busy} onClick={onResults}>Refresh authorized results</button> : null}{canManage && poll.status === 'open' ? <button className="text-button" type="button" disabled={busy} onClick={onClose}>Close now</button> : null}</div></article>;
}

export function KnowledgeTargetMismatch({ targetType }: { targetType: 'question' | 'video' }) {
  return <StatePanel variant="permission" title={`Linked ${targetType} belongs to another team`} message="Switch to that team from the workspace navigation before opening this link. Your active team was not changed automatically." />;
}
