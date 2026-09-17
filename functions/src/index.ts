import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest, type CallableRequest, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import {
  assertTeamMemberInTransaction,
  DEFAULT_TEAM_POLICY,
  encodedInvitationId,
  expiryTimestamp,
  getInput,
  requireAssignableRole,
  requireAuth as requireCallableAuth,
  requireEmail,
  requireMembershipStatus,
  requireString,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember,
  validatePolicy,
  validateReportInput,
  assertNotLastCoach,
  auditRecord
} from './phase2.js';
import {
  completeFileUpload as completeFileUploadCommand,
  createFileMetadata as createFileMetadataCommand,
  createGoal as createGoalCommand,
  createTask as createTaskCommand,
  linkFileToTask as linkFileToTaskCommand,
  markNotificationRead as markNotificationReadCommand,
  updateGoal as updateGoalCommand,
  updateTask as updateTaskCommand
} from './phase3.js';
import {
  addProjectColumn as addProjectColumnCommand,
  archiveProject as archiveProjectCommand,
  createKanbanTask as createKanbanTaskCommand,
  createProject as createProjectCommand,
  ensureDefaultProject as ensureDefaultProjectCommand,
  moveTaskCard as moveTaskCardCommand,
  removeProjectColumn as removeProjectColumnCommand,
  reorderProjectColumns as reorderProjectColumnsCommand,
  updateProject as updateProjectCommand,
  updateProjectCategories as updateProjectCategoriesCommand,
  updateProjectColumn as updateProjectColumnCommand,
  withBoardErrors
} from './kanban.js';
import {
  createProjectFromTemplate as createProjectFromTemplateCommand,
  deleteProjectTemplate as deleteProjectTemplateCommand,
  listProjectTemplates as listProjectTemplatesCommand,
  saveProjectAsTemplate as saveProjectAsTemplateCommand
} from './kanban-templates.js';
import { importProjectTasks as importProjectTasksCommand, resolveImportAssignees as resolveImportAssigneesCommand } from './task-import.js';
import {
  acceptAnswer as acceptAnswerCommand,
  closePoll as closePollCommand,
  createAnswer as createAnswerCommand,
  createPoll as createPollCommand,
  createQuestion as createQuestionCommand,
  createQuestionComment as createQuestionCommentCommand,
  createVideo as createVideoCommand,
  getPollResults as getPollResultsCommand,
  listPolls as listPollsCommand,
  recordVideoWatch as recordVideoWatchCommand,
  searchQuestions as searchQuestionsCommand,
  searchVideos as searchVideosCommand,
  toggleSavedQuestion as toggleSavedQuestionCommand,
  toggleVideoFavorite as toggleVideoFavoriteCommand,
  updateVideoPublication as updateVideoPublicationCommand,
  votePoll as votePollCommand,
  voteQuestion as voteQuestionCommand
} from './phase5.js';
import {
  correctScoreSession as correctScoreSessionCommand,
  createScoreDefinition as createScoreDefinitionCommand,
  createScoreSession as createScoreSessionCommand,
  exportScoreReport as exportScoreReportCommand,
  listScoreDefinitions as listScoreDefinitionsCommand,
  listScoreSessions as listScoreSessionsCommand
} from './phase6.js';
import { getDashboard as getDashboardCommand, globalSearch as globalSearchCommand, updateProfileSettings as updateProfileSettingsCommand } from './phase7.js';

if (getApps().length === 0) {
  initializeApp();
}

const defaultAllowedOrigins = ['http://localhost:5173', 'http://localhost:4173'];

function getAllowedOrigins(value = process.env.FIRST_PIT_ALLOWED_ORIGINS): string[] {
  if (!value) {
    return defaultAllowedOrigins;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('FIRST_PIT_ALLOWED_ORIGINS must contain at least one origin');
  }

  for (const origin of origins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }

  return origins;
}

const allowedOrigins = getAllowedOrigins();

function applyCors(req: Request, res: Response): boolean {
  const origin = req.get('origin');

  if (!origin) {
    return true;
  }

  if (!allowedOrigins.includes(origin)) {
    res.status(403).json({
      ok: false,
      error: 'Origin is not allowed.'
    });
    return false;
  }

  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'GET');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Max-Age', '3600');
  res.set('Vary', 'Origin');
  return true;
}

