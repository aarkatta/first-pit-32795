import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  FolderLock,
  KanbanSquare,
  ShieldCheck,
  Trophy,
  Users,
  Vote
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isNativeShell } from '@/lib/native-shell';
import { cn } from '@/lib/utils';
import { useReveal } from './use-reveal';

type Status = 'done' | 'working' | 'stuck';
type Row = { task: string; owner: string; status: Status; due: string; type: string };
type Audience = {
  id: string;
  label: string;
  headline: string;
  sub: string;
  boardTitle: string;
  groups: { title: string; tone: 'acid' | 'orange' | 'blue' | 'purple'; rows: Row[] }[];
  toast: { owner: string; text: string; strong: string };
};

const AUDIENCES: Audience[] = [
  {
    id: 'students',
    label: 'Students',
    headline: 'Students and coaches working as one team',
    sub: 'One private place for your FLL team to plan practice, keep the innovation project moving, talk to each other, and get to the official scoresheet in one click.',
    boardTitle: 'Robot practice · Week 6',
    groups: [
      {
        title: 'This week',
        tone: 'acid',
        rows: [
          { task: 'Mission 04 attachment', owner: 'AK', status: 'done', due: 'Nov 02', type: 'Robot build' },
          { task: 'Run 3 timing test', owner: 'JM', status: 'working', due: 'Nov 04', type: 'Practice' },
          { task: 'Line-follow tuning', owner: 'PR', status: 'stuck', due: 'Nov 05', type: 'Code' },
          { task: 'Judging Q&A rehearsal', owner: 'SL', status: 'done', due: 'Nov 06', type: 'Core values' },
          { task: 'Pit display poster', owner: 'TN', status: 'working', due: 'Nov 08', type: 'Outreach' }
        ]
      },
      {
        title: 'Innovation project',
        tone: 'orange',
        rows: [
          { task: 'Expert interview', owner: 'JM', status: 'done', due: 'Oct 22', type: 'Research' },
          { task: 'Prototype v2', owner: 'AK', status: 'working', due: 'Oct 28', type: 'Build' },
          { task: 'Presentation script', owner: 'SL', status: 'done', due: 'Oct 30', type: 'Presentation' }
        ]
      }
    ],
    toast: { owner: 'PR', text: 'Logged practice run', strong: '315 pts' }
  },
  {
    id: 'coaches',
    label: 'Coaches',
    headline: 'Run the whole season from one place',
    sub: 'Hand out tasks, approve new members, and spot who is stuck. No more juggling spreadsheets.',
    boardTitle: 'Season plan · Regional qualifier',
    groups: [
      {
        title: 'Before qualifier',
        tone: 'blue',
        rows: [
          { task: 'Approve 2 pending members', owner: 'CO', status: 'working', due: 'Nov 01', type: 'Team admin' },
          { task: 'Book practice table', owner: 'CO', status: 'done', due: 'Nov 02', type: 'Logistics' },
          { task: 'Publish travel plan', owner: 'MK', status: 'stuck', due: 'Nov 03', type: 'Logistics' },
          { task: 'Robot design review', owner: 'CO', status: 'working', due: 'Nov 05', type: 'Mentoring' }
        ]
      },
      {
        title: 'Judging prep',
        tone: 'purple',
        rows: [
          { task: 'Core values rubric walk-through', owner: 'MK', status: 'done', due: 'Oct 27', type: 'Judging' },
          { task: 'Mock judging session', owner: 'CO', status: 'working', due: 'Oct 30', type: 'Judging' }
        ]
      }
    ],
    toast: { owner: 'CO', text: 'Approved', strong: '2 new members' }
  },
  {
    id: 'mentors',
    label: 'Mentors',
    headline: 'Help the team without handing out your number',
    sub: 'Answer questions, point the team to trusted FLL resources, and look over builds in a space the coach moderates. Everything stays inside the team.',
    boardTitle: 'Knowledge base · Robot game',
    groups: [
      {
        title: 'Open questions',
        tone: 'purple',
        rows: [
          { task: 'Why does the gyro drift on long turns?', owner: 'JM', status: 'working', due: 'Nov 01', type: 'Question' },
          { task: 'Best attachment for lifting?', owner: 'AK', status: 'done', due: 'Oct 30', type: 'Question' },
          { task: 'Color sensor calibration', owner: 'PR', status: 'stuck', due: 'Nov 02', type: 'Question' }
        ]
      },
      {
        title: 'Resources',
        tone: 'acid',
        rows: [
          { task: 'Prime Lessons: PID line follower', owner: 'MN', status: 'done', due: 'Oct 20', type: 'Link' },
          { task: 'BIOGLOW missions video', owner: 'MN', status: 'working', due: 'Nov 04', type: 'Link' }
        ]
      }
    ],
    toast: { owner: 'MN', text: 'Answered', strong: '3 questions' }
  },
  {
    id: 'parents',
    label: 'Parents',
    headline: 'Know what is happening, without the group chat',
    sub: 'You see the schedule and the polls the coach shares with families. Student work stays private.',
    boardTitle: 'Family view · Upcoming',
    groups: [
      {
        title: 'Coming up',
        tone: 'blue',
        rows: [
          { task: 'Practice — Library room B', owner: 'CO', status: 'done', due: 'Nov 02', type: 'Practice' },
          { task: 'Regional qualifier', owner: 'CO', status: 'working', due: 'Nov 16', type: 'Tournament' },
          { task: 'Team dinner', owner: 'MK', status: 'working', due: 'Nov 18', type: 'Social' }
        ]
      },
      {
        title: 'Polls',
        tone: 'orange',
        rows: [
          { task: 'Carpool for Nov 16', owner: 'MK', status: 'working', due: 'Nov 10', type: 'Poll' },
          { task: 'Snack sign-up', owner: 'MK', status: 'done', due: 'Nov 01', type: 'Poll' }
        ]
      }
    ],
    toast: { owner: 'MK', text: 'Poll closed', strong: '11 votes' }
  },
  {
    id: 'scorers',
    label: 'Scorers',
    headline: 'Score every run with the official scoresheet',
    sub: 'The official FIRST robot game scoresheet is one click from the team\'s board, so every run is scored against this season\'s real missions and rules.',
    boardTitle: 'Match history · Season',
    groups: [
      {
        title: 'Practice runs',
        tone: 'acid',
        rows: [
          { task: 'Run 14 — full table', owner: 'PR', status: 'done', due: '315 pts', type: '2:30' },
          { task: 'Run 13 — full table', owner: 'AK', status: 'done', due: '290 pts', type: '2:30' },
          { task: 'Run 12 — missions 1–6', owner: 'JM', status: 'working', due: '170 pts', type: '1:12' },
          { task: 'Run 11 — full table', owner: 'PR', status: 'stuck', due: '145 pts', type: '2:30' }
        ]
      },
      {
        title: 'Official',
        tone: 'purple',
        rows: [{ task: 'Scrimmage — Round 1', owner: 'CO', status: 'done', due: '265 pts', type: '2:30' }]
      }
    ],
    toast: { owner: 'PR', text: 'New season best', strong: '315 pts' }
  }
];

