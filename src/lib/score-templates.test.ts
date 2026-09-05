import { describe, expect, it } from 'vitest';
import { STARTER_DEFINITION, currentSeasonLabel } from './score-templates';

describe('scorer starter rubric', () => {
  it('rolls the season label over in August, when the new season starts', () => {
    expect(currentSeasonLabel(new Date('2026-08-01T12:00:00Z'))).toBe('2026-2027');
    expect(currentSeasonLabel(new Date('2026-12-31T12:00:00Z'))).toBe('2026-2027');
    // Still the previous season until August comes round again.
    expect(currentSeasonLabel(new Date('2026-07-31T12:00:00Z'))).toBe('2025-2026');
    expect(currentSeasonLabel(new Date('2027-01-05T12:00:00Z'))).toBe('2026-2027');
  });

  it('produces a template the definition parser accepts', () => {
    // The form parses `id|name|max points` per line; a malformed starter would
    // fail on submit and be worse than the empty textarea it replaced.
    const lines = [...STARTER_DEFINITION.missions.split('\n'), ...STARTER_DEFINITION.deductions.split('\n')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const [id, name, points] = line.split('|');
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(name.trim().length).toBeGreaterThan(0);
      expect(Number(points)).toBeGreaterThan(0);
    }
  });

  it('keeps unique mission ids so scores cannot collide', () => {
    const ids = STARTER_DEFINITION.missions.split('\n').map((line) => line.split('|')[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