function normalizedTeamName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const createTeam = onCall(async (request: CallableRequest<{ name?: unknown }>) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required to create a team.');
  }

  const name = typeof request.data?.name === 'string' ? request.data.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 80) {
    throw new HttpsError('invalid-argument', 'Team name must be between 2 and 80 characters.');
  }

  const db = getFirestore();
  const auth = request.auth;
  const uid = auth.uid;
  const teamRef = db.collection('teams').doc();
  const membershipRef = db.collection('memberships').doc(`${teamRef.id}_${uid}`);
  const auditRef = db.collection('auditEvents').doc();
  const userRef = db.doc(`users/${uid}`);
  const notificationPreferencesRef = db.doc(`notificationPreferences/${uid}`);
  const privacySettingsRef = db.doc(`privacySettings/${uid}`);
  const now = FieldValue.serverTimestamp();
  const email = auth.token.email ?? null;
  const displayName = auth.token.name ?? (typeof email === 'string' ? email.split('@')[0] : 'Team coach');

  await db.runTransaction(async (transaction) => {
    const [userSnapshot, notificationPreferencesSnapshot, privacySettingsSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(notificationPreferencesRef),
      transaction.get(privacySettingsRef)
    ]);
    transaction.set(teamRef, {
      name,
      normalizedName: normalizedTeamName(name),
      createdBy: uid,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(membershipRef, {
      teamId: teamRef.id,
      userId: uid,
      role: 'coach',
      status: 'active',
      createdAt: now,
      updatedAt: now
    });
    transaction.set(userRef, {
      uid,
      email,
      displayName,
      photoURL: auth.token.picture ?? null,
      updatedAt: now,
      ...(userSnapshot.exists ? {} : { createdAt: now })
    }, { merge: true });
    transaction.set(db.doc(`teamPolicies/${teamRef.id}`), {
      teamId: teamRef.id,
      ...DEFAULT_TEAM_POLICY,
      updatedAt: now
    });
    if (!notificationPreferencesSnapshot.exists) {
      transaction.set(notificationPreferencesRef, {
        userId: uid,
        emailNotifications: true,
        pushNotifications: false,
        safetyNotifications: true,
        updatedAt: now
      });
    }
    if (!privacySettingsSnapshot.exists) {
      transaction.set(privacySettingsRef, {
        userId: uid,
        profileVisibility: 'teamOnly',
        searchable: false,
        allowParentVisibility: false,
        privateConversations: false,
        updatedAt: now
      });
    }
    transaction.set(auditRef, auditRecord({
      type: 'team.created',
      actorUserId: uid,
      teamId: teamRef.id,
      targetResource: `teams/${teamRef.id}`,
      metadata: { role: 'coach' }
    }));
  });

  return { teamId: teamRef.id, auditEventId: auditRef.id };
});

type Phase2Request = CallableRequest<Record<string, unknown>>;

function phase2Data(request: Phase2Request) {
  return request.data ?? {};
}

/**
 * Phase 2 idempotency receipts.
 *
 * Invitations, role changes, membership lifecycle, and leadership transfer are
 * exactly the mutations that write an immutable `auditEvents` record. Without a
 * receipt a retried call writes a SECOND audit event for the same action, which
 * corrupts the moderation trail the audit log exists to provide. The receipt is
 * written inside the same transaction as the change, so replay and commit can
 * never disagree.
 */
function phase2OperationRef(request: Phase2Request, teamId: string, kind: string) {
  const operationId = requireString(getInput(request, 'operationId'), 'Operation ID', 120);
  return getFirestore().doc(`phase2Operations/${teamId}_${kind}_${operationId}`);
}

export function phase2OperationReceipt(
  receipt: Record<string, unknown>,
  expected: { teamId: string; actorUserId: string; kind: string }
): Record<string, unknown> {
  if (receipt.teamId !== expected.teamId || receipt.createdBy !== expected.actorUserId || receipt.kind !== expected.kind) {
    throw new HttpsError('failed-precondition', 'This operation ID belongs to a different team operation.');
  }
  return receipt;
}

