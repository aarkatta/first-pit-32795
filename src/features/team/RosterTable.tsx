import type { TeamMember } from '@/lib/directory';

type RosterTableProps = {
  members: TeamMember[];
  truncated: boolean;
  currentUserId: string;
  /** Coach or team leader: role, status and password actions are theirs only. */
  canAdminister: boolean;
  locked: boolean;
  onRoleChange: (member: TeamMember, role: 'student' | 'parent' | 'mentor' | 'coach') => void;
  onSuspend: (member: TeamMember) => void;
  onResetPassword: (member: TeamMember) => void;
};

const isCoachRole = (role: string) => role === 'coach' || role === 'teamLeader';

function statusLabel(status: string) {
  return `${status[0]?.toUpperCase() ?? ''}${status.slice(1)}`;
}

/**
 * The team roster: active members only.
 *
 * Manage team stays clean by rule — a suspended, removed or pending member is
 * never listed here. Suspending someone takes them off this table; restoring
 * them is Administration → Suspended. So every row is active, and the only
 * status action is Suspend.
 *
 * `Reset password` appears only for accounts this team provisioned — the server
 * refuses the rest, and offering a button that always fails would read as a bug.
 * `provisionedByThisTeam` is undefined for non-admin callers, hence `=== true`.
 */
export function RosterTable({
  members,
  truncated,
  currentUserId,
  canAdminister,
  locked,
  onRoleChange,
  onSuspend,
  onResetPassword
}: RosterTableProps) {
  // A team must always keep an active coach. The server refuses a change that
  // would leave none (assertNotLastCoach, inside the same transaction), but the
  // sole coach should be told before they try, not after.
  const coachCount = members.filter((member) => isCoachRole(member.role)).length;
  return (
    <>
      {truncated ? <p><small>Showing the first 200 members. Older memberships are not listed.</small></p> : null}
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
              const provisioned = member.provisionedByThisTeam === true;
              const soleCoach = isCoachRole(member.role) && coachCount === 1;
              return (
                <tr key={member.userId}>
                  <td>
                    <span className="roster-table__member">
                      <span className={`roster-avatar color-${index % 6}`} aria-hidden="true">{member.initials}</span>
                      <span>
                        <strong>{member.displayName}</strong>
                        {isSelf ? <small> (you)</small> : null}
                        {member.role === 'teamLeader' ? <small className="roster-table__leader">Team leader</small> : null}
                        {member.mustSetPassword === true ? <small className="roster-table__pending">Has not signed in yet</small> : null}
                      </span>
                    </span>
                  </td>
                  <td>
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
                        {soleCoach ? (
                          <small id={`role-hint-${member.userId}`} className="roster-table__hint">
                            {isSelf ? "You're" : `${member.displayName} is`} the only coach — make another member a coach first.
                          </small>
                        ) : null}
                      </>
                    ) : <span>{member.role === 'teamLeader' ? 'Team leader' : statusLabel(member.role)}</span>}
                  </td>
                  <td><span className={`roster-status roster-status--${member.status}`}>{statusLabel(member.status)}</span></td>
                  {canAdminister ? (
                    <td className="roster-table__actions">
                      {provisioned ? (
                        <button className="text-button" type="button" disabled={locked} onClick={() => onResetPassword(member)}>Reset password</button>
                      ) : null}
                      {isSelf ? null : (
                        <button className="text-button" type="button" disabled={locked} onClick={() => onSuspend(member)}>Suspend</button>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
