import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader } from '@/lib/domain';
import { listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import {
  UploadAbortedError,
  formatFileSize,
  getTeamFile,
  listTeamFiles,
  uploadTeamFile,
  type TeamFile
} from '@/lib/phase3-service';
import { formatRecordDate, loadFileSharing, type FileSharing } from '@/lib/coordination-data';
import { useOnlineStatus } from '@/lib/use-online-status';
import { createOperationId } from '@/lib/ids';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

/**
 * The private team drive. Kept on its own screen because file sharing is a team
 * policy decision, not part of running the board: a team with sharing off sees
 * one explanation here instead of a dead panel under its work.
 */
export function TeamFilesPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const [fileSharing, setFileSharing] = useState<FileSharing>('disabled');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [files, setFiles] = useState<TeamFile[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const generation = useRef(0);
  const uploadAbort = useRef<AbortController | null>(null);
  const currentTeamId = useRef(teamId);
  currentTeamId.current = teamId;
  const linkedFileId = searchParams.get('file');
  const directory = useMemo(() => memberMap(members), [members]);

  const loadFiles = useCallback(async (from: QueryDocumentSnapshot | null) => {
    const attempt = ++generation.current;
    if (!teamId) return;
    setStatus('loading');
    setRequestState(null);
    try {
      const sharing = await loadFileSharing(firestore, teamId);
      if (attempt !== generation.current) return;
      setFileSharing(sharing);
      if (sharing !== 'teamOnly') {
        setFiles([]);
        setStatus('ready');
        return;
      }
      const page = await listTeamFiles(firestore, teamId, from);
      if (attempt !== generation.current) return;
      setFiles((current) => {
        const next = from ? [...current, ...page.files] : page.files;
        return [...new Map(next.map((file) => [file.id, file])).values()];
      });
      setCursor(page.cursor);
      setStatus('ready');
    } catch (nextError) {
      if (attempt !== generation.current) return;
      setRequestState(getRequestState(nextError, online));
      setStatus('error');
    }
  }, [firestore, online, teamId]);

  useEffect(() => { void loadFiles(null); }, [loadFiles]);

  useEffect(() => {
    // Uploader names come from the server-side join; a failure degrades the
    // labels rather than the page.
    if (!teamId) return undefined;
    let active = true;
    void listTeamMembers(teamId)
      .then((roster) => { if (active) setMembers(roster.members); })
      .catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [teamId]);

  useEffect(() => {
    // A team switch must not let an in-flight upload finalize against the team
    // the user just left.
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    setProgress(null);
    setFiles([]);
    setCursor(null);
  }, [teamId]);
  useEffect(() => () => { uploadAbort.current?.abort(); }, []);

  useEffect(() => {
    // A `?file=<id>` deep link from search must resolve even when the file is
    // older than the first page.
    if (status !== 'ready' || !teamId || !linkedFileId || files.some((file) => file.id === linkedFileId)) return;
    const attempt = generation.current;
    void getTeamFile(firestore, teamId, linkedFileId)
      .then((file) => {
        if (attempt !== generation.current) return;
        if (!file) throw new Error('The linked file was not found in this team.');
        setFiles((current) => current.some((entry) => entry.id === file.id) ? current : [file, ...current]);
      })
      .catch((nextError: unknown) => { if (attempt === generation.current) setRequestState(getRequestState(nextError, online)); });
  }, [files, firestore, linkedFileId, online, status, teamId]);

  useEffect(() => {
    if (status !== 'ready' || !linkedFileId) return;
    const node = document.getElementById(`file-${linkedFileId}`);
    node?.scrollIntoView({ block: 'center' });
    node?.focus();
  }, [files, linkedFileId, status]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !teamId) return;
    // Clearing the input lets the same file be retried after a failure.
    event.target.value = '';
    const controller = new AbortController();
    uploadAbort.current?.abort();
    uploadAbort.current = controller;
    setProgress(0);
    setBusy(true);
    setRequestState(null);
    void (async () => {
      try {
        await uploadTeamFile({
          teamId,
          fileId: createOperationId(),
          file,
          signal: controller.signal,
          activeTeamId: () => currentTeamId.current,
          onProgress: (value) => { if (!controller.signal.aborted) setProgress(value); }
        });
        if (controller.signal.aborted || currentTeamId.current !== teamId) return;
        await loadFiles(null);
      } catch (nextError) {
        // A cancelled upload is a decision, not a failure, so it gets no error panel.
        if (nextError instanceof UploadAbortedError || controller.signal.aborted) return;
        setRequestState(getRequestState(nextError, online));
      } finally {
        if (uploadAbort.current === controller) uploadAbort.current = null;
        setProgress(null);
        setBusy(false);
      }
    })();
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading team files" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Team files become available after an active team membership is selected." />;

  return (
    <div className="reference-page monday">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Existing files may be stale, and uploads wait until you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Retry" onAction={() => void loadFiles(null)} autoFocus /> : null}

      <article className="feature-panel" aria-labelledby="storage-area-heading">
        <span className="eyebrow">TEAM FILES</span>
        <h3 id="storage-area-heading">Private team drive</h3>
        <p>Only approved, team-scoped files are available.</p>

        {fileSharing !== 'teamOnly' ? (
          <StatePanel
            variant="empty"
            title="Team file sharing is off"
            message="A coach must turn on team file sharing in Manage team → Administration before files can be uploaded or opened here."
          />
        ) : (
          <>
            {canManage ? (
              <div className="file-upload-controls">
                <label className="button">Choose file<input className="visually-hidden" type="file" accept="application/pdf,text/plain,text/csv,application/zip,image/png,image/jpeg,image/webp" disabled={busy} onChange={selectFile} /></label>
                {progress !== null ? <button className="text-button" type="button" onClick={() => uploadAbort.current?.abort()}>Cancel upload</button> : null}
              </div>
            ) : <p>Coach access is required to upload files.</p>}
            {progress !== null ? <p role="status">Uploading: {Math.round(progress * 100)}%</p> : null}

            {status === 'loading' && !files.length ? <StatePanel variant="loading" title="Loading team files" message="Fetching the most recent page of approved team files." /> : null}
            {status === 'ready' && !files.length ? <StatePanel variant="empty" title="No team files yet" message="Files a coach uploads appear here with their uploader and upload date." /> : null}

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
                      <small>{formatFileSize(file.sizeBytes)} · {nameOf(directory, file.uploadedBy)} · {formatRecordDate(file.createdAt)}</small>
                    </div>
                    {file.downloadUrl ? null : <small>Download link unavailable</small>}
                  </li>
                ))}
              </ul>
            ) : null}

            {cursor ? <button className="button button--ghost" type="button" disabled={status === 'loading'} onClick={() => void loadFiles(cursor)}>{status === 'loading' ? 'Loading…' : 'Load more files'}</button> : null}
          </>
        )}
      </article>
    </div>
  );
}
