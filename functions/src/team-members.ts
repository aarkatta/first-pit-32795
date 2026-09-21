import { randomInt } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  auditRecord,
  getInput,
  requireAssignableRole,
  requireAuth,
  requireEmail,
  requireOperationReceipt,
  requireString,
  requireTeamAdmin,
  requireTeamId,
  teamOperationRef,
  type AccountType,
  type AssignableRole
} from './phase2.js';

/**
 * Coach-provisioned member accounts.
 *
 * The invitation flow (`createInvitation` / `acceptInvitation`) asks the invitee
 * to create their own account, prove their address and accept. That keeps the
 * coach powerless by design, but it is three handoffs and it strands anyone
 * whose verification mail lands in spam — which `authEmailSender` in
 * `src/lib/auth.ts` documents as the normal case.
 *
 * Provisioning is the second onboarding path: a coach adds a member, the server
 * creates the Firebase Auth account with a generated password, and the coach
 * passes the credentials on from their own mailbox. The member is forced to
 * choose their own password before they reach any team data, which is what
 * turns a shared secret back into a private one.
 *
 * Invariants this module exists to hold:
 *  - the generated password is returned to the caller once and never persisted,
 *    logged, or written to an operation receipt;
 *  - an address that already has a First Pit account is refused, so joining an
 *    existing account to a team still requires that person's consent;
 *  - a coach may only reset a password for an account this team provisioned
 *    (`provisionedByTeamId`), never a member's own personal account.
 */

export const PROVISION_OPERATION_KIND = 'member.provision';
export const PASSWORD_RESET_OPERATION_KIND = 'member.password.reset';

/**
 * Words the temporary password is built from: 4–6 lowercase letters each, no
 * homoglyph pairs and nothing that reads oddly in combination, because a ten
 * year old types this by hand from a printout or a phone screen.
 */
export const PASSWORD_WORDS: readonly string[] = [
  'axle', 'beam', 'belt', 'bolt', 'brick', 'cable', 'chain', 'clamp',
  'claw', 'clutch', 'crane', 'delta', 'drive', 'drum', 'field', 'flag',
  'float', 'gauge', 'gear', 'giant', 'glide', 'globe', 'goal', 'hinge',
  'jump', 'laser', 'latch', 'lever', 'lift', 'light', 'logic', 'loop',
  'match', 'metal', 'model', 'motor', 'north', 'orbit', 'panel', 'pilot',
  'pivot', 'pixel', 'plate', 'point', 'power', 'prism', 'pulse', 'pump',
  'quest', 'radar', 'ramp', 'relay', 'robot', 'rocket', 'rotor', 'route',
  'scale', 'score', 'screw', 'sensor', 'servo', 'shaft', 'shell', 'shift',
  'signal', 'solar', 'space', 'spark', 'speed', 'spool', 'sprint', 'stack',
  'steel', 'storm', 'swift', 'switch', 'table', 'team', 'tile', 'timer',
  'torque', 'track', 'train', 'tread', 'trophy', 'truss', 'turbo', 'valve',
  'vector', 'vision', 'wedge', 'wheel', 'winch', 'zone'
];

const PASSWORD_WORD_COUNT = 3;
const PASSWORD_DIGIT_FLOOR = 1000;
const PASSWORD_DIGIT_CEILING = 10000;

/**
 * Search space of `generateTemporaryPassword`, in bits.
 *
 * Three words out of 94 plus four digits is ~33 bits — far below what a stored
 * credential would need, and deliberately so: the shape has to survive being
 * read aloud at a practice table. It is safe here because the password is
 * single-use in practice (`mustSetPassword` forces a change before the member
 * reaches any team data), because Firebase Auth throttles password sign-in per
 * account and per IP, and because no hash of it is ever stored anywhere an
 * attacker could work offline. Lengthen the word count, not the alphabet, if
 * that ever stops being true.
 */
export function temporaryPasswordEntropyBits(): number {
  const combinations = PASSWORD_WORDS.length ** PASSWORD_WORD_COUNT * (PASSWORD_DIGIT_CEILING - PASSWORD_DIGIT_FLOOR);
  return Math.log2(combinations);
}

function capitalize(word: string): string {
  return `${word[0].toUpperCase()}${word.slice(1)}`;
}

