import { call } from './callable';

export async function createTeam(name: string): Promise<{ teamId: string }> {
  const trimmedName = name.trim();
  if (trimmedName.length < 2) throw new Error('Team name must be at least two characters.');
  if (trimmedName.length > 80) throw new Error('Team name must be 80 characters or fewer.');

  const result = await call<{ name: string }, { teamId: string }>('createTeam', { name: trimmedName });
  if (!result.teamId) throw new Error('The team could not be created.');
  return result;
}