async function requireTeamDocument(teamId: string) {
  const snapshot = await getFirestore().doc(`teams/${teamId}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'The team could not be found.');
  return snapshot;
}

async function assertAdminInTransaction(transaction: FirebaseFirestore.Transaction, teamId: string, uid: string, platformAdmin: boolean) {
  if (platformAdmin) return;
  const snapshot = await transaction.get(getFirestore().doc(`memberships/${teamId}_${uid}`));
  const data = snapshot.data();
  if (!snapshot.exists || data?.teamId !== teamId || data.userId !== uid || data.status !== 'active' || !['coach', 'teamLeader'].includes(data.role)) {
    throw new HttpsError('permission-denied', 'Your team-admin access changed. Refresh and try again.');
  }
}

async function activeCoachCount(transaction: FirebaseFirestore.Transaction, teamId: string) {
  const snapshot = await transaction.get(
    getFirestore().collection('memberships')
      .where('teamId', '==', teamId)
      .where('status', '==', 'active')
      .where('role', 'in', ['coach', 'teamLeader'])
  );
  return snapshot.size;
}

export const createInvitation = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const team = await requireTeamDocument(teamId);
  // An invitee has no membership yet, so `teams/{teamId}` is unreadable to them
  // (firestore.rules) while the invitation document is. Denormalizing the name
  // is what lets the acceptance screen say which team invited them.
  const teamName = requireString(team.data()?.name ?? 'Your team', 'Team name', 80);
  const email = requireEmail(getInput(request, 'email'));
  const role = requireAssignableRole(getInput(request, 'role') ?? 'student');
  const db = getFirestore();
  const invitationId = encodedInvitationId(teamId, email);
  const invitationRef = db.doc(`invitations/${invitationId}`);
  let targetUserId: string | undefined;
  try {
    targetUserId = (await getAuth().getUserByEmail(email)).uid;
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw new HttpsError('internal', 'The invitation could not be verified.');
  }
  const targetMembershipRef = targetUserId ? db.doc(`memberships/${teamId}_${targetUserId}`) : null;
  const operationRef = phase2OperationRef(request, teamId, 'invitation.create');
  const now = FieldValue.serverTimestamp();

  const committedInvitationId = await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    // The receipt is checked before the duplicate-invitation guard: a retry of a
    // SUCCESSFUL invite would otherwise fail as `already-exists`.
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const receipt = phase2OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: 'invitation.create' });
      return requireString(receipt.invitationId, 'Stored invitation ID');
    }
    const existingInvitation = await transaction.get(invitationRef);
    const existing = existingInvitation.data();
    if (existingInvitation.exists && existing?.status === 'pending') {
      throw new HttpsError('already-exists', 'A pending invitation already exists for this email.');
    }
    if (targetMembershipRef) {
      const targetMembership = await transaction.get(targetMembershipRef);
      if (targetMembership.exists && ['active', 'pending'].includes(String(targetMembership.data()?.status))) {
        throw new HttpsError('already-exists', 'This email already has a membership or pending membership for the team.');
      }
    }
    transaction.set(invitationRef, {
      teamId,
      teamName,
      email,
      ...(targetUserId ? { targetUserId } : {}),
      role,
      invitedBy: admin.uid,
      status: 'pending',
      expiresAt: expiryTimestamp(),
      createdAt: existingInvitation.exists ? existing?.createdAt ?? now : now,
      updatedAt: now
    });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'invitation.created', actorUserId: admin.uid, teamId,
      targetResource: `invitations/${invitationId}`, metadata: { role }
    }));
    transaction.set(operationRef, { teamId, createdBy: admin.uid, kind: 'invitation.create', invitationId, createdAt: now });
    return invitationId;
  });

  return { invitationId: committedInvitationId };
});

export const revokeInvitation = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const invitationId = requireString(getInput(request, 'invitationId'), 'Invitation ID');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const invitationRef = db.doc(`invitations/${invitationId}`);
    const invitation = await transaction.get(invitationRef);
    if (!invitation.exists || invitation.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Invitation not found.');
    if (invitation.data()?.status !== 'pending') return;
    transaction.update(invitationRef, { status: 'revoked', updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'membership.changed', actorUserId: admin.uid, teamId,
      targetResource: `invitations/${invitationId}`, metadata: { status: 'revoked' }
    }));
  });
  return { invitationId, status: 'revoked' as const };
});

export const acceptInvitation = onCall(async (request: Phase2Request) => {
  const auth = requireCallableAuth(request);
  if (request.auth?.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address before accepting an email invitation.');
  }
  const invitationId = requireString(getInput(request, 'invitationId'), 'Invitation ID');
  const db = getFirestore();
  const invitationRef = db.doc(`invitations/${invitationId}`);
  const result = await db.runTransaction(async (transaction) => {
    const invitation = await transaction.get(invitationRef);
    const data = invitation.data();
    if (!invitation.exists || !data || data.status !== 'pending') throw new HttpsError('not-found', 'This invitation is no longer available.');
    if (typeof data.expiresAt?.toMillis === 'function' && data.expiresAt.toMillis() < Date.now()) {
      transaction.update(invitationRef, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
      return { status: 'expired' as const };
    }
    if (String(data.email).toLowerCase() !== String(request.auth?.token.email ?? '').toLowerCase()) {
      throw new HttpsError('permission-denied', 'This invitation was sent to a different email address.');
    }
    if (typeof data.targetUserId === 'string' && data.targetUserId !== auth.uid) {
      throw new HttpsError('permission-denied', 'This invitation belongs to a different account.');
    }
    const teamId = requireString(data.teamId, 'Team ID');
    const membershipRef = db.doc(`memberships/${teamId}_${auth.uid}`);
    const membership = await transaction.get(membershipRef);
    const now = FieldValue.serverTimestamp();
    transaction.set(membershipRef, {
      teamId, userId: auth.uid, role: data.role, status: 'active', createdAt: membership.exists ? membership.data()?.createdAt ?? now : now, updatedAt: now
    });
    transaction.update(invitationRef, { status: 'accepted', acceptedBy: auth.uid, acceptedAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'membership.changed', actorUserId: auth.uid, teamId, targetUserId: auth.uid,
      metadata: { role: String(data.role), status: 'active' }
    }));
    return { status: 'accepted' as const, teamId };
  });
  if (result.status === 'expired') throw new HttpsError('failed-precondition', 'This invitation has expired.');
  return { teamId: result.teamId };
});

export const requestToJoinTeam = onCall(async (request: Phase2Request) => {
  const auth = requireCallableAuth(request);
  const teamId = requireTeamId(request);
  const db = getFirestore();
  await requireTeamDocument(teamId);
  const requestId = `${teamId}_${auth.uid}`;
  const requestRef = db.doc(`joinRequests/${requestId}`);
  const membershipRef = db.doc(`memberships/${requestId}`);
  const policyRef = db.doc(`teamPolicies/${teamId}`);
  const profileRef = db.doc(`users/${auth.uid}`);
  await db.runTransaction(async (transaction) => {
    const policySnapshot = await transaction.get(policyRef);
    if (policySnapshot.data()?.membershipApproval !== 'coachApproval') {
      throw new HttpsError('permission-denied', 'This team accepts members by invitation only.');
    }
    const existingRequest = await transaction.get(requestRef);
    const existingMembership = await transaction.get(membershipRef);
    if (existingMembership.exists && ['active', 'pending'].includes(String(existingMembership.data()?.status))) {
      throw new HttpsError('already-exists', 'You already have a membership or pending request for this team.');
    }
    if (existingRequest.exists && existingRequest.data()?.status === 'pending') {
      throw new HttpsError('already-exists', 'A join request is already pending.');
    }
    // A requester has no membership doc yet, so the coach's approval queue cannot
    // resolve their name through listTeamMembers. Denormalizing the display name
    // is what keeps the queue from reading "New applicant · abc123…".
    const profile = await transaction.get(profileRef);
    const profileName = typeof profile.data()?.displayName === 'string' ? String(profile.data()?.displayName).trim() : '';
    const tokenName = typeof request.auth?.token.name === 'string' ? request.auth.token.name.trim() : '';
    const displayName = (profileName || tokenName || 'New applicant').slice(0, 80);
    const now = FieldValue.serverTimestamp();
    transaction.set(requestRef, { teamId, userId: auth.uid, displayName, requestedRole: 'student', status: 'pending', createdAt: existingRequest.data()?.createdAt ?? now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'membership.changed', actorUserId: auth.uid, teamId, targetUserId: auth.uid, metadata: { status: 'pending' }
    }));
  });
  return { requestId };
});

export const approveJoinRequest = onCall(async (request: Phase2Request) => {
  const requestId = requireString(getInput(request, 'requestId'), 'Join request ID');
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const requestRef = db.doc(`joinRequests/${requestId}`);
    const requestSnapshot = await transaction.get(requestRef);
    const requestData = requestSnapshot.data();
    if (!requestSnapshot.exists || requestData?.teamId !== teamId || requestData.status !== 'pending') throw new HttpsError('not-found', 'Join request is not pending.');
    const userId = requireString(requestData.userId, 'User ID');
    const membershipRef = db.doc(`memberships/${teamId}_${userId}`);
    const membership = await transaction.get(membershipRef);
    if (membership.exists && membership.data()?.status === 'active') throw new HttpsError('already-exists', 'This user is already an active member.');
    const now = FieldValue.serverTimestamp();
    transaction.set(membershipRef, { teamId, userId, role: 'student', status: 'active', createdAt: membership.data()?.createdAt ?? now, updatedAt: now });
    transaction.update(requestRef, { status: 'approved', reviewedBy: admin.uid, reviewedAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'membership.changed', actorUserId: admin.uid, teamId, targetUserId: userId, metadata: { status: 'approved', role: 'student' } }));
  });
  return { requestId, status: 'approved' as const };
});

export const rejectJoinRequest = onCall(async (request: Phase2Request) => {
  const requestId = requireString(getInput(request, 'requestId'), 'Join request ID');
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const requestRef = db.doc(`joinRequests/${requestId}`);
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists || requestSnapshot.data()?.teamId !== teamId || requestSnapshot.data()?.status !== 'pending') throw new HttpsError('not-found', 'Join request is not pending.');
    const now = FieldValue.serverTimestamp();
    transaction.update(requestRef, { status: 'rejected', reviewedBy: admin.uid, reviewedAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'membership.changed', actorUserId: admin.uid, teamId, targetUserId: String(requestSnapshot.data()?.userId), metadata: { status: 'rejected' } }));
  });
  return { requestId, status: 'rejected' as const };
});

export const assignTeamRole = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const userId = requireString(getInput(request, 'userId'), 'User ID');
  const role = requireAssignableRole(getInput(request, 'role'));
  const db = getFirestore();
  const operationRef = phase2OperationRef(request, teamId, 'role.assign');
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const receipt = phase2OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: 'role.assign' });
      if (receipt.targetUserId !== userId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different team operation.');
      return;
    }
    const membershipRef = db.doc(`memberships/${teamId}_${userId}`);
    const membership = await transaction.get(membershipRef);
    const current = membership.data();
    if (!membership.exists || current?.teamId !== teamId || current.status !== 'active') throw new HttpsError('not-found', 'Active membership not found.');
    const count = await activeCoachCount(transaction, teamId);
    assertNotLastCoach(count, String(current.role), String(current.status), role, 'active');
    const now = FieldValue.serverTimestamp();
    transaction.set(operationRef, { teamId, createdBy: admin.uid, kind: 'role.assign', targetUserId: userId, role, createdAt: now });
    if (current.role === role) return;
    transaction.update(membershipRef, { role, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'role.changed', actorUserId: admin.uid, teamId, targetUserId: userId, metadata: { previousRole: String(current.role), role } }));
  });
  return { teamId, userId, role };
});

export const updateMembershipStatus = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const userId = requireString(getInput(request, 'userId'), 'User ID');
  const status = requireMembershipStatus(getInput(request, 'status'));
  const db = getFirestore();
  const operationRef = phase2OperationRef(request, teamId, 'membership.status');
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const receipt = phase2OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: 'membership.status' });
      if (receipt.targetUserId !== userId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different team operation.');
      return;
    }
    const membershipRef = db.doc(`memberships/${teamId}_${userId}`);
    const membership = await transaction.get(membershipRef);
    const current = membership.data();
    if (!membership.exists || current?.teamId !== teamId) throw new HttpsError('not-found', 'Membership not found.');
    const count = await activeCoachCount(transaction, teamId);
    assertNotLastCoach(count, String(current.role), String(current.status), String(current.role), status);
    const now = FieldValue.serverTimestamp();
    transaction.set(operationRef, { teamId, createdBy: admin.uid, kind: 'membership.status', targetUserId: userId, status, createdAt: now });
    if (current.status === status) return;
    transaction.update(membershipRef, { status, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'membership.changed', actorUserId: admin.uid, teamId, targetUserId: userId, metadata: { previousStatus: String(current.status), status } }));
  });
  return { teamId, userId, status };
});

export const leaveTeam = onCall(async (request: Phase2Request) => {
  const auth = requireCallableAuth(request);
  const teamId = requireTeamId(request);
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const membershipRef = db.doc(`memberships/${teamId}_${auth.uid}`);
    const membership = await transaction.get(membershipRef);
    const current = membership.data();
    if (!membership.exists || current?.status !== 'active' || current.teamId !== teamId) throw new HttpsError('not-found', 'Active membership not found.');
    const count = await activeCoachCount(transaction, teamId);
    assertNotLastCoach(count, String(current.role), String(current.status), String(current.role), 'removed');
    transaction.update(membershipRef, { status: 'removed', updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'membership.changed', actorUserId: auth.uid, teamId, targetUserId: auth.uid, metadata: { previousStatus: 'active', status: 'removed' } }));
  });
  return { teamId, status: 'removed' as const };
});

export const transferTeamLeadership = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const targetUserId = requireString(getInput(request, 'targetUserId'), 'Target user ID');
  const db = getFirestore();
  const operationRef = phase2OperationRef(request, teamId, 'leadership.transfer');
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const operation = await transaction.get(operationRef);
    if (operation.exists) {
      const receipt = phase2OperationReceipt(operation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: 'leadership.transfer' });
      if (receipt.targetUserId !== targetUserId) throw new HttpsError('failed-precondition', 'This operation ID belongs to a different team operation.');
      return;
    }
    const targetRef = db.doc(`memberships/${teamId}_${targetUserId}`);
    const target = await transaction.get(targetRef);
    if (!target.exists || target.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'Leadership can only transfer to an active member.');
    if (!['coach', 'teamLeader'].includes(String(target.data()?.role))) throw new HttpsError('permission-denied', 'Leadership can only transfer to a coach.');
    const leaders = await transaction.get(db.collection('memberships').where('teamId', '==', teamId).where('role', '==', 'teamLeader').where('status', '==', 'active'));
    const now = FieldValue.serverTimestamp();
    for (const leader of leaders.docs) {
      if (leader.id !== targetRef.id) transaction.update(leader.ref, { role: 'coach', updatedAt: now });
    }
    transaction.update(targetRef, { role: 'teamLeader', updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'role.changed', actorUserId: admin.uid, teamId, targetUserId, metadata: { role: 'teamLeader', action: 'transfer-leadership' } }));
    transaction.set(operationRef, { teamId, createdBy: admin.uid, kind: 'leadership.transfer', targetUserId, createdAt: now });
  });
  return { teamId, targetUserId, role: 'teamLeader' as const };
});

export const updateTeamPolicy = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const policy = validatePolicy(phase2Data(request));
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const policyRef = db.doc(`teamPolicies/${teamId}`);
    const current = await transaction.get(policyRef);
    if (!current.exists) throw new HttpsError('not-found', 'Team safety policy not found.');
    transaction.update(policyRef, { ...policy, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'sensitive.updated', actorUserId: admin.uid, teamId, targetResource: `teamPolicies/${teamId}`, metadata: { action: 'policy.updated' } }));
  });
  return { teamId, ...policy };
});

export const updatePrivacySettings = onCall(async (request: Phase2Request) => {
  const auth = requireCallableAuth(request);
  const profileVisibility = getInput(request, 'profileVisibility') ?? 'teamOnly';
  const searchable = getInput(request, 'searchable') ?? false;
  if (profileVisibility !== 'teamOnly' || searchable !== false) throw new HttpsError('failed-precondition', 'Phase 2 privacy defaults keep profiles team-only and not searchable.');
  const isMinor = getInput(request, 'isMinor');
  if (isMinor !== undefined && typeof isMinor !== 'boolean') throw new HttpsError('invalid-argument', 'Minor status must be boolean.');
  const db = getFirestore();
  const privacyRef = db.doc(`privacySettings/${auth.uid}`);
  // `isMinor` drives youth-safety defaults across the product, so the write and
  // its audit trail have to land together or not at all.
  await db.runTransaction(async (transaction) => {
    await transaction.get(privacyRef);
    const now = FieldValue.serverTimestamp();
    transaction.set(privacyRef, { userId: auth.uid, profileVisibility: 'teamOnly', searchable: false, allowParentVisibility: false, privateConversations: false, ...(isMinor === undefined ? {} : { isMinor }), updatedAt: now }, { merge: true });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'sensitive.updated',
      actorUserId: auth.uid,
      targetResource: `privacySettings/${auth.uid}`,
      metadata: { action: 'privacy.updated' }
    }));
  });
  return { userId: auth.uid, profileVisibility: 'teamOnly' as const, searchable: false as const };
});

export const requestAccountDeletion = onCall(async (request: Phase2Request) => {
  const auth = requireCallableAuth(request);
  const db = getFirestore();
  const requestRef = db.doc(`accountDeletionRequests/${auth.uid}`);
  const auditEventId = `account-deletion-requested_${auth.uid}`;
  const auditRef = db.doc(`auditEvents/${auditEventId}`);
  await db.runTransaction(async (transaction) => {
    const [existing, existingAudit] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(auditRef)
    ]);
    const now = FieldValue.serverTimestamp();
    if (!existing.exists || existing.data()?.status !== 'pending') {
      transaction.set(requestRef, {
        userId: auth.uid,
        status: 'pending',
        requestedAt: now,
        updatedAt: now
      }, { merge: true });
    }
    if (!existingAudit.exists) {
      transaction.set(auditRef, auditRecord({
        type: 'sensitive.updated',
        actorUserId: auth.uid,
        targetResource: `users/${auth.uid}`,
        metadata: { action: 'account-deletion.requested' }
      }));
    }
  });
  return { status: 'pending' as const, auditEventId };
});

/**
 * Replay guard for the safety-report receipt. A retried report must return the
 * first report/case pair rather than opening a duplicate moderation case, and a
 * receipt that belongs to a different reporter or team is never replayed.
 */
export function reportOperationResult(receipt: Record<string, unknown>, expected: { teamId: string; actorUserId: string }) {
  phase2OperationReceipt(receipt, { ...expected, kind: 'report.create' });
  return {
    reportId: requireString(receipt.reportId, 'Stored report ID'),
    moderationCaseId: requireString(receipt.moderationCaseId, 'Stored moderation case ID')
  };
}

export const createReport = onCall(async (request: Phase2Request) => {
  const auth = await requireTeamMember(request, requireTeamId(request));
  const teamId = requireTeamId(request);
  const parsed = validateReportInput(phase2Data(request));
  const db = getFirestore();
  const operationRef = phase2OperationRef(request, teamId, 'report');
  const reportRef = db.collection('reports').doc();
  const caseRef = db.collection('moderationCases').doc();
  const reportFields = {
    targetType: parsed.targetType,
    reasonCode: parsed.reasonCode,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    ...(parsed.targetUserId === undefined ? {} : { targetUserId: parsed.targetUserId }),
    ...(parsed.targetResource === undefined ? {} : { targetResource: parsed.targetResource })
  };
  const now = FieldValue.serverTimestamp();
  const committed = await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, auth.uid);
    const operation = await transaction.get(operationRef);
    if (operation.exists) return reportOperationResult(operation.data() ?? {}, { teamId, actorUserId: auth.uid });
    transaction.set(reportRef, { id: reportRef.id, teamId, reporterUserId: auth.uid, ...reportFields, createdAt: now });
    transaction.set(caseRef, { id: caseRef.id, teamId, reportId: reportRef.id, reporterUserId: auth.uid, ...reportFields, severity: 'medium', status: 'open', assignedTo: null, evidenceRef: parsed.targetResource ?? null, action: 'none', escalated: false, version: 1, createdAt: now, updatedAt: now });
    transaction.set(operationRef, { teamId, createdBy: auth.uid, kind: 'report.create', reportId: reportRef.id, moderationCaseId: caseRef.id, createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'report.created', actorUserId: auth.uid, teamId, targetResource: `moderationCases/${caseRef.id}`, metadata: { reasonCode: parsed.reasonCode, severity: 'medium' } }));
    return { reportId: reportRef.id, moderationCaseId: caseRef.id };
  });
  return committed;
});

export function moderationCaseVersion(value: unknown, label: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000) {
    throw new HttpsError('invalid-argument', `${label} must be a positive integer.`);
  }
  return version;
}

export const updateModerationCase = onCall(async (request: Phase2Request) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const caseId = requireString(getInput(request, 'caseId'), 'Moderation case ID');
  const updates: Record<string, unknown> = {};
  for (const key of ['severity', 'status', 'assignedTo', 'action', 'escalated']) {
    if (getInput(request, key) !== undefined) updates[key] = getInput(request, key);
  }
  const allowed = {
    severity: ['low', 'medium', 'high', 'critical'],
    status: ['open', 'investigating', 'resolved', 'dismissed'],
    action: ['none', 'warning', 'remove-content', 'suspend-member', 'remove-member', 'escalate']
  } as const;
  for (const key of ['severity', 'status', 'action'] as const) if (updates[key] !== undefined && !allowed[key].includes(updates[key] as never)) throw new HttpsError('invalid-argument', `Moderation ${key} is invalid.`);
  if (updates.assignedTo !== undefined && updates.assignedTo !== null) updates.assignedTo = requireString(updates.assignedTo, 'Assignee ID');
  if (updates.escalated !== undefined && typeof updates.escalated !== 'boolean') throw new HttpsError('invalid-argument', 'Escalation must be boolean.');
  // A moderation case is the most safety-sensitive record in the product; two
  // coaches triaging it at once must not silently overwrite each other.
  const expectedVersion = moderationCaseVersion(getInput(request, 'expectedVersion'), 'Expected version');
  const db = getFirestore();
  const nextVersion = await db.runTransaction(async (transaction) => {
    await assertAdminInTransaction(transaction, teamId, admin.uid, admin.platformAdmin);
    const caseRef = db.doc(`moderationCases/${caseId}`);
    const caseSnapshot = await transaction.get(caseRef);
    const current = caseSnapshot.data();
    if (!caseSnapshot.exists || current?.teamId !== teamId) throw new HttpsError('not-found', 'Moderation case not found.');
    // Cases created before the version field existed default to 1.
    const currentVersion = moderationCaseVersion(current.version ?? 1, 'Stored moderation case version');
    if (currentVersion !== expectedVersion) throw new HttpsError('aborted', 'This moderation case changed while you were reviewing it. Reload the case before saving.');
    if (updates.action === 'remove-content' && typeof current.targetResource === 'string') {
      const [collectionName, contentId] = current.targetResource.split('/');
      const contentReference = current.targetResource.split('/');
      if (contentReference.length !== 2 || !contentId || !['questions', 'answers', 'questionComments', 'videos'].includes(collectionName)) {
        throw new HttpsError('invalid-argument', 'The reported content reference cannot be moderated.');
      }
      const contentRef = db.doc(`${collectionName}/${contentId}`);
      const contentSnapshot = await transaction.get(contentRef);
      if (!contentSnapshot.exists || contentSnapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Reported content not found in this team.');
      transaction.update(contentRef, collectionName === 'videos' ? { publicationStatus: 'removed', updatedAt: FieldValue.serverTimestamp() } : { moderationStatus: 'removed', updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.update(caseRef, { ...updates, version: currentVersion + 1, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'moderation.updated', actorUserId: admin.uid, teamId, targetResource: `moderationCases/${caseId}`, ...(current.targetUserId ? { targetUserId: String(current.targetUserId) } : {}), metadata: { action: String(updates.action ?? 'case.updated'), caseStatus: String(updates.status ?? current.status), severity: String(updates.severity ?? current.severity) } }));
    return currentVersion + 1;
  });
  return { caseId, ...updates, version: nextVersion };
});

/**
 * Team roster with display names.
 *
 * `users/{uid}` is readable only by its owner (firestore.rules), which is the
 * right default for a product used by minors — but it means the client cannot
 * turn a membership's userId into a name. Without this callable every screen
 * has to render raw Firebase UIDs. The Admin SDK does the join here and
 * returns only what a teammate is allowed to see: name, avatar, role, status.
 * Email and every other profile field stay private.
 */
const ROSTER_LIMIT = 200;

export const listTeamMembers = onCall(async (request) => {
  const typedRequest = request as CallableRequest<Record<string, unknown>>;
  const teamId = requireTeamId(typedRequest);
  const actor = await requireTeamMember(typedRequest, teamId);
  const db = getFirestore();
  const memberships = await db
    .collection('memberships')
    .where('teamId', '==', teamId)
    .limit(ROSTER_LIMIT)
    .get();

  // Only admins need to see people who are not active yet; everyone else sees
  // the active roster so they can assign work and read author names.
  const isAdmin = actor.platformAdmin === true || ['coach', 'teamLeader'].includes(String(actor.role));
  const rows = memberships.docs
    .map((doc) => doc.data())
    .filter((membership) => isAdmin || membership.status === 'active');
  if (rows.length === 0) return { members: [], truncated: false };

  const userRefs = rows.map((membership) => db.doc(`users/${String(membership.userId)}`));
  const users = await db.getAll(...userRefs);
  const profiles = new Map(users.map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));

  const members = rows.map((membership) => {
    const userId = String(membership.userId);
    const profile = profiles.get(userId) ?? {};
    const displayName = typeof profile.displayName === 'string' && profile.displayName.trim()
      ? profile.displayName.trim()
      : 'Team member';
    return {
      userId,
      role: String(membership.role ?? 'student'),
      status: String(membership.status ?? 'active'),
      displayName,
      photoURL: typeof profile.photoURL === 'string' && profile.photoURL.startsWith('https://') ? profile.photoURL : null,
      initials: displayName.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
    };
  }).sort((left, right) => left.displayName.localeCompare(right.displayName));

  return { members, truncated: memberships.size === ROSTER_LIMIT };
});

export const createTask = onCall(async (request) => createTaskCommand(request as CallableRequest<Record<string, unknown>>));
export const updateTask = onCall(async (request) => updateTaskCommand(request as CallableRequest<Record<string, unknown>>));
export const createGoal = onCall(async (request) => createGoalCommand(request as CallableRequest<Record<string, unknown>>));
export const updateGoal = onCall(async (request) => updateGoalCommand(request as CallableRequest<Record<string, unknown>>));
export const markNotificationRead = onCall(async (request) => markNotificationReadCommand(request as CallableRequest<Record<string, unknown>>));
export const createFileMetadata = onCall(async (request) => createFileMetadataCommand(request as CallableRequest<Record<string, unknown>>));
export const completeFileUpload = onCall(async (request) => completeFileUploadCommand(request as CallableRequest<Record<string, unknown>>));
export const linkFileToTask = onCall(async (request) => linkFileToTaskCommand(request as CallableRequest<Record<string, unknown>>));
export const ensureDefaultProject = onCall(async (request) => withBoardErrors(ensureDefaultProjectCommand)(request as CallableRequest<Record<string, unknown>>));
export const createProject = onCall(async (request) => withBoardErrors(createProjectCommand)(request as CallableRequest<Record<string, unknown>>));
export const updateProject = onCall(async (request) => withBoardErrors(updateProjectCommand)(request as CallableRequest<Record<string, unknown>>));
export const archiveProject = onCall(async (request) => withBoardErrors(archiveProjectCommand)(request as CallableRequest<Record<string, unknown>>));
export const addProjectColumn = onCall(async (request) => withBoardErrors(addProjectColumnCommand)(request as CallableRequest<Record<string, unknown>>));
export const updateProjectColumn = onCall(async (request) => withBoardErrors(updateProjectColumnCommand)(request as CallableRequest<Record<string, unknown>>));
export const reorderProjectColumns = onCall(async (request) => withBoardErrors(reorderProjectColumnsCommand)(request as CallableRequest<Record<string, unknown>>));
export const removeProjectColumn = onCall(async (request) => withBoardErrors(removeProjectColumnCommand)(request as CallableRequest<Record<string, unknown>>));
export const updateProjectCategories = onCall(async (request) => withBoardErrors(updateProjectCategoriesCommand)(request as CallableRequest<Record<string, unknown>>));
export const createKanbanTask = onCall(async (request) => withBoardErrors(createKanbanTaskCommand)(request as CallableRequest<Record<string, unknown>>));
export const moveTaskCard = onCall(async (request) => withBoardErrors(moveTaskCardCommand)(request as CallableRequest<Record<string, unknown>>));
export const listProjectTemplates = onCall(async (request) => withBoardErrors(listProjectTemplatesCommand)(request as CallableRequest<Record<string, unknown>>));
export const createProjectFromTemplate = onCall(async (request) => withBoardErrors(createProjectFromTemplateCommand)(request as CallableRequest<Record<string, unknown>>));
export const saveProjectAsTemplate = onCall(async (request) => withBoardErrors(saveProjectAsTemplateCommand)(request as CallableRequest<Record<string, unknown>>));
export const deleteProjectTemplate = onCall(async (request) => withBoardErrors(deleteProjectTemplateCommand)(request as CallableRequest<Record<string, unknown>>));
export const importProjectTasks = onCall(async (request) => withBoardErrors(importProjectTasksCommand)(request as CallableRequest<Record<string, unknown>>));
export const resolveImportAssignees = onCall(async (request) => withBoardErrors(resolveImportAssigneesCommand)(request as CallableRequest<Record<string, unknown>>));
export const createQuestion = onCall(async (request) => createQuestionCommand(request as CallableRequest<Record<string, unknown>>));
export const searchQuestions = onCall(async (request) => searchQuestionsCommand(request as CallableRequest<Record<string, unknown>>));
export const createAnswer = onCall(async (request) => createAnswerCommand(request as CallableRequest<Record<string, unknown>>));
export const createQuestionComment = onCall(async (request) => createQuestionCommentCommand(request as CallableRequest<Record<string, unknown>>));
export const voteQuestion = onCall(async (request) => voteQuestionCommand(request as CallableRequest<Record<string, unknown>>));
export const acceptAnswer = onCall(async (request) => acceptAnswerCommand(request as CallableRequest<Record<string, unknown>>));
export const toggleSavedQuestion = onCall(async (request) => toggleSavedQuestionCommand(request as CallableRequest<Record<string, unknown>>));
export const createVideo = onCall(async (request) => createVideoCommand(request as CallableRequest<Record<string, unknown>>));
export const searchVideos = onCall(async (request) => searchVideosCommand(request as CallableRequest<Record<string, unknown>>));
export const toggleVideoFavorite = onCall(async (request) => toggleVideoFavoriteCommand(request as CallableRequest<Record<string, unknown>>));
export const recordVideoWatch = onCall(async (request) => recordVideoWatchCommand(request as CallableRequest<Record<string, unknown>>));
export const updateVideoPublication = onCall(async (request) => updateVideoPublicationCommand(request as CallableRequest<Record<string, unknown>>));
export const createPoll = onCall(async (request) => createPollCommand(request as CallableRequest<Record<string, unknown>>));
export const closePoll = onCall(async (request) => closePollCommand(request as CallableRequest<Record<string, unknown>>));
export const votePoll = onCall(async (request) => votePollCommand(request as CallableRequest<Record<string, unknown>>));
export const getPollResults = onCall(async (request) => getPollResultsCommand(request as CallableRequest<Record<string, unknown>>));
export const listPolls = onCall(async (request) => listPollsCommand(request as CallableRequest<Record<string, unknown>>));
export const createScoreDefinition = onCall(async (request) => createScoreDefinitionCommand(request as CallableRequest<Record<string, unknown>>));
export const listScoreDefinitions = onCall(async (request) => listScoreDefinitionsCommand(request as CallableRequest<Record<string, unknown>>));
export const createScoreSession = onCall(async (request) => createScoreSessionCommand(request as CallableRequest<Record<string, unknown>>));
export const listScoreSessions = onCall(async (request) => listScoreSessionsCommand(request as CallableRequest<Record<string, unknown>>));
export const correctScoreSession = onCall(async (request) => correctScoreSessionCommand(request as CallableRequest<Record<string, unknown>>));
export const exportScoreReport = onCall(async (request) => exportScoreReportCommand(request as CallableRequest<Record<string, unknown>>));
export const getDashboard = onCall(async (request) => getDashboardCommand(request as CallableRequest<Record<string, unknown>>));
export const globalSearch = onCall(async (request) => globalSearchCommand(request as CallableRequest<Record<string, unknown>>));
export const updateProfileSettings = onCall(async (request) => updateProfileSettingsCommand(request as CallableRequest<Record<string, unknown>>));

export function handleApiRequest(req: Request, res: Response): void {
  if (!applyCors(req, res)) {
    return;
  }

  if (req.path === '/healthz' && req.method === 'OPTIONS') {
    res.status(204).send();
    return;
  }

  if (req.method === 'GET' && req.path === '/healthz') {
    res.status(200).json({
      ok: true,
      service: 'first-pit-functions',
      phase: 4
    });
    return;
  }

  if (req.path === '/healthz') {
    res.set('Allow', 'GET, OPTIONS');
    res.status(405).json({
      ok: false,
      error: 'Method not allowed.'
    });
    return;
  }

  res.status(404).json({
    ok: false,
    error: 'Not found.'
  });
}

export const api = onRequest({ cors: false }, handleApiRequest);
