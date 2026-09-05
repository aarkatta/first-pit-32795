/**
 * A starter robot-game rubric.
 *
 * The season's official mission list is FIRST's material, so First Pit does not
 * ship it — every definition a team creates is labelled team-defined. What a
 * coach actually needs is to not face an empty pipe-delimited textarea, so this
 * lays out the shape of a robot-game round (a set of mission slots plus the
 * usual precision and penalty deductions) that a coach renames to match the
 * season in a couple of minutes.
 */
export const STARTER_DEFINITION = {
  title: 'Robot game — practice rubric',
  missions: [
    'm01|Mission 01|20',
    'm02|Mission 02|20',
    'm03|Mission 03|20',
    'm04|Mission 04|20',
    'm05|Mission 05|20',
    'm06|Mission 06|20',
    'm07|Mission 07|20',
    'm08|Mission 08|20',
    'precision|Precision tokens remaining|50'
  ].join('\n'),
  deductions: [
    'penalty|Penalties|30',
    'interruption|Equipment interruptions|20'
  ].join('\n')
};

/**
 * The season label a coach most likely wants, e.g. "2026-2027" from August 2026.
 * An FLL season starts in August, so the label rolls over then rather than in
 * January.
 */
export function currentSeasonLabel(now = new Date()): string {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}
