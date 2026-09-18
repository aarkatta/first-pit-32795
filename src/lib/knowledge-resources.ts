/**
 * Curated external FIRST LEGO League links shown on the Knowledge page's
 * Resources tab. Static and identical for every team — nothing here is stored
 * in Firestore, so no rules or callables are involved.
 */
export type KnowledgeResource = {
  id: string;
  title: string;
  description: string;
  url: string;
};

export const KNOWLEDGE_RESOURCES: readonly KnowledgeResource[] = [
  {
    id: 'first-resources',
    title: 'FIRST Resources',
    description: 'Mission building instructions, field setup, scoring and judging materials.',
    url: 'https://www.firstinspires.org/resources/library/fll/season-materials'
  },
  {
    id: 'fin-playbook',
    title: 'FIN Playbook',
    description: 'Help starting a new team and running the season, Innovation Project and Robot Design.',
    url: 'https://playbook.firstindianarobotics.org/mod/wiki/view.php?id=37'
  },
  {
    id: 'fll-tutorials',
    title: 'FLL Tutorials',
    description: 'Presentations and guidance on the Innovation Project, Robot Design, Robot Game and Core Values.',
    url: 'https://flltutorials.com/en/'
  },
  {
    id: 'prime-lessons',
    title: 'Prime Lessons',
    description: 'Lessons for programming LEGO Education SPIKE Prime.',
    url: 'https://primelessons.org/en/'
  },
  {
    id: 'excel-in-fll',
    title: 'Your Guide to Excel in FLL',
    description: 'The book Your Guide to Excel in FLL.',
    url: 'https://drive.google.com/file/d/10Dh72aX0484tXrPlrL7MJ0hEzF3pRTMA/view'
  },
  {
    id: 'bioglow-season-video',
    title: 'BIOGLOW Season Video',
    description: 'BIOGLOW Robot Game Missions Video (Founders Edition): explains this season\'s missions.',
    url: 'https://www.youtube.com/watch?v=uhZZ8O1StiQ'
  },
  {
    id: 'first-score-calculator',
    title: 'FIRST Score Calculator',
    description: 'The official FLL score calculator for the BIOGLOW season.',
    url: 'https://eventhub.firstinspires.org/scoresheet'
  }
];