/**
 * A readable single-use password, e.g. `Falcon-Gear-Orbit-4821`.
 *
 * `randomInt` rather than `Math.random`: this is a credential, and it is the
 * only unbiased CSPRNG integer helper in the Node standard library.
 */
export function generateTemporaryPassword(): string {
  const words = new Set<string>();
  // Repeats read as a typo to whoever copies this down by hand, so draw without
  // replacement. Compared before capitalizing — the set holds the raw words.
  while (words.size < PASSWORD_WORD_COUNT) {
    words.add(PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)]);
  }
  const digits = randomInt(PASSWORD_DIGIT_FLOOR, PASSWORD_DIGIT_CEILING);
  return `${[...words].map(capitalize).join('-')}-${digits}`;
}

/**
 * The minimum length a member's own password may be.
 *
 * Length beats character classes for this audience: a ten year old can
 * remember `myrobotisfast` and cannot remember `R0b0t!x`. Mirrored in
 * `src/lib/member-credentials.ts` for the form's own hint — the client cannot
 * import from `functions/`.
 */
export const MIN_MEMBER_PASSWORD_LENGTH = 10;
export const MAX_MEMBER_PASSWORD_LENGTH = 64;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Passwords so common that length alone does not make them a secret. */
const OBVIOUS_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '1234567890', '0123456789',
  'qwertyuiop', 'firstlego', 'firstpit', 'legolego', 'firstlegoleague', 'letmein123'
]);

/**
 * Validates the password a member chooses for themselves.
 *
 * Deliberately not trimmed: leading and trailing spaces are part of a password,
 * and silently removing them would let someone set a secret they can never type
 * back. Whitespace-only input is rejected outright instead.
 */
export function requireNewPassword(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'A new password is required.');
  if (value.length < MIN_MEMBER_PASSWORD_LENGTH || value.length > MAX_MEMBER_PASSWORD_LENGTH) {
    throw new HttpsError('invalid-argument', `Your password must be between ${MIN_MEMBER_PASSWORD_LENGTH} and ${MAX_MEMBER_PASSWORD_LENGTH} characters.`);
  }
  if (CONTROL_CHARACTERS.test(value) || !value.trim()) {
    throw new HttpsError('invalid-argument', 'Your password contains characters that are not allowed.');
  }
  if (OBVIOUS_PASSWORDS.has(value.toLowerCase())) {
    throw new HttpsError('invalid-argument', 'That password is too easy to guess. Try a few words only you would put together.');
  }
  return value;
}

/**
 * A person's name as the coach typed it, for `users/{uid}.displayName`.
 *
 * Whitespace is collapsed the way `requireTeamName` does it, and the value is
 * checked for at least one letter in any script — accents and non-Latin names
 * are ordinary, a name made only of punctuation is not.
 */
export function requirePersonName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 80 || CONTROL_CHARACTERS.test(name) || !/\p{L}/u.test(name)) {
    throw new HttpsError('invalid-argument', 'Enter the member\'s full name (2 to 80 characters).');
  }
  return name;
}

/**
 * The account type a provisioned member gets.
 *
 * `accountType` normally answers "what did this person say they are at
 * sign-up", and it gates team creation. A provisioned member never sees that
 * question, so the coach's chosen team role answers it instead — which keeps a
 * provisioned student a student for the purposes of `teamCreationRefusal`.
 */
export function accountTypeForRole(role: AssignableRole): AccountType {
  return role;
}

/** The role a coach may provision. Team leadership stays with `transferTeamLeadership`. */
export function requireProvisionableRole(value: unknown): AssignableRole {
  return requireAssignableRole(value ?? 'student');
}

/**
 * Whether this team provisioned the account, and so may reset its password.
 *
 * The check is the whole safety story for `resetTeamMemberPassword`: without
 * it, a coach could take over the personal Google or password account of any
 * teammate — read their mail-linked identity, post as them, vote as them. With
 * it, the lever only reaches accounts this team created and whose password the
 * coach already handed over once.
 */
export function assertProvisionedByTeam(userData: Record<string, unknown> | undefined, teamId: string): void {
  if (!userData || userData.provisionedByTeamId !== teamId) {
    throw new HttpsError('failed-precondition', 'This member signed up on their own, so only they can change their password. Ask them to use "Forgot password" on the sign-in screen.');
  }
}

