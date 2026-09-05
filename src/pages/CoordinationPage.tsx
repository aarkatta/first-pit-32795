import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { KanbanBoard } from '@/features/kanban/KanbanBoard';
import { TeamCalendarPanel } from '@/features/google/TeamCalendarPanel';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader, type CalendarEvent, type NotificationRecord, type TeamGoal } from '@/lib/domain';
import { listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import {
  UploadAbortedError,
  createEvent,
  createGoal,
  deleteEvent,
  formatFileSize,
  getTeamFile,
  listTeamFiles,
  markNotificationRead,
  updateEvent,
  uploadTeamFile,
  type TeamFile
} from '@/lib/phase3-service';
import { useOnlineStatus } from '@/lib/use-online-status';
import { safeInternalRoute } from '@/lib/notification-route';
import { toDate } from '@/lib/dates';
import { createOperationId } from '@/lib/ids';

type FileSharing = 'disabled' | 'teamOnly';

type CoordinationData = {
  goals: TeamGoal[];
  events: CalendarEvent[];
  notifications: NotificationRecord[];
  members: TeamMember[];
  fileSharing: FileSharing;
};

const emptyData: CoordinationData = { goals: [], events: [], notifications: [], members: [], fileSharing: 'disabled' };

const id = createOperationId;

/** Firestore timestamp -> the local `YYYY-MM-DDTHH:mm` a datetime-local input needs. */
function toLocalInput(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatDate(value: unknown) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'No date';
}

function parseEvent(id: string, data: Record<string, unknown>): CalendarEvent {
  return { id, teamId: String(data.teamId ?? ''), createdBy: String(data.createdBy ?? ''), title: String(data.title ?? 'Untitled event'), description: String(data.description ?? ''), startsAt: data.startsAt, endsAt: data.endsAt, location: typeof data.location === 'string' ? data.location : null, eventType: (data.eventType ?? 'meeting') as CalendarEvent['eventType'], recurrence: null, occurrenceOf: typeof data.occurrenceOf === 'string' ? data.occurrenceOf : null, reminderMinutes: Array.isArray(data.reminderMinutes) ? data.reminderMinutes.map(Number) : [], linkedTaskIds: Array.isArray(data.linkedTaskIds) ? data.linkedTaskIds.map(String) : [], version: Number(data.version ?? 1), googleEventId: typeof data.googleEventId === 'string' ? data.googleEventId : null };
}

function parseGoal(id: string, data: Record<string, unknown>): TeamGoal {
  return { id, teamId: String(data.teamId ?? ''), createdBy: String(data.createdBy ?? ''), title: String(data.title ?? 'Untitled goal'), description: String(data.description ?? ''), status: (data.status ?? 'active') as TeamGoal['status'], dueAt: data.dueAt, taskCount: Number(data.taskCount ?? 0), completedTaskCount: Number(data.completedTaskCount ?? 0) };
}

function parseNotification(id: string, data: Record<string, unknown>): NotificationRecord {
  return { id, teamId: String(data.teamId ?? ''), createdBy: String(data.createdBy ?? ''), recipientUserId: String(data.recipientUserId ?? ''), type: (data.type ?? 'system') as NotificationRecord['type'], title: String(data.title ?? 'Notification'), body: String(data.body ?? ''), deepLink: String(data.deepLink ?? '/coordination'), dedupeKey: String(data.dedupeKey ?? id), mandatory: data.mandatory === true, readAt: data.readAt ?? null };
}

async function loadCoordination(firestore: Firestore, teamId: string, userId: string): Promise<CoordinationData> {
  const [goals, eventMasters, eventOccurrences, notifications, policy, roster] = await Promise.all([
    getDocs(query(collection(firestore, 'goals'), where('teamId', '==', teamId), orderBy('dueAt', 'asc'), limit(50))),
    getDocs(query(collection(firestore, 'events'), where('teamId', '==', teamId), where('startsAt', '>=', new Date()), orderBy('startsAt', 'asc'), limit(50))),
    getDocs(query(collection(firestore, 'eventOccurrences'), where('teamId', '==', teamId), where('startsAt', '>=', new Date()), orderBy('startsAt', 'asc'), limit(50))),
    getDocs(query(collection(firestore, 'notifications'), where('recipientUserId', '==', userId), where('teamId', '==', teamId), orderBy('createdAt', 'desc'), limit(50))),
    // The Storage Area is readable only while team policy enables file sharing, so the
    // policy decides whether a file query is even attempted.
    getDoc(doc(firestore, 'teamPolicies', teamId)),
    // Uploader names come from the server-side join; a failure degrades the labels
    // rather than the page.
    listTeamMembers(teamId).catch(() => ({ members: [] as TeamMember[], truncated: false }))
  ]);
  return {
    goals: goals.docs.map((doc) => parseGoal(doc.id, doc.data() as Record<string, unknown>)),
    events: [
      ...eventMasters.docs.filter((doc) => !doc.data().recurrence).map((doc) => parseEvent(doc.id, doc.data() as Record<string, unknown>)),
      ...eventOccurrences.docs.map((doc) => parseEvent(doc.id, doc.data() as Record<string, unknown>))
    ],
    notifications: notifications.docs.map((doc) => parseNotification(doc.id, doc.data() as Record<string, unknown>)),
    members: roster.members,
    fileSharing: policy.data()?.fileSharing === 'teamOnly' ? 'teamOnly' : 'disabled'
  };
}

export function CoordinationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const [data, setData] = useState<CoordinationData>(emptyData);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [files, setFiles] = useState<TeamFile[]>([]);
  const [fileCursor, setFileCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [filesStatus, setFilesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [filesState, setFilesState] = useState<RequestState | null>(null);
  const requestGeneration = useRef(0);
  const targetGeneration = useRef(0);
  const filesGeneration = useRef(0);
  const uploadAbort = useRef<AbortController | null>(null);
  const currentTeamId = useRef(teamId);
  currentTeamId.current = teamId;
  const linkedFileId = searchParams.get('file');
  const directory = useMemo(() => memberMap(data.members), [data.members]);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!teamId || !user) return;
    setStatus('loading');
    setError(null);
    try {
      const nextData = await loadCoordination(firestore, teamId, user.uid);
      if (generation !== requestGeneration.current) return;
      setData(nextData);
      setStatus('ready');
    } catch (nextError) {
      if (generation !== requestGeneration.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Could not load coordination data.'));
      setStatus('error');
    }
  }, [firestore, teamId, user]);

  /**
   * File pages are read separately from the rest of the screen: a team whose policy
   * or rules deny the Storage Area still gets its tracker, calendar, and notifications.
   */
  const loadFiles = useCallback(async (cursor: QueryDocumentSnapshot | null) => {
    const generation = ++filesGeneration.current;
    if (!teamId) return;
    setFilesStatus('loading');
    setFilesState(null);
    try {
      const page = await listTeamFiles(firestore, teamId, cursor);
      if (generation !== filesGeneration.current) return;
      setFiles((current) => {
        const next = cursor ? [...current, ...page.files] : page.files;
        return [...new Map(next.map((file) => [file.id, file])).values()];
      });
      setFileCursor(page.cursor);
      setFilesStatus('ready');
    } catch (nextError) {
      if (generation !== filesGeneration.current) return;
      setFilesState(getRequestState(nextError, online));
      setFilesStatus('error');
    }
  }, [firestore, online, teamId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setFiles([]);
    setFileCursor(null);
    setFilesStatus('idle');
    setFilesState(null);
    filesGeneration.current += 1;
    // A team switch must not let an in-flight upload finalize against the team the
    // user just left, and must not keep pushing progress into this screen.
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    setFileProgress(null);
  }, [teamId]);
  useEffect(() => () => { uploadAbort.current?.abort(); }, []);
  useEffect(() => {
    if (status !== 'ready' || !teamId || data.fileSharing !== 'teamOnly' || filesStatus !== 'idle') return;
    void loadFiles(null);
  }, [data.fileSharing, filesStatus, loadFiles, status, teamId]);
  useEffect(() => {
    // A `/coordination?file=<id>` deep link from search must resolve even when the
    // file is older than the first page.
    if (filesStatus !== 'ready' || !teamId || !linkedFileId || files.some((file) => file.id === linkedFileId)) return;
    const generation = filesGeneration.current;
    void getTeamFile(firestore, teamId, linkedFileId)
      .then((file) => {
        if (generation !== filesGeneration.current) return;
        if (!file) throw new Error('The linked file was not found in this team.');
        setFiles((current) => current.some((entry) => entry.id === file.id) ? current : [file, ...current]);
      })
      .catch((nextError: unknown) => { if (generation === filesGeneration.current) setFilesState(getRequestState(nextError, online)); });
  }, [files, filesStatus, firestore, linkedFileId, online, teamId]);
  useEffect(() => {
    const generation = ++targetGeneration.current;
    if (status !== 'ready' || !teamId) return;
    const goalId = searchParams.get('goal');
    const eventId = searchParams.get('event');
    if (goalId && !data.goals.some((goal) => goal.id === goalId)) {
      void getDoc(doc(firestore, 'goals', goalId)).then((snapshot) => {
        if (generation !== targetGeneration.current || !snapshot.exists() || snapshot.data().teamId !== teamId) throw new Error('The linked goal was not found in this team.');
        setData((current) => ({ ...current, goals: [parseGoal(snapshot.id, snapshot.data() as Record<string, unknown>), ...current.goals] }));
      }).catch((nextError: unknown) => { if (generation === targetGeneration.current) setRequestState(getRequestState(nextError, online)); });
    } else if (eventId && !data.events.some((event) => event.id === eventId)) {
      void Promise.all([getDoc(doc(firestore, 'eventOccurrences', eventId)), getDoc(doc(firestore, 'events', eventId))]).then(([occurrence, event]) => {
        const snapshot = occurrence.exists() ? occurrence : event;
        if (generation !== targetGeneration.current || !snapshot.exists() || snapshot.data().teamId !== teamId) throw new Error('The linked event was not found in this team.');
        setData((current) => ({ ...current, events: [parseEvent(snapshot.id, snapshot.data() as Record<string, unknown>), ...current.events] }));
      }).catch((nextError: unknown) => { if (generation === targetGeneration.current) setRequestState(getRequestState(nextError, online)); });
    }
  }, [data.events, data.goals, firestore, online, searchParams, status, teamId]);
  useEffect(() => {
    if (status !== 'ready') return;
    const target = searchParams.get('task') ?? searchParams.get('goal') ?? searchParams.get('event') ?? searchParams.get('file');
    const type = searchParams.get('task') ? 'task' : searchParams.get('goal') ? 'goal' : searchParams.get('event') ? 'event' : 'file';
    if (target) {
      const node = document.getElementById(`${type}-${target}`);
      node?.scrollIntoView({ block: 'center' });
      node?.focus();
    }
  }, [data, files, searchParams, status]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setRequestState(null);
    try { await action(); if (currentTeamId.current === teamId) await refresh(); }
    catch (nextError) { setRequestState(getRequestState(nextError, online)); }
    finally { setBusy(false); }
  }

  function submitEventEdit(formEvent: FormEvent<HTMLFormElement>, calendarEvent: CalendarEvent) {
    formEvent.preventDefault();
    if (!teamId) return;
    const form = new FormData(formEvent.currentTarget);
    const startsAt = new Date(String(form.get('startsAt') ?? ''));
    const endsAt = new Date(String(form.get('endsAt') ?? ''));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return;
    void run(() => updateEvent({ teamId, eventId: calendarEvent.id, operationId: id(), expectedVersion: calendarEvent.version, title: String(form.get('title') ?? '').trim(), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }));
  }

  function submitEventDelete(calendarEvent: CalendarEvent) {
    if (!teamId) return;
    void run(() => deleteEvent(teamId, calendarEvent.id));
  }

  function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !eventTitle.trim() || !eventStart) return;
    const start = new Date(eventStart);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    void run(async () => { await createEvent({ teamId, operationId: id(), title: eventTitle.trim(), startsAt: start.toISOString(), endsAt: end.toISOString() }); setEventTitle(''); setEventStart(''); });
  }

  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !goalTitle.trim()) return;
    void run(async () => { await createGoal({ teamId, operationId: id(), title: goalTitle.trim() }); setGoalTitle(''); });
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !teamId) return;
    // Clearing the input lets the same file be retried after a failure.
    event.target.value = '';
    const controller = new AbortController();
    uploadAbort.current?.abort();
    uploadAbort.current = controller;
    setFileProgress(0);
    setBusy(true);
    setRequestState(null);
    void (async () => {
      try {
        await uploadTeamFile({
          teamId,
          fileId: id(),
          file,
          signal: controller.signal,
          activeTeamId: () => currentTeamId.current,
          onProgress: (progress) => { if (!controller.signal.aborted) setFileProgress(progress); }
        });
        if (controller.signal.aborted || currentTeamId.current !== teamId) return;
        await loadFiles(null);
      } catch (nextError) {
        // A cancelled upload is a decision, not a failure, so it gets no error panel.
        if (nextError instanceof UploadAbortedError || controller.signal.aborted) return;
        setRequestState(getRequestState(nextError, online));
      } finally {
        if (uploadAbort.current === controller) uploadAbort.current = null;
        setFileProgress(null);
        setBusy(false);
      }
    })();
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading coordination" message="Checking your active team membership before loading team records." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Tracker, calendar, notifications, and files become available after an active team membership is selected." />;
  if (status === 'loading') return <StatePanel variant="loading" title="Loading coordination" message="Fetching a bounded page of tasks, upcoming events, and notifications." />;
  if (status === 'error') return <StatePanel variant="error" title="Coordination could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus />;

  const filesEnabled = data.fileSharing === 'teamOnly';

  return (
    <div className="reference-page monday">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Existing data may be stale. Mutations will be retried only after you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      <KanbanBoard teamId={teamId} canManage={canManage} actorRole={activeTeam?.role ?? 'parent'} actorUserId={user.uid} online={online} />

      <section className="calendar-shell"><div><span className="eyebrow light">CALENDAR</span><h3>Practices, meetings, and deadlines.</h3><p>Every event stays inside {activeTeam?.team?.name ?? 'the active team'}.</p></div><div className="calendar-card"><strong>{data.events.length}</strong><span>upcoming events</span></div></section>
      {data.events.length ? <section className="timeline-list">{data.events.map((calendarEvent) => <article id={`event-${calendarEvent.id}`} tabIndex={-1} key={calendarEvent.id}><span>{calendarEvent.eventType}</span><div><strong>{calendarEvent.title}</strong><small>{formatDate(calendarEvent.startsAt)}</small>{calendarEvent.googleEventId ? <small className="muted"> · in Google Calendar</small> : null}{canManage && !calendarEvent.occurrenceOf ? <details className="event-edit"><summary>Edit event</summary><form className="form-stack" onSubmit={(formEvent) => submitEventEdit(formEvent, calendarEvent)}><label>Title<input name="title" defaultValue={calendarEvent.title} maxLength={160} required /></label><label>Starts<input name="startsAt" type="datetime-local" defaultValue={toLocalInput(calendarEvent.startsAt)} required /></label><label>Ends<input name="endsAt" type="datetime-local" defaultValue={toLocalInput(calendarEvent.endsAt)} required /></label><div className="form-actions"><button className="button" type="submit" disabled={busy || !online}>Save event</button><button className="danger-text" type="button" disabled={busy || !online} onClick={() => submitEventDelete(calendarEvent)}>Delete event</button></div></form></details> : null}</div></article>)}</section> : <div className="board-tip"><span>EMPTY</span><p>No upcoming events.</p></div>}
      {canManage ? <form className="feature-panel inline-create" onSubmit={submitEvent}><span className="eyebrow">NEW EVENT</span><label>Event name<input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Robot practice" required /></label><label>Starts<input type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} required /></label><button className="button" disabled={busy} type="submit">{busy ? 'Saving…' : 'Add event'}</button></form> : null}

      <section className="split-panels">
        <TeamCalendarPanel teamId={teamId} canManage={canManage} online={online} />
      </section>

      <section className="split-panels">
        <article className="feature-panel"><span className="eyebrow">GOALS</span><h3>Team goals</h3><p>{data.goals.length ? 'Track milestones against completed tasks.' : 'No team goals yet.'}</p><div>{data.goals.map((goal) => <span id={`goal-${goal.id}`} tabIndex={-1} key={goal.id}>{goal.title} · {goal.completedTaskCount}/{goal.taskCount}</span>)}</div>{canManage ? <form className="inline-create" onSubmit={submitGoal}><label>New goal<input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Prepare for tournament" required /></label><button className="button" disabled={busy} type="submit">Add goal</button></form> : null}</article>

        <article className="feature-panel" aria-labelledby="storage-area-heading">
          <span className="eyebrow">TEAM FILES</span>
          <h3 id="storage-area-heading">Private team drive</h3>
          <p>Only approved, team-scoped files are available.</p>

          {!filesEnabled ? (
            <StatePanel
              variant="empty"
              title="Team file sharing is off"
              message="A coach must turn on team file sharing in Team admin before files can be uploaded or opened here."
            />
          ) : (
            <>
              {canManage ? (
                <div className="file-upload-controls">
                  <label className="button">Choose file<input className="visually-hidden" type="file" accept="application/pdf,text/plain,text/csv,application/zip,image/png,image/jpeg,image/webp" disabled={busy} onChange={selectFile} /></label>
                  {fileProgress !== null ? <button className="text-button" type="button" onClick={() => uploadAbort.current?.abort()}>Cancel upload</button> : null}
                </div>
              ) : <p>Coach access is required to upload files.</p>}
              {fileProgress !== null ? <p role="status">Uploading: {Math.round(fileProgress * 100)}%</p> : null}

              {filesState ? <StatePanel {...filesState} actionLabel="Retry" onAction={() => void loadFiles(null)} /> : null}
              {filesStatus === 'loading' && !files.length ? <StatePanel variant="loading" title="Loading team files" message="Fetching the most recent page of approved team files." /> : null}
              {filesStatus === 'ready' && !files.length ? <StatePanel variant="empty" title="No team files yet" message="Files a coach uploads appear here with their uploader and upload date." /> : null}

              {files.length ? (
                <ul className="team-file-list">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      id={`file-${file.id}`}
                      tabIndex={-1}
                      className={linkedFileId === file.id ? 'is-linked' : undefined}
                      aria-current={linkedFileId === file.id ? 'true' : undefined}
                    >
                      <div>
                        {file.downloadUrl
                          ? <a href={file.downloadUrl} target="_blank" rel="noreferrer">{file.name}</a>
                          : <strong>{file.name}</strong>}
                        <small>{formatFileSize(file.sizeBytes)} · {nameOf(directory, file.uploadedBy)} · {formatDate(file.createdAt)}</small>
                      </div>
                      {file.downloadUrl ? null : <small>Download link unavailable</small>}
                    </li>
                  ))}
                </ul>
              ) : null}

              {fileCursor ? <button className="button button--ghost" type="button" disabled={filesStatus === 'loading'} onClick={() => void loadFiles(fileCursor)}>{filesStatus === 'loading' ? 'Loading…' : 'Load more files'}</button> : null}
            </>
          )}
        </article>
      </section>
      <section className="chip-panel"><div><span className="eyebrow">NOTIFICATIONS</span><h3>Team updates</h3></div><div>{data.notifications.length ? data.notifications.map((notification) => <button key={notification.id} type="button" disabled={busy} onClick={() => void run(async () => { if (!notification.readAt) await markNotificationRead(teamId, notification.id); navigate(safeInternalRoute(notification.deepLink)); })}>{notification.title}{notification.readAt ? '' : ' · New'}</button>) : <span>No notifications</span>}</div></section>
    </div>
  );
}
