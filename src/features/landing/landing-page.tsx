import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  FolderLock,
  KanbanSquare,
  MessageSquareLock,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Vote,
  Video
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useReveal } from './use-reveal';

const HeroScene = lazy(() => import('./hero-scene'));

function canUseWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (navigator.userAgent.includes('jsdom')) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

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
    sub: 'The private workspace where FLL teams plan practice, track the innovation project, talk safely, and log every match score together.',
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
    headline: 'Run the whole season from one board',
    sub: 'Assign work, approve members, post announcements, and see who needs help — without juggling group chats and spreadsheets.',
    boardTitle: 'Season plan · Regional qualifier',
    groups: [
      {
        title: 'Before qualifier',
        tone: 'blue',
        rows: [
          { task: 'Approve 2 pending members', owner: 'CO', status: 'working', due: 'Nov 01', type: 'Team admin' },
          { task: 'Book practice table', owner: 'CO', status: 'done', due: 'Nov 02', type: 'Logistics' },
          { task: 'Publish travel plan', owner: 'MK', status: 'stuck', due: 'Nov 03', type: 'Announcement' },
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
    headline: 'Share know-how, not your phone number',
    sub: 'Answer questions, post how-to videos, and review builds inside a moderated, team-scoped space designed for working with minors.',
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
        title: 'How-to videos',
        tone: 'acid',
        rows: [
          { task: 'PID line follower in 8 min', owner: 'MN', status: 'done', due: 'Oct 20', type: 'Video' },
          { task: 'Mission 07 strategy', owner: 'MN', status: 'working', due: 'Nov 04', type: 'Video' }
        ]
      }
    ],
    toast: { owner: 'MN', text: 'Answered', strong: '3 questions' }
  },
  {
    id: 'parents',
    label: 'Parents',
    headline: 'See the schedule. Skip the group chat.',
    sub: 'Parents get exactly what the team policy allows — calendar, announcements, and polls — with no access to student conversations.',
    boardTitle: 'Family view · Upcoming',
    groups: [
      {
        title: 'Calendar',
        tone: 'blue',
        rows: [
          { task: 'Practice — Library room B', owner: 'CO', status: 'done', due: 'Nov 02', type: 'Event' },
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
    headline: 'Score every run. Watch the curve climb.',
    sub: 'A rubric-accurate robot game scorer with per-mission breakdowns and a full practice history for the whole season.',
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
          <span>Calendar</span>
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

const FEATURES = [
  { icon: KanbanSquare, title: 'Tracker', copy: 'Board and list views for practice, build, and project work with owners, status, and due dates.', tone: 'text-blue bg-blue/10' },
  { icon: CalendarDays, title: 'Calendar', copy: 'Practices, tournaments, and deadlines in one place, with reminders that respect team policy.', tone: 'text-orange bg-orange/12' },
  { icon: MessageSquareLock, title: 'Team chat', copy: 'Channels and announcements that coaches can moderate. No DMs unless the team turns them on.', tone: 'text-purple bg-purple/12' },
  { icon: FolderLock, title: 'Storage area', copy: 'Files and photos scoped to the team, validated on upload, and shared only where policy allows.', tone: 'text-[#377229] bg-[#dcf1d0]' },
  { icon: Video, title: 'How-to videos', copy: 'Mentors record it once; every student can rewatch the build, the code, or the strategy.', tone: 'text-blue bg-blue/10' },
  { icon: Vote, title: 'Polls & questions', copy: 'Decide fast with team polls and keep a searchable Q&A that outlives the season.', tone: 'text-orange bg-orange/12' },
  { icon: Trophy, title: 'Scorer', copy: 'Rubric-accurate robot game scoring with per-mission detail and a full practice history.', tone: 'text-[#886417] bg-[#ffeebd]' },
  { icon: BarChart3, title: 'Dashboard', copy: 'Today at a glance: assigned work, upcoming events, unread messages, and the score trend.', tone: 'text-purple bg-purple/12' }
];

const STEPS = [
  { n: '01', title: 'Create your team', copy: 'A coach creates the private workspace and sets the team policy: who can see what, who can message whom.' },
  { n: '02', title: 'Invite by role', copy: 'Students, mentors, and parents join by invitation only. Every role change and approval is audited.' },
  { n: '03', title: 'Run the season', copy: 'Plan, practice, score, and communicate in one place — from kickoff to the championship.' }
];

const STATS = [
  { value: 315, suffix: '', label: 'Season-best score, tracked run by run' },
  { value: 100, suffix: '%', label: 'Of writes go through server-side authorization' },
  { value: 0, suffix: '', label: 'Public profiles. Ever.' },
  { value: 5, suffix: '', label: 'Roles with least-privilege defaults' }
];

const FAQ = [
  { q: 'Is First Pit safe for students under 13?', a: 'Yes. Teams are invite-only, there is no public discovery, direct messaging is off by default, and every sensitive change (invitations, role changes, moderation) is written to an immutable audit log. Coaches control what parents and students can see.' },
  { q: 'Can parents see the chat?', a: 'Only if the team policy allows it. By default parents see the calendar, announcements, and polls, and never student conversations.' },
  { q: 'Does it work on phones?', a: 'First Pit is a responsive web app first and ships as an iOS app through Capacitor, so the same workspace works at the pit table and at home.' },
  { q: 'What does it cost?', a: 'The pilot is free for FLL teams. There is no credit card, no ads, and no selling of team data.' },
  { q: 'Where is our data stored?', a: 'In Google Firebase (Cloud Firestore and Storage), scoped per team with deny-by-default security rules. Uploads are validated for type, size, and access scope before they are visible.' }
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
  const [webgl] = useState(canUseWebGL);
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
            <Link to="/states" className="transition-colors hover:text-blue">State lab</Link>
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
        {webgl ? (
          <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
            <div className="absolute inset-y-0 right-0 w-[54%]">
              <Suspense fallback={null}>
                <HeroScene />
              </Suspense>
            </div>
          </div>
        ) : null}
        <div className="relative mx-auto grid w-full max-w-[1360px] grid-cols-1 items-center gap-12 px-5 pb-20 pt-16 md:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pt-24">
          <div className="animate-rise">
            <Badge variant="forest" className="mb-6">
              <Sparkles /> Built for FIRST LEGO League
            </Badge>
            <h1 key={audience.id} className="m-0 mb-6 max-w-[12ch] font-display text-[clamp(42px,5.4vw,76px)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance animate-rise">
              {audience.headline}
            </h1>
            <p key={`sub-${audience.id}`} className="m-0 mb-7 max-w-[34rem] text-[clamp(17px,1.5vw,22px)] leading-relaxed text-ink-soft animate-rise" style={{ animationDelay: '60ms' }}>
              {audience.sub}
            </p>
            <div role="tablist" aria-label="Who it is for" className="mb-9 flex flex-wrap gap-2.5">
              {AUDIENCES.map((item) => {
                const active = item.id === audience.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
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
            <p className="mt-5 text-[15px] text-muted">No public profiles ✦ Invite-only teams ✦ Built for youth safety</p>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <BoardPreview audience={audience} />
          </div>
        </div>
      </section>

      {/* ---------- Marquee ---------- */}
      <section className="border-y border-line bg-paper py-6">
        <p className="m-0 mb-4 text-center text-lg font-medium md:text-xl">Everything a team needs in one private place</p>
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
          <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">One workspace. Every part of the season.</h2>
          <p className="m-0 text-lg leading-relaxed text-ink-soft">Modules that share one data model, one permission system, and one audit trail — so the team never has to leave.</p>
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
            <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">Up and running before the next practice.</h2>
            <p className="m-0 mb-8 text-lg leading-relaxed text-ink-soft">No setup wizard, no imports. Create the team, invite people by role, and start planning.</p>
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
            <h2 className="m-0 mb-5 font-display text-[clamp(32px,4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-white">Private by design. Audited by default.</h2>
            <p className="m-0 mb-8 max-w-[34rem] text-lg leading-relaxed text-[#b9c7bf]">Hiding a button is not authorization. Every write goes through server-side checks and deny-by-default security rules, and every sensitive change is written to an immutable audit log.</p>
            <ul className="m-0 grid list-none gap-3 p-0 text-[15px]">
              {['Invite-only teams — no public discovery', 'Direct messaging off unless the coach turns it on', 'Parent visibility controlled by explicit team policy', 'Files validated for type, size, and scope before sharing', 'No precise location, no unnecessary child data'].map((item) => (
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
          <h2 className="m-0 mb-4 font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">Questions coaches ask first.</h2>
          <p className="m-0 text-lg leading-relaxed text-ink-soft">Still unsure? Open the <Link to="/emulator" className="text-blue underline-offset-4 hover:underline">local setup guide</Link> or try the state lab.</p>
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
          <h2 className="m-0 max-w-[16ch] font-display text-[clamp(32px,4.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">Bring your team into the pit.</h2>
          <p className="m-0 max-w-[36rem] text-lg leading-relaxed text-acid-ink/80">Free for FLL teams during the pilot. Create the workspace in a minute, invite by role, and run the season together.</p>
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
          <span>Private team workspace for FIRST LEGO League. Not affiliated with FIRST or the LEGO Group.</span>
          <span className="flex gap-5">
            <a href="#safety" className="hover:text-ink">Safety</a>
            <Link to="/states" className="hover:text-ink">Status</Link>
            <Link to="/auth" className="hover:text-ink">Log in</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
