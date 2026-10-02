export type KnowledgeTab = 'questions' | 'polls' | 'resources';

/** The Knowledge base tabs, in display order. */
export const knowledgeTabs: KnowledgeTab[] = ['questions', 'polls', 'resources'];

export const isKnowledgeTab = (value: string | null): value is KnowledgeTab => knowledgeTabs.includes(value as KnowledgeTab);

/**
 * The tab a visit opens on: an explicit `?tab=`, else the tab a deep link
 * points into (`?question=` from a moderation report, `?poll=`), else Resources.
 *
 * The How-to Videos tab is gone, and its old links (`?tab=videos`, `?video=`)
 * keep opening Questions, as they did before Resources became the default.
 */
export function initialKnowledgeTab(params: URLSearchParams): KnowledgeTab {
  const requested = params.get('tab');
  if (isKnowledgeTab(requested)) return requested;
  if (requested === 'videos' || params.has('video')) return 'questions';
  if (params.has('question')) return 'questions';
  if (params.has('poll')) return 'polls';
  return 'resources';
}
