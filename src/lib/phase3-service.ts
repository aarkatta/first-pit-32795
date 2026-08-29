import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Firestore,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import { getFirebaseServices } from './firebase';
import { call } from './callable';


export type TaskMutationInput = {
  teamId: string;
  operationId: string;
  taskId?: string;
  title: string;
  description?: string;
  status?: 'todo' | 'inProgress' | 'review' | 'completed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string | null;
  watcherUserIds?: string[];
  goalId?: string | null;
  labels?: string[];
  checklist?: Array<{ id: string; label: string; completed: boolean }>;
  dueAt?: string | null;
};

export function createTask(input: TaskMutationInput) {
  return call<TaskMutationInput, { taskId: string }>('createTask', input);
}

export function updateTask(input: { teamId: string; taskId: string; operationId: string; expectedVersion?: number; status?: TaskMutationInput['status']; checklist?: TaskMutationInput['checklist']; comment?: string; title?: string; description?: string; priority?: TaskMutationInput['priority']; assignedTo?: string | null; watcherUserIds?: string[]; goalId?: string | null; labels?: string[]; dueAt?: string | null }) {
  return call<typeof input, { taskId: string; version: number }>('updateTask', input);
}

/** A goal written before versions existed counts as version 1. */
export function goalVersion(goal: { version?: number } | null | undefined): number {
  const version = Math.trunc(Number(goal?.version ?? 1));
  return Number.isSafeInteger(version) && version >= 1 ? version : 1;
}

export function createGoal(input: { teamId: string; goalId?: string; operationId: string; title: string; description?: string; dueAt?: string | null }) {
  return call<typeof input, { goalId: string }>('createGoal', input);
}

/**
 * Goal edits carry the same idempotency receipt and optimistic-concurrency check as
 * task edits: without `operationId` a retried call applied the change twice, and
 * without `expectedVersion` two coaches editing one goal silently overwrote each
 * other. The server now requires `expectedVersion`; a goal written before versions
 * existed stores none, so read it through `goalVersion` and send 1.
 */
export function updateGoal(input: { teamId: string; goalId: string; operationId: string; expectedVersion: number; title?: string; description?: string; status?: 'active' | 'completed' | 'archived'; dueAt?: string | null }) {
  return call<typeof input, { goalId: string; version: number }>('updateGoal', input);
}

export function createEvent(input: { teamId: string; eventId?: string; operationId: string; title: string; description?: string; startsAt: string; endsAt: string; location?: string | null; eventType?: 'meeting' | 'practice' | 'competition' | 'deadline' | 'reminder'; recurrence?: { frequency: 'weekly' | 'monthly'; interval: number; count?: number; until?: string }; reminderMinutes?: number[]; linkedTaskIds?: string[] }) {
  return call<typeof input, { eventId: string; recurring: boolean }>('createEvent', input);
}

export function markNotificationRead(teamId: string, notificationId: string) {
  return call<{ teamId: string; notificationId: string }, { notificationId: string; read: true }>('markNotificationRead', { teamId, notificationId });
}

export function createFileMetadata(input: { teamId: string; fileId: string; name: string; contentType: string; sizeBytes: number; folderId?: string | null; linkedTaskIds?: string[] }) {
  return call<typeof input, { fileId: string; storagePath: string; maxBytes: number }>('createFileMetadata', input);
}

export function completeFileUpload(teamId: string, fileId: string) {
  // The server also reports the audit receipt and moves the malware scan from
  // `pending` to `clean` as it finalizes, so both belong in the response type.
  return call<{ teamId: string; fileId: string }, { fileId: string; status: 'ready'; scanStatus: 'clean'; auditEventId: string }>('completeFileUpload', { teamId, fileId });
}

export function linkFileToTask(teamId: string, fileId: string, taskId: string) {
  return call<{ teamId: string; fileId: string; taskId: string }, { fileId: string; taskId: string }>('linkFileToTask', { teamId, fileId, taskId });
}

/* ------------------------------------------------------------------ *
 * Storage Area reads
 * ------------------------------------------------------------------ */

export const TEAM_FILE_PAGE_SIZE = 20;

/** Attachments are read one document at a time, so the cap keeps a malformed card bounded. */
export const MAX_TASK_ATTACHMENTS = 10;

export type TeamFile = {
  id: string;
  teamId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  status: string;
  uploadedBy: string;
  folderId: string | null;
  linkedTaskIds: string[];
  createdAt?: unknown;
  /** Resolved lazily from Storage; null when the download URL could not be signed. */
  downloadUrl: string | null;
};

