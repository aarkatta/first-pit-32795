import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { STARTER_DEFINITION, currentSeasonLabel } from '@/lib/score-templates';
import { useAuth } from '@/lib/auth-context';
import { useOnlineStatus } from '@/lib/use-online-status';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { isCoachOrLeader } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import {
  calculateScoreTotal,
  correctScoreSession,
  createScoreDefinition,
  createScoreSession,
  exportScoreReport,
  getScoreSessionTarget,
  listScoreDefinitions,
  listScoreSessions,
  type AppliedDeduction,
  type EarnedMission,
  type ScoreDefinition,
  type ScoreSession,
  type ScoreStatistics,
  type ScoreType
} from '@/lib/phase6-service';
import { dateTimeInputValue, toDate } from '@/lib/dates';
import { listTeamMembers, type TeamMember } from '@/lib/directory';
import { createOperationId } from '@/lib/ids';

const emptyStats: ScoreStatistics = { count: 0, total: 0, average: 0, best: 0, completionRate: 0, missionTrends: {}, sessionTypeTrends: {} };

const id = createOperationId;

/** An unparseable stored date falls back to now so the form still opens on a usable value. */
function dateInput(value: unknown) {
  return dateTimeInputValue(value) || dateTimeInputValue(new Date());
}

function displayDate(value: unknown) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'No date';
}
function parseItems(value: string, kind: 'mission' | 'deduction') {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [rawId, rawName, rawMax] = line.split('|').map((part) => part.trim());
    return { id: rawId || `${kind}-${index + 1}`, name: rawName || `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`, maxPoints: Number(rawMax || 0) };
  }).filter((item) => item.maxPoints >= 0 && Number.isInteger(item.maxPoints));
}

