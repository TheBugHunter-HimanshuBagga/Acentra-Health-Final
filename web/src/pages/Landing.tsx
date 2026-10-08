// The public landing page, composed the Allotiq way (full-bleed tone sections, giant two-line headlines with one
// serif-italic accent, receipts, a ticker) with ClaimShield's own content. Everything shown here is either a fixed
// fact about the platform or a clearly labelled synthetic example; no live data is needed to read it.
import { ArrowRight, Check, Gauge, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import {
  DITHER_FOREST,
  DITHER_GREEN,
  DitherField,
  Eyebrow,
  Headline,
  KpiBand,
  KpiTile,
  Panel,
  Reveal,
  RevealText,
  RollLabel,
  ScoreReceipt,
  ScrollWords,
  Section,
  StackBar,
  StatusBadge,
  Tag,
  Ticker,
  Wordmark,
} from '@/components/kit'
import { LogoGlobe } from '@/components/kit/logo-globe'
import { ShellHeader } from '@/components/kit/shell-header'
import { useMe } from '@/lib/auth'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '#decides', label: 'How it decides' },
  { href: '#lab', label: 'The Lab' },
  { href: '#loop', label: 'Human in the loop' },
  { href: '#principles', label: 'Principles' },
]

// Illustrative indicators, written the way an investigator reads them. Synthetic.
const SAMPLE = [
  { id: '1', at: 'sample', status: 'pending' as const, text: 'Services dated after a recorded date of death' },
  { id: '2', at: 'sample', status: 'checked_in' as const, text: 'Visit levels far above the provider’s peers' },
  { id: '3', at: 'sample', status: 'approved' as const, text: 'Referrals concentrated on one source' },
  { id: '4', at: 'sample', status: 'bumped' as const, text: 'Two providers share an owner and a building' },
  { id: '5', at: 'sample', status: 'waitlisted' as const, text: 'Same member, same day, same code, twice' },
  { id: '6', at: 'sample', status: 'completed' as const, text: 'Looks unusual, explained by high-acuity members' },
]

const RECEIPT = [
  { key: 'line', label: 'Claim lines (recorded facts)', value: 0.85, weight: 0.4, hint: 'A rule fired on exact fields' },
  { key: 'peer', label: 'Peer comparison', value: 0.6, weight: 0.25, hint: 'Unusual against similar providers' },
  { key: 'self', label: 'Own history', value: 0.35, weight: 0.2, hint: 'Change against the provider’s own past' },
  { key: 'net', label: 'Relationships', value: 0.2, weight: 0.15, hint: 'Ownership, referrals, shared sites' },
]

const TOTAL = RECEIPT.reduce((sum, r) => sum + r.value * r.weight, 0)

const TIMELINE = [
  { at: 'Day 0', title: 'Flagged', body: 'Independent channels agree; an evidence pack is sealed and hashed.', done: true },
  { at: 'Day 1', title: 'Reviewed', body: 'An investigator reads the evidence, the doubts and what is missing.', done: true },
  { at: 'Day 2', title: 'Approved by a second person', body: 'High-impact actions never rest on one signature.', done: true },
  { at: 'Day 9', title: 'Closed with a rationale', body: 'The outcome becomes a lesson, only after another person approves it.', done: false },
]

function Why({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[15px] text-fg-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-volt text-brand-ink">
        <Check className="size-3" strokeWidth={3.5} />
      </span>
      {children}
    </li>
  )
}

