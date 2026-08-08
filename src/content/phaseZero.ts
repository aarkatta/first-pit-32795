export const routeStrategy = [
  'Use BrowserRouter for one shared route model across web and Capacitor.',
  'Let Vercel rewrite client-side routes to index.html.',
  'Keep native packaging focused on the same build output in dist.'
];

export const confirmedDecisions = [
  {
    title: 'Firestore for the MVP database',
    body: 'Use Cloud Firestore for collection-oriented team data and scoped records.'
  },
  {
    title: 'Web first, native-ready shell',
    body: 'Build the responsive web app first and keep the shell Capacitor-compatible.'
  },
  {
    title: 'Firebase emulator support',
    body: 'Keep Auth, Firestore, Storage, and Functions emulators in the repo for local development.'
  }
];

export const openBlockers = [
  {
    title: 'Youth safety policy',
    details: ['pilot age', 'parent consent', 'coach approval', 'retention', 'deletion', 'recovery', 'reporting']
  },
  {
    title: 'Direct messaging policy',
    details: ['disabled', 'coach-supervised', 'or a documented policy before implementation']
  },
  {
    title: 'Content audience policy',
    details: ['team-private', 'signed-in community content', 'or mixed by item']
  },
  {
    title: 'File and media limits',
    details: ['type', 'size', 'retention', 'export limits']
  },
  {
    title: 'Scoring and moderation',
    details: ['season scoring model', 'content maintenance', 'moderation staffing', 'one-business-day response target']
  }
];

export const localCommands = [
  'npm install',
  'npm run dev',
  'npm run emulators',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run build'
];

export const exitCriteria = [
  'A new developer can run the web app and Firebase emulators locally.',
  'Development secrets stay out of source control.',
  'CI passes on a clean checkout.',
  'Open decisions are documented as blockers instead of silently assumed.'
];
