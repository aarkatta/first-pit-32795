import { randomInt } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { requireAssignableRole, type AccountType, type AssignableRole } from './phase2.js';

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
