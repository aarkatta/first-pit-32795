import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatDateLabel } from '@/lib/dates';
import type { TeamMember } from '@/lib/directory';
import { roleLabel } from '@/lib/domain';

type RosterTableProps = {
  members: TeamMember[];
  truncated: boolean;
  currentUserId: string;
  /** The member who created the team (`team.createdBy`), shown as "Team owner". */
  ownerId: string | null;
  /** Coach or team leader: role, status and password actions are theirs only. */
  canAdminister: boolean;
  locked: boolean;
  /** Active coaches across the whole team, so the sole-coach lock survives filtering. */
  coachCount: number;
  onRoleChange: (member: TeamMember, role: 'student' | 'parent' | 'mentor' | 'coach') => void;
  onSuspend: (member: TeamMember) => void;
  onResetPassword: (member: TeamMember) => void;
};

type OpenMenu = { userId: string; top: number; right: number };

const isCoachRole = (role: string) => role === 'coach' || role === 'teamLeader';

/**
 * The note under a member's name. `mustSetPassword` only ever comes from a
 * coach creating the account (`provisionTeamMember`), so that member was
 * *added*, not invited — invitations are the other onboarding path.
 */
function memberSubtitle(member: TeamMember, isOwner: boolean): string | null {
  if (isOwner) return 'Team owner';
  const when = formatDateLabel(member.joinedAt, '');
  if (!when) return null;
  return member.mustSetPassword === true ? `Added ${when}` : `Joined ${when}`;
}

/**
 * The team roster: active members only.
 *
 * Manage team stays clean by rule — a suspended, removed or pending member is
 * never listed here. Suspending someone takes them off this table; restoring
 * them is Administration → Suspended. So every row is active, and an active
 * member's real state is whether they have finished signing in (`mustSetPassword`),
 * which the Status column shows as "Active" or "Not signed in".
 *
 * Below 760px the same table restacks as one card per member (CSS only, in
 * reference-ui.css); wider, it scrolls sideways inside its frame if it must.
 *
 * Per-member actions (`Reset password`, `Suspend`) sit behind a "⋯" disclosure
 * button. Its panel is portalled to `<body>` and placed with fixed positioning
 * so neither the scrolling frame nor the page-entrance transform clips it.
 * Opening it moves focus to the first action; Escape closes it and returns focus
 * to the button. `Reset password` appears only for accounts this team
 * provisioned — the server refuses the rest. `provisionedByThisTeam` is
 * undefined for non-admin callers, hence `=== true`.
 */