const STATUS: Record<Status, { label: string; className: string }> = {
  done: { label: 'Done', className: 'bg-done' },
  working: { label: 'Working on it', className: 'bg-working' },
  stuck: { label: 'Stuck', className: 'bg-stuck' }
};

const TONE: Record<Audience['groups'][number]['tone'], string> = {
  acid: '#7e9d10',
  orange: '#ff6b35',
  blue: '#3157f5',
  purple: '#7759ff'
};

const AVATAR: Record<string, string> = {
  AK: 'bg-[#ffe1d1] text-[#a3431f]',
  JM: 'bg-[#e6defe] text-[#6040a8]',
  PR: 'bg-[#dcf1d0] text-[#377229]',
  SL: 'bg-[#ffeebd] text-[#886417]',
  TN: 'bg-[#d8edf2] text-[#216c7a]',
  CO: 'bg-[#101d18] text-[#c8f135]',
  MK: 'bg-[#e6defe] text-[#6040a8]',
  MN: 'bg-[#ffe1d1] text-[#a3431f]'
};

function Avatar({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn('inline-grid size-6 shrink-0 place-items-center rounded-full text-[9px] font-extrabold', AVATAR[id] ?? 'bg-paper-deep text-ink', className)}>
      {id}
    </span>
  );
}

