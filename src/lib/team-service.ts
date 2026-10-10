import { call } from './callable';

/** Mirrors `requireTeamNumber` in `functions/src/phase2.ts`, which enforces it. */
export function normalizeTeamNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Team number is required.');
  if (!/^\d{1,8}$/.test(trimmed)) throw new Error('Team number must be 1 to 8 digits.');
  return trimmed;
}

export async function createTeam(name: string, teamNumber: string): Promise<{ teamId: string }> {
  const trimmedName = name.trim();
  if (trimmedName.length < 2) throw new Error('Team name must be at least two characters.');
  if (trimmedName.length > 80) throw new Error('Team name must be 80 characters or fewer.');
  const number = normalizeTeamNumber(teamNumber);

  const result = await call<{ name: string; teamNumber: string }, { teamId: string }>('createTeam', { name: trimmedName, teamNumber: number });
  if (!result.teamId) throw new Error('The team could not be created.');
  return result;
}

export type TeamDetails = { name: string; teamNumber: string };

/** Renames the team and sets its number. Coach / team leader only. */
export async function updateTeamDetails(teamId: string, input: { name: string; teamNumber: string }): Promise<{ teamId: string } & TeamDetails> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new Error('Team name must be at least two characters.');
  if (name.length > 80) throw new Error('Team name must be 80 characters or fewer.');
  return call<{ teamId: string } & TeamDetails, { teamId: string } & TeamDetails>('updateTeamDetails', { teamId, name, teamNumber: normalizeTeamNumber(input.teamNumber) });
}