/** Human file size for the Storage Area and card attachments. */
export function formatFileSize(sizeBytes: number): string {
  const bytes = Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseTeamFile(id: string, data: Record<string, unknown>): TeamFile {
  return {
    id,
    teamId: String(data.teamId ?? ''),
    name: String(data.name ?? 'Untitled file'),
    contentType: String(data.contentType ?? 'application/octet-stream'),
    sizeBytes: Number(data.sizeBytes ?? 0),
    storagePath: String(data.storagePath ?? ''),
    status: String(data.status ?? 'pending'),
    uploadedBy: String(data.uploadedBy ?? data.createdBy ?? ''),
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    linkedTaskIds: Array.isArray(data.linkedTaskIds) ? data.linkedTaskIds.map(String) : [],
    createdAt: data.createdAt,
    downloadUrl: null
  };
}

/**
 * `fileMetadata` is deny-by-default and the list rule only clears documents whose
 * `status` is `ready`, so the status equality filter is part of the authorization
 * contract rather than a convenience — a query without it is rejected outright.
 */
export function buildTeamFilesQuery(firestore: Firestore, teamId: string, cursor?: QueryDocumentSnapshot | null) {
  const constraints = [
    where('teamId', '==', teamId),
    where('status', '==', 'ready'),
    orderBy('createdAt', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(TEAM_FILE_PAGE_SIZE)
  ];
  return query(collection(firestore, 'fileMetadata'), ...constraints);
}

export function teamFileDownloadUrl(storagePath: string, storage?: FirebaseStorage) {
  const services = getFirebaseServices();
  return getDownloadURL(ref(storage ?? services.storage, storagePath));
}

/** A missing or unreadable object must not take the whole list down, so each URL fails soft. */
export async function withDownloadUrls(files: TeamFile[], storage?: FirebaseStorage): Promise<TeamFile[]> {
  return Promise.all(files.map(async (file) => ({
    ...file,
    downloadUrl: file.storagePath ? await teamFileDownloadUrl(file.storagePath, storage).catch(() => null) : null
  })));
}

export async function listTeamFiles(firestore: Firestore, teamId: string, cursor?: QueryDocumentSnapshot | null, storage?: FirebaseStorage) {
  const snapshot = await getDocs(buildTeamFilesQuery(firestore, teamId, cursor));
  const files = await withDownloadUrls(snapshot.docs.map((document) => parseTeamFile(document.id, document.data() as Record<string, unknown>)), storage);
  return {
    files,
    cursor: snapshot.docs.length === TEAM_FILE_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null
  };
}

/**
 * Deep links and card attachments address one file at a time. A `get` is checked
 * against the stored document instead of the query shape, so it needs no index and
 * no status filter — but it can also be denied, which is a skip rather than a failure.
 */
export async function getTeamFile(firestore: Firestore, teamId: string, fileId: string, storage?: FirebaseStorage): Promise<TeamFile | null> {
  const snapshot = await getDoc(doc(firestore, 'fileMetadata', fileId));
  if (!snapshot.exists()) return null;
  const file = parseTeamFile(snapshot.id, snapshot.data() as Record<string, unknown>);
  if (file.teamId !== teamId) return null;
  const [resolved] = await withDownloadUrls([file], storage);
  return resolved;
}

export async function getTeamFilesByIds(firestore: Firestore, teamId: string, fileIds: string[], storage?: FirebaseStorage): Promise<TeamFile[]> {
  const bounded = [...new Set(fileIds.filter(Boolean))].slice(0, MAX_TASK_ATTACHMENTS);
  const results = await Promise.all(bounded.map((fileId) => getTeamFile(firestore, teamId, fileId, storage).catch(() => null)));
  return results.filter((file): file is TeamFile => file !== null);
}

/* ------------------------------------------------------------------ *
 * Uploads
 * ------------------------------------------------------------------ */

export class UploadAbortedError extends Error {
  constructor(message = 'The upload was cancelled.') {
    super(message);
    this.name = 'UploadAbortedError';
  }
}

export type UploadTeamFileInput = {
  teamId: string;
  fileId: string;
  file: File;
  linkedTaskIds?: string[];
  folderId?: string | null;
  onProgress?: (progress: number) => void;
  /** Aborting cancels the resumable upload and stops further progress callbacks. */
  signal?: AbortSignal;
  /** The team that is active *now*. Finalizing against a team the user has left is refused. */
  activeTeamId?: () => string | null;
};

/**
 * The upload runs in three steps against one team: reserve metadata, push bytes,
 * finalize. A team switch or an unmount between steps must not keep reporting
 * progress into a dead screen, and must never finalize a file against a team the
 * user is no longer looking at — so the caller owns an `AbortSignal` and tells us
 * which team is active before the finalize call.
 */
export async function uploadTeamFile(input: UploadTeamFileInput, storage?: FirebaseStorage) {
  const services = getFirebaseServices();
  if (input.signal?.aborted) throw new UploadAbortedError();
  const metadata = await createFileMetadata({ teamId: input.teamId, fileId: input.fileId, name: input.file.name, contentType: input.file.type, sizeBytes: input.file.size, linkedTaskIds: input.linkedTaskIds, folderId: input.folderId });
  if (input.signal?.aborted) throw new UploadAbortedError();
  const upload = uploadBytesResumable(ref(storage ?? services.storage, metadata.storagePath), input.file, { contentType: input.file.type });
  const cancel = () => upload.cancel();
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      upload.on(
        'state_changed',
        (snapshot) => {
          if (input.signal?.aborted) return;
          input.onProgress?.(snapshot.totalBytes === 0 ? 0 : snapshot.bytesTransferred / snapshot.totalBytes);
        },
        reject,
        resolve
      );
    });
  } catch (error) {
    if (input.signal?.aborted) throw new UploadAbortedError();
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
  if (input.signal?.aborted) throw new UploadAbortedError();
  const activeTeamId = input.activeTeamId ? input.activeTeamId() : input.teamId;
  if (activeTeamId !== input.teamId) {
    throw new UploadAbortedError('The active team changed during the upload, so the file was not added.');
  }
  return completeFileUpload(input.teamId, input.fileId);
}