export function LandingPage() {
  const me = useMe().data
  const enter = me ? '/' : '/login'
  const enterLabel = me ? 'Open the workspace' : 'Sign in'
  return (
    <div data-tone="dark" className="dark flex min-h-dvh flex-col bg-brand-ink text-brand-bone">
      <ShellHeader tone="dark">
        <div className="mx-auto flex h-18 w-full max-w-[88rem] items-center gap-6 px-6 md:px-10">
          <Link to="/home" aria-label="ClaimShield home" className="shrink-0"><Wordmark /></Link>
          <nav aria-label="Sections" className="hidden flex-1 justify-center gap-2 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-[15px] text-fg-3 transition-colors hover:text-fg">{l.label}</a>
            ))}
          </nav>
          <div className="ml-auto md:ml-0">
            <Link to={enter} className={buttonVariants({ size: 'sm' })}><RollLabel>{enterLabel}</RollLabel></Link>
          </div>
        </div>
      </ShellHeader>

      <main className="flex flex-1 flex-col">
        {/* hero */}
        <Section
          tone="ink"
          className="flex min-h-[calc(100svh-4.5rem)] flex-col"
          inner="flex flex-1 flex-col justify-center pt-16 pb-12"
          backdrop={
            <>
              <DitherField palette={DITHER_GREEN} sources={[{ x: 0.86, y: 0.52, strength: 1.15 }]} floor={0.22} />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(12_14_13/0.35),rgb(12_14_13/0.8))] md:bg-[linear-gradient(90deg,#0c0e0d_18%,rgb(12_14_13/0.55)_52%,transparent_80%)]" />
            </>
          }
          after={<Ticker items={SAMPLE} label="Sample indicators · synthetic" />}
        >
          <Eyebrow pill dot="live" className="self-start">Fraud, waste and abuse intelligence<span className="hidden sm:inline"> · human in the loop</span></Eyebrow>
          <RevealText as="h1" className="display-hero mt-8 text-fg">
            Every alert.
            <br />
            The right <span className="serif-accent pr-[0.04em] text-hl">case.</span>
          </RevealText>
          <div className="mt-12 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <Reveal delay={0.5}>
              <p className="lede max-w-xl">
                Most alert tools answer <em>what looks odd?</em> ClaimShield answers <em>what is the evidence, how sure are we, and who
                should look</em> — and says so plainly when it does not know.
              </p>
            </Reveal>
            <Reveal delay={0.65} className="flex flex-wrap gap-3">
              <Link to={enter} className={buttonVariants({ size: 'xl' })}><RollLabel>{enterLabel} <ArrowRight /></RollLabel></Link>
              <a href="#decides" className={buttonVariants({ variant: 'outline', size: 'xl' })}><RollLabel>See how it decides</RollLabel></a>
            </Reveal>
          </div>
          <p className="eyebrow mt-12 text-fg-3">↳ Synthetic data only. Indicators need human review; they are not findings.</p>
        </Section>

        {/* 01 the problem */}
        <Section tone="bone" inner="grid items-center gap-16 py-28 md:py-40 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <Eyebrow index="01">The problem</Eyebrow>
            <ScrollWords className="mt-8 font-display text-[clamp(2rem,3.6vw,3.4rem)] leading-[1.02] font-bold tracking-[-0.035em] text-fg">
              Payers drown in thousands of unexplained alerts. One signal rarely proves anything; the proof sits in how claims, providers, members,
              facilities, referrals and ownership connect. Investigators have hours, not weeks.
            </ScrollWords>
            <p className="mt-10 text-[clamp(1.5rem,2.3vw,2.1rem)] leading-tight tracking-[-0.02em] text-fg">
              <span className="serif-accent text-hl">ClaimShield connects the evidence,</span> and ranks the few cases worth a person’s time.
            </p>
          </div>
          <Panel tone="ink" className="relative aspect-square w-full max-w-[34rem] justify-self-center">
            <DitherField palette={DITHER_GREEN} sources={[]} orbs={[{ x: 0.5, y: 0.52, r: 0.3 }]} cell={5} glow={90} />
            <LogoGlobe />
            {[
              ['Duplicate lines', 'top-[14%] left-[8%]'],
              ['Peer outlier', 'top-[24%] right-[6%]'],
              ['Shared owner', 'bottom-[20%] left-[6%]'],
              ['After a death date', 'right-[10%] bottom-[10%]'],
            ].map(([label, place]) => (
              <span key={label} className={cn('absolute rounded-full bg-brand-bone px-3 py-1.5 font-mono text-[11px] text-brand-ink shadow-lg', place)}>{label}</span>
            ))}
            <p className="eyebrow absolute inset-x-0 bottom-5 text-center text-fg-3">One case, many independent signals</p>
          </Panel>
        </Section>

        {/* 02 how it decides */}
        <Section id="decides" tone="volt" inner="py-28 md:py-40">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Eyebrow index="02">How it decides</Eyebrow>
              <Headline size="1" lead="Every case shows" accent="its receipt." className="mt-6" onScroll />
            </div>
            <div className="flex items-end gap-5">
              <p className="figure text-[clamp(6rem,13vw,11rem)] leading-[0.78] text-brand-ink">{TOTAL.toFixed(2)}</p>
              <p className="max-w-44 pb-3 text-[15px] font-medium text-brand-ink">risk on an example case, written out. Confidence is a separate number.</p>
            </div>
          </div>
          <div className="mt-16 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
            <Panel tone="outline" className="flex flex-col gap-7 p-7 md:p-9">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="display-4 text-fg">Example case</p>
                  <p className="mt-1 text-sm text-fg-3">Synthetic · risk drivers, written out</p>
                </div>
                <Tag className="bg-volt text-brand-ink">High confidence</Tag>
              </div>
              <p className="rounded-2xl bg-sunken px-4 py-3 font-mono text-[13px] text-fg-2">“Services dated after a recorded date of death, on exact fields.”</p>
              <ScoreReceipt rows={RECEIPT} total={TOTAL} caption="risk, not confidence" />
              <ul className="flex flex-col gap-2.5">
                <Why>A recorded fact plus a peer signal: two independent channels agree</Why>
                <Why>Exposure split into exact and estimated dollars, never added</Why>
              </ul>
            </Panel>
            <div className="flex flex-col gap-5">
              <Panel tone="outline" className="flex flex-col gap-5 p-6 md:p-7">
                <Tag>Evidence · confidence</Tag>
                <p className="figure text-[3.5rem] text-fg">0.77</p>
                <StackBar rows={[{ key: 'a', label: 'Claim lines', share: 0.4 }, { key: 'b', label: 'Peers', share: 0.3 }, { key: 'c', label: 'History', share: 0.2 }, { key: 'd', label: 'Network', share: 0.1 }]} />
              </Panel>
              <Panel tone="ink" className="flex flex-col gap-3 p-6 md:p-7">
                <Tag>Why not block automatically?</Tag>
                <p className="text-lg leading-snug text-fg">
                  Emergency, dialysis and chemotherapy lines are protected.{' '}
                  <span className="serif-accent text-[1.35em] text-hl">Review after the fact, never delay care.</span>
                </p>
              </Panel>
            </div>
          </div>
        </Section>

        {/* 03 the lab */}
        <Section id="lab" tone="bone" inner="py-28 md:py-40">
          <Eyebrow index="03">The Lab</Eyebrow>
          <Headline size="1" lead="Different signals." accent="One honest answer." className="mt-6" onScroll />
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <p className="lede max-w-2xl">Rules, peer statistics, a provider’s own history, relationship graphs and a 30, 60 and 90 day outlook, each measured against synthetic ground truth the detectors never see.</p>
            <Link to={enter} className={buttonVariants({ size: 'lg' })}><RollLabel>Open the Lab <ArrowRight /></RollLabel></Link>
          </div>
          <Reveal onScroll className="mt-14">
            <KpiBand
              tone="forest"
              items={[
                { label: 'detectors across the claim, peer, history and network channels', value: 13 },
                { label: 'evidence channels that must corroborate each other', value: 4 },
                { label: 'horizons for the risk outlook: 30, 60 and 90 days', value: 3 },
                { label: 'people needed to approve a high-impact action', value: 2 },
              ]}
            />
          </Reveal>
        </Section>

        {/* 04 the loop */}
        <Section id="loop" tone="ink" inner="grid items-center gap-14 py-28 md:py-40 lg:grid-cols-2">
          <div>
            <Eyebrow index="04">Human in the loop</Eyebrow>
            <Headline size="2" lead="Every state labelled." accent="Never a silent verdict." className="mt-6" onScroll />
            <p className="lede mt-8 max-w-xl">The AI explains; people decide. Every answer is checked against the evidence pack before you see it, and the full path is hash-chained in the audit trail.</p>
            <div className="mt-10 flex max-w-xl flex-wrap gap-2.5">
              {['NEW', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'CLOSED'].map((s) => <StatusBadge key={s} status={s} />)}
            </div>
          </div>
          <Panel tone="ink" className="flex flex-col gap-7 p-7 md:p-9">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="display-4 text-fg">A case, end to end</p>
                <p className="mt-2 text-sm text-fg-3">Synthetic example</p>
              </div>
              <StatusBadge status="PENDING_APPROVAL" size="lg" />
            </div>
            <ol className="relative flex flex-col gap-6 border-l border-line pl-6">
              {TIMELINE.map((step) => (
                <li key={step.title} className="relative">
                  <span aria-hidden className={cn('absolute top-1.5 left-[calc(-1.8125rem-0.5px)] size-2.5 rounded-full ring-4 ring-brand-ink-2', step.done ? 'bg-volt' : 'bg-fg-3/50')} />
                  <p className="flex items-baseline gap-3"><span className="font-mono text-xs text-fg-3">{step.at}</span><span className={cn('font-semibold', step.done ? 'text-fg' : 'text-fg-3')}>{step.title}</span></p>
                  <p className="mt-1 text-[15px] text-fg-2">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-line">
              <p className="eyebrow text-fg-3">Know when it does not know</p>
              <p className="mt-2 text-[15px] leading-relaxed text-fg">“Insufficient evidence - human review required.” A confident wrong answer is worse than an explicit gap.</p>
            </div>
          </Panel>
        </Section>

        {/* 05 insight */}
        <Section id="insight" tone="mint" inner="grid gap-14 py-28 md:py-40 lg:grid-cols-[1fr_1.25fr] lg:items-center">
          <div>
            <Eyebrow index="05" className="text-brand-ink/65">Confidence is not risk</Eyebrow>
            <p className="display-2 mt-6 text-brand-ink">Three routes</p>
            <p className="figure mt-4 text-[clamp(7rem,15vw,13rem)] leading-[0.8] text-brand-ink">3</p>
            <p className="mt-6 max-w-sm text-lg text-brand-ink/80">High confidence goes to an audited, non-blocking path. Medium goes to an expert with what is known and unknown. Low says it needs more evidence.</p>
            <Link to={enter} className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}><RollLabel>{enterLabel} <ArrowRight /></RollLabel></Link>
          </div>
          <Reveal onScroll className="grid gap-4 sm:grid-cols-2">
            <KpiTile icon={<ShieldCheck />} label="Decisions made by AI" value={0} badge={<Tag>always a person</Tag>} />
            <KpiTile icon={<Users />} label="Approvers for a high-impact action" value={2} badge={<Tag>two-person rule</Tag>} />
            <KpiTile icon={<Gauge />} label="Confidence routes" value={3} unit="routes" badge={<Tag>high · medium · low</Tag>} className="sm:col-span-2" />
          </Reveal>
        </Section>

        {/* 06 principles */}
        <Section id="principles" tone="bone" inner="py-28 md:py-36">
          <Eyebrow index="06">Principles</Eyebrow>
          <Headline size="2" lead="Evidence first," accent="then the AI." className="mt-6" onScroll />
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              ['Grounded', 'Every AI sentence cites evidence ids from a sealed pack; numbers come from the backend.'],
              ['Validated', 'Ids, numbers, entities, wording and confidence are checked. A failed answer is replaced, and labelled.'],
              ['Governed', 'Lessons enter the knowledge base only after a different person approves them. Rules never change by themselves.'],
              ['Honest', 'Accuracy is measured on synthetic ground truth and labelled that way; derived links are never shown as confirmed.'],
            ].map(([t, d]) => (
              <Panel key={t} tone="white" className="flex flex-col justify-between gap-8 p-7">
                <p className="display-4 text-fg">{t}</p>
                <p className="text-[15px] leading-relaxed text-fg-2">{d}</p>
              </Panel>
            ))}
          </div>
        </Section>

        {/* CTA */}
        <Section
          tone="forest"
          inner="flex flex-col items-center py-36 text-center md:py-52"
          backdrop={
            <>
              <DitherField palette={DITHER_FOREST} sources={[{ x: 0.5, y: 1.08, strength: 1.2 }]} floor={0.35} glow={140} />
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(0deg,#00583f_30%,transparent)]" />
            </>
          }
          after={
            <footer className="mx-auto flex max-w-[88rem] flex-col gap-6 px-6 pt-4 pb-10 md:flex-row md:items-end md:justify-between md:px-10">
              <div className="flex flex-col gap-3">
                <Wordmark />
                <p className="max-w-sm text-sm text-fg-3">Every alert. The right case. All data in this system is synthetic.</p>
              </div>
              <nav className="flex gap-6 text-sm text-fg-2"><Link to={enter}>{enterLabel}</Link><a href="#decides">How it decides</a><a href="#principles">Principles</a></nav>
            </footer>
          }
        >
          <Headline size="1" lead="Ready to review?" accent="Start with the evidence." onScroll />
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <Link to={enter} className={buttonVariants({ size: 'xl' })}><RollLabel>{enterLabel} <ArrowRight /></RollLabel></Link>
          </div>
        </Section>
      </main>
    </div>
  )
}