/**
 * Looks up an account by address, distinguishing "no such account" from a
 * lookup that failed. A failed lookup must not read as "address is free" —
 * that is how a provision would collide with an existing account.
 */
async function findUserByEmail(email: string) {
  try {
    return await getAuth().getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw new HttpsError('internal', 'The email address could not be checked. Try again.');
  }
}

const EXISTING_ACCOUNT_MESSAGE = 'That email address already has a First Pit account. Send them an invitation instead, so they can accept it themselves.';

/**
 * Creates a team member's account and hands the coach a single-use password.
 *
 * The password is in the return value and nowhere else: not in the operation
 * receipt, not in the member's profile, not in a log line. A replay of a
 * successful call therefore cannot reproduce it, and says so.
 */
export async function provisionTeamMember(request: CallableRequest<Record<string, unknown>>) {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const displayName = requirePersonName(getInput(request, 'displayName'));
  const email = requireEmail(getInput(request, 'email'));
  const role = requireProvisionableRole(getInput(request, 'role'));
  const db = getFirestore();
  const operationRef = teamOperationRef(teamId, PROVISION_OPERATION_KIND, getInput(request, 'operationId'));

  // Checked before the account is created so a retry never mints a second
  // Auth user for the same operation.
  const priorOperation = await operationRef.get();
  if (priorOperation.exists) {
    const receipt = requireOperationReceipt(priorOperation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: PROVISION_OPERATION_KIND });
    return {
      userId: requireString(receipt.userId, 'Stored member ID'),
      email,
      displayName,
      role,
      temporaryPassword: null,
      replayed: true
    };
  }

  // Attaching an existing account to a team without that person acting is
  // exactly what the invitation flow exists to prevent, so this path refuses
  // and points at it. `createUser` below is the real guard against a race.
  if (await findUserByEmail(email)) throw new HttpsError('already-exists', EXISTING_ACCOUNT_MESSAGE);

  const temporaryPassword = generateTemporaryPassword();
  let created;
  try {
    // `emailVerified` stays false: nobody has proved this mailbox. Only
    // invitation reads require the claim (firestore.rules), so a provisioned
    // member works everywhere else and still has to verify before accepting an
    // invitation to a second team.
    created = await getAuth().createUser({ email, emailVerified: false, password: temporaryPassword, displayName });
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/email-already-exists') throw new HttpsError('already-exists', EXISTING_ACCOUNT_MESSAGE);
    throw new HttpsError('internal', 'The member account could not be created. Try again.');
  }

  try {
    await db.runTransaction(async (transaction) => {
      await assertTeamAdminInTransaction(transaction, teamId, admin);
      const now = FieldValue.serverTimestamp();
      // The profile carries the defaults `bootstrapUserProfile` would otherwise
      // backfill on first sign-in — which the `users` update rule forbids.
      transaction.set(db.doc(`users/${created.uid}`), {
        uid: created.uid,
        email,
        displayName,
        photoURL: null,
        accountType: accountTypeForRole(role),
        accountTypeSetAt: now,
        provisionedByTeamId: teamId,
        provisionedBy: admin.uid,
        provisionedAt: now,
        mustSetPassword: true,
        createdAt: now,
        updatedAt: now
      });
      transaction.set(db.doc(`memberships/${teamId}_${created.uid}`), {
        teamId,
        userId: created.uid,
        role,
        status: 'active',
        createdAt: now,
        updatedAt: now
      });
      transaction.set(db.collection('auditEvents').doc(), auditRecord({
        type: 'membership.changed',
        actorUserId: admin.uid,
        teamId,
        targetUserId: created.uid,
        metadata: { role, status: 'active', action: 'member.provisioned' }
      }));
      // `create`, not `set`: if a concurrent call claimed this operation ID the
      // whole transaction aborts and the compensation below runs.
      transaction.create(operationRef, {
        teamId,
        createdBy: admin.uid,
        kind: PROVISION_OPERATION_KIND,
        userId: created.uid,
        createdAt: now
      });
    });
  } catch (error) {
    // Nothing references the account yet, so leave no orphan Auth user behind.
    // This is the one place in the codebase where a write spans Auth and
    // Firestore, and it is why the Auth call comes second-to-last.
    await getAuth().deleteUser(created.uid).catch(() => undefined);
    throw error;
  }

  return { userId: created.uid, email, displayName, role, temporaryPassword, replayed: false };
}