export function ScorerPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const generation = useRef(0);
  const targetGeneration = useRef(0);
  const contextRef = useRef('');
  const sessionOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const [definitions, setDefinitions] = useState<ScoreDefinition[]>([]);
  const [sessions, setSessions] = useState<ScoreSession[]>([]);
  const [statistics, setStatistics] = useState(emptyStats);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [statisticsTruncated, setStatisticsTruncated] = useState(false);
  const [statisticsLimit, setStatisticsLimit] = useState(500);
  const [exportNotice, setExportNotice] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [rosterStatus, setRosterStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const rosterGeneration = useRef(0);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ scoreType: '' | ScoreType; fromDate: string; toDate: string }>({ scoreType: '', fromDate: '', toDate: '' });
  const [definitionForm, setDefinitionForm] = useState({ title: '', season: '', missions: 'mission-1|Example mission|10', deductions: '' });
  const applyStarterDefinition = () => setDefinitionForm({ title: STARTER_DEFINITION.title, season: currentSeasonLabel(), missions: STARTER_DEFINITION.missions, deductions: STARTER_DEFINITION.deductions });
  const [sessionForm, setSessionForm] = useState({ title: '', scoreType: 'practice' as ScoreType, sessionDate: dateTimeInputValue(new Date()), participantIds: [] as string[], notes: '', runTimeSeconds: '', robotProgramContext: '', missionPoints: {} as Record<string, string>, missionCompleted: {} as Record<string, boolean>, deductions: {} as Record<string, string> });
  const contextKey = `${user?.uid ?? ''}:${teamId ?? ''}`;
  contextRef.current = contextKey;

  const selectedDefinition = useMemo(() => definitions.find((definition) => definition.id === selectedDefinitionId) ?? definitions[0] ?? null, [definitions, selectedDefinitionId]);

  const refresh = useCallback(async () => {
    const refreshContext = `${user?.uid ?? ''}:${teamId ?? ''}`;
    if (contextRef.current !== refreshContext) return;
    if (!teamId || !user) return;
    const currentGeneration = ++generation.current;
    setStatus('loading');
    setError(null);
    try {
      const [definitionResult, sessionResult] = await Promise.all([
        listScoreDefinitions(teamId),
        listScoreSessions({ teamId, ...(filters.scoreType ? { scoreType: filters.scoreType } : {}), ...(filters.fromDate ? { fromDate: new Date(filters.fromDate).toISOString() } : {}), ...(filters.toDate ? { toDate: new Date(filters.toDate).toISOString() } : {}) })
      ]);
      if (currentGeneration !== generation.current || contextRef.current !== refreshContext) return;
      setDefinitions(definitionResult.definitions);
      setSelectedDefinitionId((current) => definitionResult.definitions.some((definition) => definition.id === current) ? current : definitionResult.definitions[0]?.id ?? '');
      setSessions(sessionResult.sessions);
      setStatistics(sessionResult.statistics);
      setHistoryTruncated(sessionResult.historyTruncated);
      setStatisticsTruncated(sessionResult.statisticsTruncated);
      setStatisticsLimit(sessionResult.statisticsLimit);
      setStatus('ready');
    } catch (nextError) {
      if (currentGeneration !== generation.current || contextRef.current !== refreshContext) return;
      setError(nextError instanceof Error ? nextError : new Error('Could not load scorer data.'));
      setStatus('error');
    }
  }, [filters.fromDate, filters.scoreType, filters.toDate, teamId, user]);

  useEffect(() => {
    generation.current += 1;
    targetGeneration.current += 1;
    sessionOperation.current = null;
    setDefinitions([]);
    setSessions([]);
    setStatistics(emptyStats);
    setHistoryTruncated(false);
    setStatisticsTruncated(false);
    setExportNotice('');
    setStatus('idle');
    setError(null);
    setRequestState(null);
    setBusy(false);
    setSelectedDefinitionId('');
    setEditingSessionId(null);
    setFilters({ scoreType: '', fromDate: '', toDate: '' });
    setDefinitionForm({ title: '', season: '', missions: 'mission-1|Example mission|10', deductions: '' });
    setSessionForm({ title: '', scoreType: 'practice', sessionDate: dateTimeInputValue(new Date()), participantIds: [], notes: '', runTimeSeconds: '', robotProgramContext: '', missionPoints: {}, missionCompleted: {}, deductions: {} });
  }, [contextKey]);
  // Participants are recorded by user id, so the form needs the roster to offer
  // names instead of asking a coach to type raw Firebase UIDs.
  useEffect(() => {
    const requestId = ++rosterGeneration.current;
    if (!teamId || !user) {
      setRoster([]);
      setRosterStatus('idle');
      return;
    }
    setRosterStatus('loading');
    void listTeamMembers(teamId).then((result) => {
      if (requestId !== rosterGeneration.current) return;
      setRoster(result.members.filter((member) => member.status === 'active'));
      setRosterStatus('ready');
    }).catch((nextError: unknown) => {
      if (requestId !== rosterGeneration.current) return;
      setRoster([]);
      setRosterStatus('error');
      setRequestState(getRequestState(nextError, online));
    });
  }, [online, teamId, user]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const sessionId = searchParams.get('session');
    const requestId = ++targetGeneration.current;
    if (!sessionId || !teamId || sessions.some((session) => session.id === sessionId)) return;
    void getScoreSessionTarget(firestore, teamId, sessionId).then((target) => {
      if (requestId === targetGeneration.current && contextRef.current === contextKey) setSessions((current) => current.some((session) => session.id === target.id) ? current : [target, ...current]);
    }).catch((nextError: unknown) => { if (requestId === targetGeneration.current && contextRef.current === contextKey) setRequestState(getRequestState(nextError, online)); });
  }, [contextKey, firestore, online, searchParams, sessions, teamId]);
  useEffect(() => {
    const sessionId = searchParams.get('session');
    if (!sessionId || !sessions.some((session) => session.id === sessionId)) return;
    const node = document.getElementById(`score-session-${sessionId}`);
    node?.scrollIntoView({ block: 'center' });
    node?.focus();
  }, [searchParams, sessions]);
  useEffect(() => {
    if (!selectedDefinition) return;
    setSessionForm((current) => ({ ...current, missionPoints: Object.fromEntries(selectedDefinition.missions.map((mission) => [mission.id, current.missionPoints[mission.id] ?? '0'])), deductions: Object.fromEntries(selectedDefinition.deductions.map((deduction) => [deduction.id, current.deductions[deduction.id] ?? '0'])) }));
  }, [selectedDefinition]);

  async function run(action: () => Promise<unknown>) {
    const actionContext = contextKey;
    if (contextRef.current !== actionContext) return;
    setBusy(true); setRequestState(null);
    try { await action(); if (contextRef.current === actionContext) await refresh(); }
    catch (nextError) { if (contextRef.current === actionContext) setRequestState(getRequestState(nextError, online)); }
    finally { if (contextRef.current === actionContext) setBusy(false); }
  }

  function submitDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !definitionForm.title.trim()) return;
    const actionContext = contextKey;
    void run(async () => { await createScoreDefinition({ teamId, title: definitionForm.title.trim(), season: definitionForm.season.trim(), missions: parseItems(definitionForm.missions, 'mission'), deductions: parseItems(definitionForm.deductions, 'deduction') }); if (contextRef.current === actionContext) setDefinitionForm({ title: '', season: '', missions: 'mission-1|Example mission|10', deductions: '' }); });
  }

  function formValues() {
    if (!selectedDefinition) return null;
    const missions: EarnedMission[] = selectedDefinition.missions.map((mission) => ({ missionId: mission.id, points: Number(sessionForm.missionPoints[mission.id] || 0), completed: sessionForm.missionCompleted[mission.id] === true }));
    const deductions: AppliedDeduction[] = selectedDefinition.deductions.map((deduction) => ({ deductionId: deduction.id, points: Number(sessionForm.deductions[deduction.id] || 0) })).filter((deduction) => deduction.points > 0);
    return { missions, deductions };
  }

  function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !selectedDefinition) return;
    const values = formValues();
    if (!values) return;
    const actionContext = contextKey;
    void run(async () => {
      const common = { teamId, title: sessionForm.title.trim() || `${sessionForm.scoreType[0].toUpperCase()}${sessionForm.scoreType.slice(1)} session`, scoreType: sessionForm.scoreType, sessionDate: new Date(sessionForm.sessionDate).toISOString(), missions: values.missions, deductions: values.deductions, notes: sessionForm.notes, participantUserIds: sessionForm.participantIds, runTimeSeconds: sessionForm.runTimeSeconds ? Number(sessionForm.runTimeSeconds) : null, robotProgramContext: sessionForm.robotProgramContext };
      if (editingSessionId) {
        const session = sessions.find((item) => item.id === editingSessionId);
        if (!session) return;
        await correctScoreSession({ ...common, sessionId: session.id, expectedVersion: session.version });
      } else {
        const fingerprint = JSON.stringify([selectedDefinition.id, common]);
        const operationId = sessionOperation.current?.fingerprint === fingerprint ? sessionOperation.current.id : id();
        sessionOperation.current = { fingerprint, id: operationId };
        await createScoreSession({ ...common, operationId, scoreDefinitionId: selectedDefinition.id });
        sessionOperation.current = null;
      }
      if (contextRef.current !== actionContext) return;
      setEditingSessionId(null);
      setSessionForm((current) => ({ ...current, title: '', notes: '', participantIds: [], runTimeSeconds: '', robotProgramContext: '', missionPoints: Object.fromEntries(selectedDefinition.missions.map((mission) => [mission.id, '0'])), missionCompleted: {}, deductions: Object.fromEntries(selectedDefinition.deductions.map((deduction) => [deduction.id, '0'])) }));
    });
  }

  function editSession(session: ScoreSession) {
    setSelectedDefinitionId(session.scoreDefinitionId);
    setEditingSessionId(session.id);
    setSessionForm({ title: session.title, scoreType: session.scoreType, sessionDate: dateInput(session.sessionDate), participantIds: session.participantUserIds, notes: session.notes, runTimeSeconds: session.runTimeSeconds?.toString() ?? '', robotProgramContext: session.robotProgramContext, missionPoints: Object.fromEntries(session.missions.map((mission) => [mission.missionId, String(mission.points)])), missionCompleted: Object.fromEntries(session.missions.map((mission) => [mission.missionId, mission.completed])), deductions: Object.fromEntries(session.deductions.map((deduction) => [deduction.deductionId, String(deduction.points)])) });
  }

  async function downloadExport() {
    if (!teamId) return;
    const actionContext = contextKey;
    const result = await exportScoreReport({ teamId, ...(filters.scoreType ? { scoreType: filters.scoreType } : {}), ...(filters.fromDate ? { fromDate: new Date(filters.fromDate).toISOString() } : {}), ...(filters.toDate ? { toDate: new Date(filters.toDate).toISOString() } : {}) });
    if (contextRef.current !== actionContext) return;
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename; anchor.click(); URL.revokeObjectURL(url);
    setExportNotice(result.truncated ? `Exported the newest ${result.count} matching sessions. Older records beyond the ${result.limit}-record safety limit were not included.` : `Exported ${result.count} matching session${result.count === 1 ? '' : 's'}.`);
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading scorer" message="Checking your active team membership before loading score history." />;
  if (!user || !teamId || teamStatus === 'idle') return <StatePanel variant="empty" title="Choose a team" message="Scoring history becomes available after an active team membership is selected." />;
  if (status === 'loading') return <StatePanel variant="loading" title="Loading scorer" message="Fetching team-defined scoring and a bounded page of practice and match history." />;
  if (status === 'error') return <StatePanel variant="error" title="Scorer could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus />;
  const previewTotal = formValues() ? calculateScoreTotal(formValues()!.missions, formValues()!.deductions) : 0;
  return <div className="page-stack">
    <section className="hero-grid"><article className="mission-card"><div><span className="eyebrow light">TEAM SCORER</span><h3>{activeTeam?.team?.name ?? 'Your team'} scoring</h3><p>Record practice and match sessions with team-defined missions, deductions, participants, and notes.</p></div><div className="mission-visual"><span>{statistics.best}</span><small>BEST SCORE</small><div className="mini-bot" aria-hidden="true">⌁</div></div></article><article className="score-card"><span className="eyebrow">MISSION COMPLETION</span><div className="ring" role="img" aria-label={`${Math.round(statistics.completionRate * 100)}% mission completion`} style={{ '--value': String(Math.round(statistics.completionRate * 100)) } as CSSProperties}><strong>{Math.round(statistics.completionRate * 100)}%</strong></div><p><b>{statistics.count}</b> recorded sessions</p></article></section>
    {!online ? <StatePanel variant="offline" title="You are offline" message="Score records may be stale. Reconnect before saving or exporting." /> : null}
    {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
    {exportNotice ? <StatePanel variant="success" title="Score export ready" message={exportNotice} actionLabel="Dismiss" onAction={() => setExportNotice('')} /> : null}
    <section className="split-panels">
      {canManage ? <article className="feature-panel"><span className="eyebrow">CONFIGURE SCORING</span><h3>Team definition</h3><p>New definitions are labeled team-defined. Use one line per item: <code>id|name|max points</code>.</p><p className="muted">Starting from scratch? <button className="text-button" type="button" onClick={applyStarterDefinition}>Load a starter robot-game rubric</button> and rename the missions to match this season.</p><form className="form-stack" onSubmit={submitDefinition}><label>Title<input value={definitionForm.title} onChange={(event) => setDefinitionForm({ ...definitionForm, title: event.target.value })} required /></label><label>Season<input value={definitionForm.season} onChange={(event) => setDefinitionForm({ ...definitionForm, season: event.target.value })} placeholder="2026-2027" required /></label><label>Missions<textarea value={definitionForm.missions} onChange={(event) => setDefinitionForm({ ...definitionForm, missions: event.target.value })} required /></label><label>Deductions<textarea value={definitionForm.deductions} onChange={(event) => setDefinitionForm({ ...definitionForm, deductions: event.target.value })} placeholder="penalty-1|Penalty|5" /></label><button className="button" type="submit" disabled={busy}>Add team-defined scoring</button></form></article> : null}
      <article className="feature-panel"><span className="eyebrow">SCORING DEFINITION</span><h3>Active season rules</h3>{definitions.length === 0 ? <p>No scoring definition yet. A coach or team leader can add one.</p> : <><label>Active definition<select value={selectedDefinition?.id ?? ''} onChange={(event) => { setSelectedDefinitionId(event.target.value); setEditingSessionId(null); }} >{definitions.map((definition) => <option key={definition.id} value={definition.id}>{definition.title} · {definition.sourceType === 'official-curated' ? 'Official curated' : 'Team-defined'}</option>)}</select></label><p>{selectedDefinition?.sourceLabel} · season {selectedDefinition?.season}</p></>}</article>
    </section>
    <section className="card"><div className="card-heading"><div><p className="eyebrow">{editingSessionId ? 'Correct session' : 'Record a session'}</p><h2>{editingSessionId ? 'Correction keeps an audit record' : 'Practice or match'}</h2></div>{editingSessionId ? <button className="text-button" type="button" onClick={() => setEditingSessionId(null)}>Cancel correction</button> : null}</div>{!selectedDefinition ? <p className="muted">Add a scoring definition first.</p> : <form className="form-stack" onSubmit={submitSession}><div className="content-grid"><label>Title<input value={sessionForm.title} onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })} placeholder="Saturday run" /></label><label>Type<select value={sessionForm.scoreType} onChange={(event) => setSessionForm({ ...sessionForm, scoreType: event.target.value as ScoreType })}><option value="practice">Practice</option><option value="match">Match</option></select></label><label>Date and time<input type="datetime-local" value={sessionForm.sessionDate} onChange={(event) => setSessionForm({ ...sessionForm, sessionDate: event.target.value })} required /></label><fieldset className="participant-picker"><legend>Participants</legend>{roster.length === 0 ? <p className="muted">{rosterStatus === 'loading' ? 'Loading teammates…' : 'No teammates are available to select yet.'}</p> : roster.map((member) => <label className="checkbox-label" key={member.userId}><input type="checkbox" checked={sessionForm.participantIds.includes(member.userId)} onChange={(event) => setSessionForm({ ...sessionForm, participantIds: event.target.checked ? [...sessionForm.participantIds, member.userId] : sessionForm.participantIds.filter((value) => value !== member.userId) })} /> {member.displayName}</label>)}<p className="muted">{sessionForm.participantIds.length} selected</p></fieldset></div><div className="content-grid"><div><p className="eyebrow">Missions</p>{selectedDefinition.missions.map((mission) => <div className="list-row" key={mission.id}><label>{mission.name} (0–{mission.maxPoints})<input type="number" min="0" max={mission.maxPoints} value={sessionForm.missionPoints[mission.id] ?? '0'} onChange={(event) => setSessionForm({ ...sessionForm, missionPoints: { ...sessionForm.missionPoints, [mission.id]: event.target.value } })} /></label><label className="checkbox-label"><input type="checkbox" checked={sessionForm.missionCompleted[mission.id] === true} onChange={(event) => setSessionForm({ ...sessionForm, missionCompleted: { ...sessionForm.missionCompleted, [mission.id]: event.target.checked } })} /> Complete</label></div>)}</div><div><p className="eyebrow">Deductions</p>{selectedDefinition.deductions.length === 0 ? <p className="muted">No deductions configured.</p> : selectedDefinition.deductions.map((deduction) => <label key={deduction.id}>{deduction.name} (0–{deduction.maxPoints})<input type="number" min="0" max={deduction.maxPoints} value={sessionForm.deductions[deduction.id] ?? '0'} onChange={(event) => setSessionForm({ ...sessionForm, deductions: { ...sessionForm.deductions, [deduction.id]: event.target.value } })} /></label>)}</div></div><div className="content-grid"><label>Notes<textarea value={sessionForm.notes} onChange={(event) => setSessionForm({ ...sessionForm, notes: event.target.value })} maxLength={4000} /></label><div><label>Run time (seconds)<input type="number" min="0" max="3600" value={sessionForm.runTimeSeconds} onChange={(event) => setSessionForm({ ...sessionForm, runTimeSeconds: event.target.value })} /></label><label>Robot/program context<input value={sessionForm.robotProgramContext} onChange={(event) => setSessionForm({ ...sessionForm, robotProgramContext: event.target.value })} /></label></div></div><p className="score-total" aria-live="polite">Calculated total: <strong>{previewTotal}</strong> points</p><button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : editingSessionId ? 'Save correction' : 'Record session'}</button></form>}</section>
    <section className="content-grid"><article className="card"><p className="eyebrow">Bounded statistics</p><p className="muted">Calculated across up to the newest {statisticsLimit} matching sessions.{statisticsTruncated ? ` Older records beyond that limit are not included.` : ''}</p><div className="stats-grid"><div><strong>{statistics.count}{statisticsTruncated ? '+' : ''}</strong><span>sessions in scope</span></div><div><strong>{statistics.average.toFixed(1)}</strong><span>average</span></div><div><strong>{statistics.best}</strong><span>best</span></div><div><strong>{Math.round(statistics.completionRate * 100)}%</strong><span>mission completion</span></div></div></article><article className="card"><p className="eyebrow">Authorized export</p><p className="muted">CSV contains up to the newest {statisticsLimit} matching sessions for this team and reports when older records were omitted.</p>{canManage ? <button className="button button--ghost" type="button" disabled={busy || !online} onClick={() => void run(downloadExport)}>Download CSV report</button> : <p className="muted">Coach access required.</p>}</article></section>
    <section className="card"><div className="card-heading"><div><p className="eyebrow">Score history</p><h2>{sessions.length} recent record(s){historyTruncated ? ' shown' : ''}</h2>{historyTruncated ? <p className="muted">This page shows the newest 50 records. Statistics and export use a separate, larger bounded scope.</p> : null}</div><div className="hero-actions"><select aria-label="Filter score type" value={filters.scoreType} onChange={(event) => setFilters({ ...filters, scoreType: event.target.value as '' | ScoreType })}><option value="">All types</option><option value="practice">Practice</option><option value="match">Match</option></select><button className="button button--ghost" type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button></div></div>{sessions.length === 0 ? <p className="muted">No scores match the current filters.</p> : <div className="list">{sessions.map((session) => <article id={`score-session-${session.id}`} tabIndex={-1} className="list-row" key={session.id}><span><strong>{session.title} · {session.totalPoints} points</strong><small>{session.scoreType} · {displayDate(session.sessionDate)} · {session.scoringSourceType === 'official-curated' ? 'Official curated' : 'Team-defined'} · {session.participantUserIds.length} participant(s)</small></span>{canManage ? <button className="text-button" type="button" disabled={busy} onClick={() => editSession(session)}>Correct</button> : null}</article>)}</div>}</section>
  </div>;
}