function BoardPreview({ audience }: { audience: Audience }) {
  return (
    <div
      key={audience.id}
      className="relative grid w-full max-w-[640px] grid-cols-[40px_minmax(0,1fr)] rounded-2xl border border-line bg-white shadow-float animate-pop max-md:grid-cols-1"
      aria-hidden="true"
    >
      <div className="grid content-start justify-items-center gap-4 rounded-l-2xl border-r border-line bg-[#fbfcf8] py-4 max-md:hidden">
        <span className="grid size-[22px] place-items-center rounded-md bg-acid text-[9px] font-extrabold text-acid-ink">FP</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className="block size-3 rounded-[3px] bg-[#d8ddd4]" />
        ))}
      </div>
      <div className="min-w-0 overflow-hidden px-5 pb-5 pt-4">
        <div className="mb-2 flex items-center justify-between font-display text-lg font-bold">
          <span>{audience.boardTitle}</span>
          <span className="tracking-[2px] text-[#9aa09b]">•••</span>
        </div>
        <div className="mb-5 flex gap-4 border-b border-line pb-2 text-xs text-muted">
          <b className="relative font-semibold text-ink after:absolute after:-bottom-[9px] after:left-0 after:right-0 after:h-0.5 after:bg-blue">Main table</b>
          <span>Files</span>
          <span>Scores</span>
          <span>+</span>
        </div>
        {audience.groups.map((group) => (
          <div key={group.title} className="mb-5 last:mb-0" style={{ '--group': TONE[group.tone] } as CSSProperties}>
            <div className="mb-2 text-sm font-semibold" style={{ color: TONE[group.tone] }}>
              {group.title}
            </div>
            <div className="grid min-h-[26px] grid-cols-[minmax(0,1.5fr)_44px_108px_62px_minmax(0,1fr)] items-center border-b border-[#edf0ea] border-l-4 border-l-transparent text-[11px] text-muted max-md:grid-cols-[minmax(0,1.4fr)_36px_96px_56px]">
              <span className="pl-3">Task</span>
              <span className="text-center">Owner</span>
              <span className="text-center">Status</span>
              <span className="text-center">Due</span>
              <span className="text-center max-md:hidden">Type</span>
            </div>
            {group.rows.map((row, index) => (
              <div
                key={row.task}
                className="grid min-h-8 grid-cols-[minmax(0,1.5fr)_44px_108px_62px_minmax(0,1fr)] items-center border-b border-[#edf0ea] border-l-4 border-l-[var(--group)] text-xs transition-colors hover:bg-[#f8faf6] max-md:grid-cols-[minmax(0,1.4fr)_36px_96px_56px]"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <span className="truncate border-r border-[#edf0ea] py-2 pl-3 pr-2">{row.task}</span>
                <span className="grid h-8 place-items-center border-r border-[#edf0ea]">
                  <Avatar id={row.owner} />
                </span>
                <span className={cn('grid h-8 place-items-center text-[11.5px] font-semibold text-white', STATUS[row.status].className)}>
                  {STATUS[row.status].label}
                </span>
                <span className="grid h-8 place-items-center border-r border-[#edf0ea] text-center">{row.due}</span>
                <span className="grid h-8 place-items-center truncate px-1 text-center text-ink-soft max-md:hidden">{row.type}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div
        key={`toast-${audience.id}`}
        className="absolute -right-4 top-[34%] flex items-center gap-3 rounded-2xl border-2 border-[#f2b6dc] bg-white py-3 pl-3 pr-4 text-base shadow-float animate-float max-md:-bottom-6 max-md:right-3 max-md:top-auto max-md:text-sm"
        style={{ animationDelay: '600ms' }}
      >
        <Avatar id={audience.toast.owner} className="size-10 text-[13px]" />
        <span className="whitespace-nowrap">
          {audience.toast.text} · <b>{audience.toast.strong}</b>
        </span>
        <span className="grid h-9 place-items-center rounded-md bg-done px-5 text-[15px] font-semibold text-white">Done</span>
      </div>
    </div>
  );
}

// Store marks: paths from simple-icons (CC0); the marks themselves are Apple's
// and Google's trademarks. Badges only announce the apps, so they are not links.
const APPLE_PATH = 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';
const GOOGLE_PLAY_PARTS = [
  { fill: '#FFC900', d: 'M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594z' },
  { fill: '#00A0FF', d: 'M1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924z' },
  { fill: '#00D66F', d: 'M13.544 10.989l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973z' },
  { fill: '#F53349', d: 'M13.544 13.056l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z' }
];

function StoreBadge({ store }: { store: 'apple' | 'google' }) {
  const apple = store === 'apple';
  return (
    <li className="inline-flex min-w-[190px] items-center gap-3 rounded-xl border border-[#3a3a3a] bg-[#111] px-4 py-2.5 text-white shadow-float">
      <svg viewBox="0 0 24 24" className="size-8 shrink-0" aria-hidden="true">
        {apple ? <path fill="#fff" d={APPLE_PATH} /> : GOOGLE_PLAY_PARTS.map((part) => <path key={part.fill} fill={part.fill} d={part.d} />)}
      </svg>
      <span className="grid leading-none">
        <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-white/80">{apple ? 'Coming soon to the' : 'Coming soon to'}</span>
        <span className="mt-1 text-[21px] font-semibold tracking-[-0.01em]">{apple ? 'App Store' : 'Google Play'}</span>
      </span>
    </li>
  );
}

const FEATURES = [
  { icon: KanbanSquare, title: 'Tracker', copy: 'Who is doing what, by when. Practice, build, and project work on one board.', tone: 'text-blue bg-blue/10' },
  { icon: Users, title: 'Roster & roles', copy: 'Invite students, mentors, and parents by role, approve who joins, and keep every change on the record.', tone: 'text-orange bg-orange/12' },
  { icon: ShieldCheck, title: 'Safety controls', copy: 'Private by default, with moderation and reporting built in and a coach deciding what each role can see.', tone: 'text-purple bg-purple/12' },
  { icon: FolderLock, title: 'Storage area', copy: 'Files and photos that stay with the team, checked on upload, and shared only with the people who should see them.', tone: 'text-[#377229] bg-[#dcf1d0]' },
  { icon: BookOpen, title: 'Resources', copy: 'Trusted FLL links in one place: season materials, tutorials, SPIKE Prime lessons, and the missions video.', tone: 'text-blue bg-blue/10' },
  { icon: Vote, title: 'Polls & questions', copy: 'Make quick decisions with a poll, and keep the answers to good questions around for next season.', tone: 'text-orange bg-orange/12' },
  { icon: Trophy, title: 'Scorer', copy: 'Open the official FIRST scoresheet in one click and score each run against this season\'s missions.', tone: 'text-[#886417] bg-[#ffeebd]' },
  { icon: BarChart3, title: 'Dashboard', copy: 'Your day at a glance: what is assigned to you, what is coming up, and how each judging area is progressing.', tone: 'text-purple bg-purple/12' }
];

const STEPS = [
  { n: '01', title: 'Create your team', copy: 'A coach sets up the team and decides the basics: who can see what, and who can message whom.' },
  { n: '02', title: 'Invite by role', copy: 'Students, mentors, and parents join only when they are invited. Every approval and role change is recorded.' },
  { n: '03', title: 'Run the season', copy: 'Plan, practice, and score in one place, from kickoff to the last tournament.' }
];

const STATS = [
  { value: 48, suffix: '', label: 'Season tasks already on a new team\'s board' },
  { value: 100, suffix: '%', label: 'Of changes are checked on the server before they are saved' },
  { value: 0, suffix: '', label: 'Public profiles. There are none.' },
  { value: 5, suffix: '', label: 'Roles, each starting with only the access it needs' }
];

const FAQ = [
  { q: 'Is First Pit safe for students under 13?', a: 'Yes. Teams are invite-only, nobody can search for your team, and private student information stays inside the team. Invitations, role changes, and moderation are all logged and cannot be edited. Coaches decide what parents and students can see.' },
  { q: 'What can parents see?', a: 'Only what the coach allows. By default, parents see the team schedule and the polls shared with families, and never private student work.' },
  { q: 'Does it work on phones?', a: 'Yes. First Pit works in any phone browser, so it is just as usable at the pit table as it is at home. A native iOS app is on the way.' },
  { q: 'What does it cost?', a: 'Nothing during the pilot. No credit card, no ads, and we never sell your team\'s data.' },
  { q: 'Where is our data stored?', a: 'On Google Firebase. Each team\'s data is walled off from every other team, and uploads are checked for type and size before anyone can see them.' }
];

function useCountUp(target: number, active: boolean, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, target, duration]);
  return value;
}

function Stat({ value, suffix, label, active }: { value: number; suffix: string; label: string; active: boolean }) {
  const count = useCountUp(value, active);
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-5xl font-bold tracking-[-0.04em] text-acid md:text-6xl">
        {count}
        {suffix}
      </span>
      <span className="max-w-[16rem] text-[15px] leading-snug text-[#b9c7bf]">{label}</span>
    </div>
  );
}

export function LandingPage() {
  const [audienceId, setAudienceId] = useState(AUDIENCES[0].id);
  const audience = useMemo(() => AUDIENCES.find((item) => item.id === audienceId) ?? AUDIENCES[0], [audienceId]);
  const rootRef = useRef<HTMLElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsActive, setStatsActive] = useState(false);
  useReveal(rootRef);

  useEffect(() => {
    const node = statsRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setStatsActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStatsActive(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <main ref={rootRef} className="min-h-dvh bg-white font-sans text-ink">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1360px] items-center gap-7 px-5 py-3.5 md:px-8">
          <Link to="/" className="flex items-center gap-2.5 font-display text-[17px] font-bold uppercase tracking-[0.05em]">
            <span className="grid size-9 place-items-center rounded-lg bg-acid text-[13px] font-extrabold text-acid-ink shadow-press-acid">FP</span>
            First Pit
          </Link>
          <nav aria-label="Product" className="ml-3 hidden gap-6 text-[15px] font-medium md:flex">
            <a href="#features" className="transition-colors hover:text-blue">Features</a>
            <a href="#how" className="transition-colors hover:text-blue">How it works</a>
            <a href="#safety" className="transition-colors hover:text-blue">Safety</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Button asChild variant="ghost" className="hidden md:inline-flex">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/auth">Join a team</Link>
            </Button>
            <Button asChild>
              <Link to="/auth">
                Get started <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto grid w-full max-w-[1360px] grid-cols-1 items-center gap-12 px-5 pb-20 pt-16 md:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pt-24">
          <div className="animate-rise">
            <h1 key={audience.id} className="m-0 mb-6 max-w-[12ch] font-display text-[clamp(42px,5.4vw,76px)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance animate-rise">
              {audience.headline}
            </h1>
            <p key={`sub-${audience.id}`} className="m-0 mb-7 max-w-[34rem] text-[clamp(17px,1.5vw,22px)] leading-relaxed text-ink-soft animate-rise" style={{ animationDelay: '60ms' }}>
              {audience.sub}
            </p>
            {/*
              These are toggle buttons, not tabs: the region they change is the
              decorative board preview, which is aria-hidden. Announcing a tab
              set whose panels do not exist misleads screen-reader users, so
              this is a plain group of pressed/unpressed buttons.
            */}
            <div role="group" aria-label="Who it is for" className="mb-9 flex flex-wrap gap-2.5">
              {AUDIENCES.map((item) => {
                const active = item.id === audience.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAudienceId(item.id)}
                    className={cn(
                      'inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-full border-0 px-[18px] text-base font-medium transition-all duration-150 ease-out-expo hover:-translate-y-px',
                      active ? 'bg-acid text-acid-ink shadow-press-acid' : 'bg-paper-deep text-ink hover:bg-[#e7ebe2]'
                    )}
                  >
                    {active ? <Check className="size-4" /> : null}
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="xl">
                <Link to="/auth">
                  Get started <ArrowRight className="size-5!" />
                </Link>
              </Button>
              <Button asChild variant="link" size="lg">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-[15px] text-muted">No public profiles. Invite-only. Made with young teams in mind.</p>
            {/* Not links: there is no store listing yet. Hidden inside the iOS
                app, which is already the thing they advertise. */}
            {isNativeShell() ? null : (
              <ul className="m-0 mt-6 flex list-none flex-wrap items-center gap-3 p-0" aria-label="Mobile apps coming soon">
                <StoreBadge store="apple" />
                <StoreBadge store="google" />
              </ul>
            )}
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <BoardPreview audience={audience} />
          </div>
        </div>
      </section>

      {/* ---------- Marquee ---------- */}
      <section className="border-y border-line bg-paper py-6">
        <p className="m-0 mb-4 text-center text-lg font-medium md:text-xl">Everything your team uses, all in one place</p>
        <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <ul className="m-0 flex w-max list-none gap-12 p-0 font-display text-2xl font-bold tracking-[-0.02em] text-ink/80 animate-marquee motion-reduce:animate-none md:text-3xl">
            {[...FEATURES, ...FEATURES].map((f, i) => (
              <li key={`${f.title}-${i}`} className="flex items-center gap-3 whitespace-nowrap">
                <f.icon className="size-6 text-acid-deep" /> {f.title}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="mx-auto w-full max-w-[1360px] px-5 py-24 md:px-8">
        <div className="mb-12 max-w-[42rem]" data-reveal>
          <Badge variant="blue" className="mb-4">Features</Badge>
          <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">Everything the team needs, in one place.</h2>
          <p className="m-0 text-lg leading-relaxed text-ink-soft">The tracker, files, questions, polls, and scorer all know about each other, so nobody has to copy things between apps.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, index) => (
            <Card key={feature.title} data-reveal style={{ '--reveal-delay': `${(index % 4) * 70}ms` } as CSSProperties} className="group hover:-translate-y-1.5 hover:border-line-strong hover:shadow-lift">
              <span className={cn('grid size-12 place-items-center rounded-xl transition-transform duration-300 ease-spring group-hover:-translate-y-0.5 group-hover:scale-110', feature.tone)}>
                <feature.icon className="size-6" />
              </span>
              <CardHeader>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.copy}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="bg-paper">
        <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-12 px-5 py-24 md:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div data-reveal>
            <Badge variant="orange" className="mb-4">How it works</Badge>
            <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">Ready before your next practice.</h2>
            <p className="m-0 mb-8 text-lg leading-relaxed text-ink-soft">There is nothing to import and no long setup. Create the team, invite people, and start planning.</p>
            <Button asChild variant="ink" size="lg">
              <Link to="/auth">
                Create a team <ArrowRight />
              </Link>
            </Button>
          </div>
          <ol className="m-0 grid list-none gap-4 p-0">
            {STEPS.map((step, index) => (
              <li key={step.n} data-reveal style={{ '--reveal-delay': `${index * 90}ms` } as CSSProperties}>
                <Card className="flex-row items-start gap-6 hover:-translate-y-1 hover:shadow-lift">
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-forest font-display text-lg font-bold text-acid shadow-press-ink">{step.n}</span>
                  <CardContent className="gap-1.5">
                    <CardTitle>{step.title}</CardTitle>
                    <CardDescription>{step.copy}</CardDescription>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Safety ---------- */}
      <section id="safety" className="bg-forest text-white">
        <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-14 px-5 py-24 md:px-8 lg:grid-cols-2">
          <div data-reveal>
            <Badge className="mb-4">
              <ShieldCheck /> Youth safety
            </Badge>
            <h2 className="m-0 mb-5 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-white">Built to keep students safe.</h2>
            <p className="m-0 mb-8 max-w-[34rem] text-lg leading-relaxed text-[#b9c7bf]">Kids use this app, so we do not cut corners. Every change is checked on the server before it is saved, nothing is shared unless the coach allows it, and anything sensitive is written to a log that cannot be edited.</p>
            <ul className="m-0 grid list-none gap-3 p-0 text-[15px]">
              {['Teams are invite-only, and nobody can search for them', 'Private messages are off unless the coach turns them on', 'The coach decides what parents can see', 'Files are checked before anyone can open them', 'We do not collect location or anything else we do not need'].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-acid text-acid-ink">
                    <Check className="size-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div ref={statsRef} className="grid grid-cols-2 gap-x-8 gap-y-10 self-center rounded-3xl border border-white/10 bg-forest-card p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_rgba(0,0,0,0.3)] md:p-10" data-reveal>
            {STATS.map((stat) => (
              <Stat key={stat.label} {...stat} active={statsActive} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-12 px-5 py-24 md:px-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <div data-reveal>
          <Badge variant="secondary" className="mb-4">FAQ</Badge>
          <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">Questions we hear a lot.</h2>
          <p className="m-0 text-lg leading-relaxed text-ink-soft">Have a different question? Ask your coach, or get in touch and we will help you get the team set up.</p>
        </div>
        <Accordion type="single" collapsible defaultValue="item-0" className="rounded-2xl border border-line bg-white px-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(17,24,39,0.06)]" data-reveal>
          {FAQ.map((item, index) => (
            <AccordionItem key={item.q} value={`item-${index}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="px-5 pb-24 md:px-8">
        <div className="relative mx-auto flex w-full max-w-[1360px] flex-col items-center gap-6 overflow-hidden rounded-[32px] bg-acid px-6 py-16 text-center text-acid-ink shadow-press-acid md:py-20" data-reveal>
          <span className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full border border-acid-ink/15" aria-hidden="true" />
          <span className="pointer-events-none absolute -bottom-24 -right-10 size-80 rounded-full border border-acid-ink/15" aria-hidden="true" />
          <Users className="size-10" />
          <h2 className="m-0 max-w-[16ch] font-display text-[clamp(32px,4.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">
            Bring your team in the{' '}
            <strong className="relative inline-block font-bold">
              pit
              <svg
                aria-hidden="true"
                viewBox="0 0 120 22"
                preserveAspectRatio="none"
                className="absolute -bottom-[0.18em] left-[-4%] h-[0.32em] w-[108%] text-acid-ink"
              >
                <path
                  d="M3 14 C 14 6, 24 20, 36 12 S 58 6, 70 13 S 92 20, 104 10 S 114 8, 117 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="[stroke-dasharray:200] [stroke-dashoffset:200] motion-safe:animate-[squiggle_0.9s_var(--ease-out-expo)_0.4s_forwards] motion-reduce:[stroke-dashoffset:0]"
                />
              </svg>
            </strong>
          </h2>
          <p className="m-0 max-w-[36rem] text-lg leading-relaxed text-acid-ink/80">It is free for FLL teams during the pilot. Setting up takes about a minute, and then the whole team is in one place.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="ink" size="xl">
              <Link to="/auth">
                Get started <ArrowRight className="size-5!" />
              </Link>
            </Button>
            <Button asChild variant="inverse" size="xl">
              <Link to="/auth">Join a team</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted md:px-8">
          <span className="flex items-center gap-2.5 font-display font-bold uppercase tracking-[0.05em] text-ink">
            <span className="grid size-7 place-items-center rounded-md bg-acid text-[10px] font-extrabold text-acid-ink">FP</span>
            First Pit
          </span>
          <span>Made for FIRST LEGO League teams. Not affiliated with FIRST or the LEGO Group.</span>
          <span className="flex gap-5">
            <a href="#safety" className="hover:text-ink">Safety</a>
            <Link to="/auth" className="hover:text-ink">Log in</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