/**
 * Issues a fresh single-use password for an account this team provisioned.
 *
 * Confined by `assertProvisionedByTeam`: a coach can help the student they
 * created an account for, and can never touch the personal account of a mentor
 * or parent who signed up on their own.
 */
export async function resetTeamMemberPassword(request: CallableRequest<Record<string, unknown>>) {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const userId = requireString(getInput(request, 'userId'), 'Member ID');
  const db = getFirestore();
  const operationRef = teamOperationRef(teamId, PASSWORD_RESET_OPERATION_KIND, getInput(request, 'operationId'));

  const priorOperation = await operationRef.get();
  if (priorOperation.exists) {
    requireOperationReceipt(priorOperation.data() ?? {}, { teamId, actorUserId: admin.uid, kind: PASSWORD_RESET_OPERATION_KIND });
    // The password was never stored, so a replay cannot return one.
    return { userId, temporaryPassword: null, replayed: true };
  }

  const temporaryPassword = generateTemporaryPassword();
  // The Firestore transaction runs first so the administrative record exists
  // before the credential changes. If the Auth update then fails the audit
  // shows an attempted reset, which is what a moderation review needs to see;
  // the reverse order can change a member's password leaving no trace.
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const userRef = db.doc(`users/${userId}`);
    const membershipRef = db.doc(`memberships/${teamId}_${userId}`);
    const [user, membership] = await Promise.all([transaction.get(userRef), transaction.get(membershipRef)]);
    // Membership decides "not found": someone who is not on this team is not a
    // member the coach may ask about at all. A missing profile falls through to
    // `assertProvisionedByTeam`, whose message is the useful one — a member
    // First Pit holds no provisioning record for is one the coach cannot reset.
    const membershipData = membership.data();
    if (!membership.exists) throw new HttpsError('not-found', 'That member is not on this team.');
    if (membershipData?.status !== 'active') throw new HttpsError('failed-precondition', 'That member is not active on this team.');
    assertProvisionedByTeam(user.data(), teamId);
    const now = FieldValue.serverTimestamp();
    transaction.update(userRef, { mustSetPassword: true, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetUserId: userId,
      metadata: { action: PASSWORD_RESET_OPERATION_KIND, role: String(membershipData?.role ?? 'student') }
    }));
    transaction.create(operationRef, {
      teamId,
      createdBy: admin.uid,
      kind: PASSWORD_RESET_OPERATION_KIND,
      userId,
      createdAt: now
    });
  });

  try {
    await getAuth().updateUser(userId, { password: temporaryPassword });
  } catch {
    throw new HttpsError('internal', 'The password was not changed. Try the reset again.');
  }

  return { userId, temporaryPassword, replayed: false };
}

/**
 * The member replaces the password their coach gave them with one only they
 * know. Enforced server-side rather than by a client `updatePassword` plus a
 * "done" call, so `mustSetPassword` can only clear when the password really
 * changed.
 *
 * No audit event: this is a person changing their own password, not an
 * administrative action taken on them.
 */
export async function setInitialPassword(request: CallableRequest<Record<string, unknown>>) {
  const auth = requireAuth(request);
  const newPassword = requireNewPassword(getInput(request, 'newPassword'));
  const db = getFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const snapshot = await userRef.get();
  const profile = snapshot.data();
  if (!snapshot.exists || profile?.mustSetPassword !== true) {
    throw new HttpsError('failed-precondition', 'Your password has already been set. Use "Forgot password" on the sign-in screen to change it.');
  }
  const email = String(profile?.email ?? '');
  if (newPassword.trim().toLowerCase() === email.toLowerCase() || newPassword.trim().toLowerCase() === email.split('@')[0].toLowerCase()) {
    throw new HttpsError('invalid-argument', 'Your password cannot be your email address. Pick a few words only you would put together.');
  }

  await getAuth().updateUser(auth.uid, { password: newPassword });
  // Clearing the flag second is the safe order: a failure here re-prompts a
  // member whose password is already theirs, where the reverse would let
  // someone past the gate with the password their coach still knows.
  await userRef.update({ mustSetPassword: false, passwordSetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { userId: auth.uid };
}