export function RosterTable({
  members,
  truncated,
  currentUserId,
  ownerId,
  canAdminister,
  locked,
  coachCount,
  onRoleChange,
  onSuspend,
  onResetPassword
}: RosterTableProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const openUserId = openMenu?.userId ?? null;

  useEffect(() => {
    if (!openUserId) return undefined;
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const trigger = triggers.current.get(openUserId);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || trigger?.contains(target)) return;
      setOpenMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenMenu(null);
      trigger?.focus();
    };
    // A fixed panel would drift away from its row, so it closes instead.
    const onMove = () => setOpenMenu(null);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [openUserId]);

  function toggleMenu(userId: string) {
    if (openUserId === userId) {
      setOpenMenu(null);
      return;
    }
    const rect = triggers.current.get(userId)?.getBoundingClientRect();
    setOpenMenu({ userId, top: (rect?.bottom ?? 0) + 6, right: window.innerWidth - (rect?.right ?? 0) });
  }

  /** Tabbing out of the panel continues from its button, so focus never strands at the end of the page. */
  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !openUserId) return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const leaving = event.shiftKey ? document.activeElement === items[0] : document.activeElement === items[items.length - 1];
    if (!leaving) return;
    triggers.current.get(openUserId)?.focus();
    setOpenMenu(null);
  }

  const menuMember = openUserId ? members.find((member) => member.userId === openUserId) ?? null : null;

  return (
    <div className="roster-table-wrap">
      <table className="roster-table">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            {canAdminister ? <th scope="col"><span className="visually-hidden">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => {
            const isSelf = member.userId === currentUserId;
            const isOwner = member.userId === ownerId;
            const provisioned = member.provisionedByThisTeam === true;
            const soleCoach = isCoachRole(member.role) && coachCount === 1;
            const notSignedIn = member.mustSetPassword === true;
            const subtitle = memberSubtitle(member, isOwner);
            const hasActions = canAdminister && (provisioned || !isSelf);
            return (
              <tr key={member.userId}>
                <td className="roster-table__cell--member">
                  <span className="roster-table__member">
                    <span className={`roster-avatar color-${index % 6}`} aria-hidden="true">{member.initials}</span>
                    <span>
                      <strong>{member.displayName}{isSelf ? <span className="roster-tag roster-tag--you">You</span> : null}</strong>
                      {subtitle ? <small className="roster-table__subtitle">{subtitle}</small> : null}
                    </span>
                  </span>
                </td>
                <td className="roster-table__cell--role">
                  {canAdminister ? (
                    <>
                      <select
                        id={`role-${member.userId}`}
                        aria-label={`Role for ${member.displayName}`}
                        aria-describedby={soleCoach ? `role-hint-${member.userId}` : undefined}
                        value={member.role === 'teamLeader' ? 'coach' : member.role}
                        disabled={locked}
                        onChange={(event) => onRoleChange(member, event.target.value as 'student' | 'parent' | 'mentor' | 'coach')}
                      >
                        <option value="student" disabled={soleCoach}>Student</option>
                        <option value="parent" disabled={soleCoach}>Parent</option>
                        <option value="mentor" disabled={soleCoach}>Mentor</option>
                        <option value="coach">Coach</option>
                      </select>
                      {/* Only a coach administers, so the sole coach is always the viewer. */}
                      {soleCoach ? <small id={`role-hint-${member.userId}`} className="roster-table__hint">Locked: only coach</small> : null}
                    </>
                  ) : <span>{roleLabel(member.role)}</span>}
                </td>
                <td className="roster-table__cell--status">
                  <span className={`roster-status roster-status--${notSignedIn ? 'pending' : 'active'}`}>
                    {notSignedIn ? 'Not signed in' : 'Active'}
                  </span>
                </td>
                {canAdminister ? (
                  <td className="roster-table__actions">
                    {hasActions ? (
                      <button
                        ref={(node) => {
                          if (node) triggers.current.set(member.userId, node);
                          else triggers.current.delete(member.userId);
                        }}
                        type="button"
                        className="roster-menu__trigger"
                        aria-expanded={openUserId === member.userId}
                        aria-controls={openUserId === member.userId ? `roster-actions-${member.userId}` : undefined}
                        aria-label={`Actions for ${member.displayName}`}
                        disabled={locked}
                        onClick={() => toggleMenu(member.userId)}
                      >
                        <span aria-hidden="true">⋯</span>
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {truncated ? <p className="roster-table__truncated"><small>Showing the first 200 members. Older memberships are not listed.</small></p> : null}
      {openMenu && menuMember ? createPortal(
        <div
          ref={panelRef}
          id={`roster-actions-${menuMember.userId}`}
          className="roster-menu__list"
          role="group"
          aria-label={`Actions for ${menuMember.displayName}`}
          style={{ top: openMenu.top, right: openMenu.right }}
          onKeyDown={onPanelKeyDown}
        >
          {menuMember.provisionedByThisTeam === true ? (
            <button type="button" disabled={locked} onClick={() => { setOpenMenu(null); onResetPassword(menuMember); }}>Reset password</button>
          ) : null}
          {menuMember.userId !== currentUserId ? (
            <button type="button" className="roster-menu__danger" disabled={locked} onClick={() => { setOpenMenu(null); onSuspend(menuMember); }}>Suspend</button>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
