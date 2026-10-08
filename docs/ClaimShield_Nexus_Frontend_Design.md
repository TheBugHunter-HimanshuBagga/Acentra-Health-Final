# ClaimShield Nexus: Frontend & Experience Design

*Concept: **the Investigation Room.** Evidence first, intelligence visible, AI as an analyst whose every claim can be traced. Uses the stack from `..._Final_Architecture.md`; data and behaviours from the engine and Second Brain documents.*

---

## 0. Library decisions, with what was verified

| Choice | Verified | Decision |
|---|---|---|
| **Recharts 3.x** | Declares React 19 in `peerDependencies`; README says install `react-is` matching your React version ([README](https://cdn.jsdelivr.net/npm/recharts@3.9.2/README.md)). shadcn's chart component sits on Recharts and needs a height/aspect on `ChartContainer`, and uses `var(--chart-n)` (not `hsl(var(--chart-n))`) on v3 ([shadcn chart](https://ui.shadcn.com/docs/components/chart)) | Use Recharts 3 + `react-is@19`. Bespoke visuals (funnel, confidence, timeline lanes) are custom SVG |
| **Cytoscape.js 3.34.x** (MIT, no dependencies, `preset` layout keeps supplied positions, compound nodes supported) ([js.cytoscape.org](https://js.cytoscape.org/)) | `react-cytoscapejs` peer-dependency status for React 19 **could not be confirmed** | **Use Cytoscape directly** in a small `useEffect` wrapper (about 60 lines), no React wrapper. Positions come from the server (preset layout). Fallback if anything breaks: a plain SVG renderer, which is viable because a case subgraph is ≤ ~60 nodes and positions are precomputed |
| **Lenis** | README's verified GSAP sync pattern: `lenis.on('scroll', ScrollTrigger.update)`, `gsap.ticker.add(t => lenis.raf(t*1000))`, `gsap.ticker.lagSmoothing(0)`; `autoRaf` defaults to `false` in core; `data-lenis-prevent` attributes; `respectReducedMotion` is **on by default** ([README](https://github.com/darkroomengineering/lenis)) | Use the **core `Lenis` class** in a tiny provider, not `lenis/react` (its prop API was not confirmed) |
| **GSAP** | Free including all plugins; `@gsap/react` `useGSAP` | Import only `gsap`, `ScrollTrigger`, `Flip`; use `gsap.matchMedia()` for reduced motion |
| **Contrast** | Computed (WCAG formula) for every colour pair in §2.1 | Figures below are calculated, not estimated |
| Fonts | Package names for Indic font subsets **not confirmed** | Self-host (offline demo); load the Indic subset lazily on language selection |

**Day-1 check:** `npm install recharts react-is cytoscape gsap @gsap/react lenis`, build, and render one chart, one graph and one Lenis-scrolled page. Verify Cytoscape style `transition-*` properties work; if not, toggle classes without transitions.

---

## 1. Design concept

**Not an admin dashboard.** Three rules separate this from one:

1. **One hero object: the case.** Everything is organised around an investigation with an evidence wall, not around tables and cards of KPIs.
2. **Provenance is visible everywhere.** Every sentence, number and score can be traced by hovering a citation chip, which lights up the evidence row, the graph nodes, the timeline markers and the claim lines at once (*linked brushing*).
3. **The AI is an analyst, not a conversationalist.** It appears as a validated "Analyst Brief" with a derivation strip. The chat is a secondary drawer, never the main surface.

**Mood:** a calm, dark "operations room" for investigation work (dark-first), with a paper-light theme for reading and printing the brief. Restrained colour; strong typography; large tabular numerals; motion that explains.

**Tone of voice in UI copy:** "indicators", "warrants review", "insufficient evidence", never "fraud".

---

## 2. Design system

### 2.1 Colour tokens (CSS variables; Tailwind v4 `@theme`; shadcn tokens mapped)

**Dark ("Room", default)**
| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--canvas` | `#0A0F1A` | app background | text-1 16.4:1 |
| `--surface` | `#101827` | cards, panels | text-1 15.2:1 |
| `--raised` | `#172236` | popovers, hovered rows | text-1 13.7:1 |
| `--border` | `#2A3957` | decorative dividers | 1.5:1 (decorative only) |
| `--border-strong` | `#667896` | **form-control and essential component edges** | 3.97:1 on surface, 3.56:1 on raised (≥ 3:1) |
| `--text-1` | `#E8EEF8` | primary text | ≥ 13.7:1 on all surfaces |
| `--text-2` | `#A9B6CC` | secondary text | ≥ 7.8:1 |
| `--text-3` | `#8493AD` | captions, hints | ≥ 5.1:1 |
| `--accent` (button fill) | `#3B5BDB` with white text | primary actions | **5.67:1** (note: `#4C6FFF` fails at 4.18:1 and is **not** used for text-bearing fills) |
| `--accent-text` | `#9DB2FF` | links, active nav | ≥ 7.8:1 |

**Tier colours (always paired with a glyph and a word)**
| Tier | Colour | Glyph | Contrast on surface |
|---|---|---|---|
| HIGH | `#FF7A59` | ▲ filled | 6.9:1 |
| MEDIUM | `#F2B541` | ◆ half-filled | 9.7:1 |
| LOW / Monitor | `#8FA3C0` | ○ outline | 6.9:1 |

**Evidence-channel colours (colour-blind-aware hues + distinct glyphs)**
| Channel | Colour | Glyph | Contrast on surface |
|---|---|---|---|
| LINE (line facts) | `#56B4E9` | ■ | 7.7:1 |
| PEER (vs peers) | `#C4A4FF` | ● | 8.6:1 |
| SELF (vs own history) | `#3FD0A0` | ▲ | 9.1:1 |
| NETWORK | `#F08AC0` | ◆ | 7.7:1 |

Dark text on tier-filled chips: 7.5–10.5:1.

**Light ("Paper")**: `--canvas #F5F7FA`, `--surface #FFFFFF`, `--text-1 #0F1A2B` (17.5:1), `--text-2 #44546C` (7.7:1), `--text-3 #5B6B84` (5.4:1), `--border-strong #7A889F` (3.59:1), `--accent #2F4BC4` (7.2:1 with white text). Tier text: HIGH `#B83A12` (5.8:1), MEDIUM `#8A5A00` (5.9:1), LOW `#4E5F7A` (6.5:1). Channel text: LINE `#0B6FA8`, PEER `#6B3FC4`, SELF `#0B7A57` (5.3:1), NETWORK `#B3307E`, all ≥ 5.0:1 on white/canvas.

**Semantic extras:** success `#3FD0A0`/`#0B7A57`, info = accent, "estimated" = dashed outline + `≈` prefix, "exact" = solid. **Colour is never the only carrier of meaning.**

### 2.2 Typography
| Role | Face | Notes |
|---|---|---|
| UI and numerals | **Inter** (variable, self-hosted) | `font-variant-numeric: tabular-nums` for every number; `font-feature-settings: "cv11","ss01"` optional |
| IDs, hashes, code | **JetBrains Mono** | 12–13 px |
| Indian scripts | **Noto Sans** per script (Devanagari for hi/mr, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Gurmukhi, Odia) | Loaded **lazily** after language selection; fallback stack declared per `:lang()` |

**Scale (desktop):** Hero numeral 56/56 (700, tabular) · H1 28/34 (650) · H2 20/28 (600) · H3 16/24 (600) · Body-dense 14/22 · **Brief body 16/26** · Caption 12/16 · Mono 12/18. **Indic scripts:** +1 px size, +0.15 line-height, no letter-spacing, no uppercase transforms. UI strings are allowed to expand ~40% (no fixed-width labels).

### 2.3 Spacing, shape, elevation
- **4 px base:** 4, 8, 12, 16, 24, 32, 48, 64. Dashboard and queue use 24 gutters; the workspace uses a **dense mode** (8/12 internal padding).
- **Grid:** 12 columns, max content 1600 px; workspace is full-bleed.
- **Radius:** 6 (controls), 10 (cards), 16 (dialogs and sheets).
- **Elevation:** dark mode uses 1 px borders plus a faint top inner highlight (no heavy shadows); light mode uses soft 2-level shadows. Overlays use a 60% canvas scrim.
- **Focus:** 2 px `--accent-text` ring with 2 px offset on every interactive element (≥ 3:1 against both themes).

### 2.4 Iconography
**lucide-react** (shadcn default) for UI chrome, 1.5 px stroke, 16/20 px. A **custom glyph set** (inline SVG, 24 px grid) for: tier badges, the four channel glyphs, node types (provider ●, member ·, facility ■, address ⬥, owner ⬡, claim ▴), and the ClaimShield mark (shield with a three-node constellation). Icons always have text labels or `aria-label`s.

### 2.5 Data-visualisation rules
Direct labels over legends; ≤ 5 hues per chart; tier and channel colours reserved for tier and channel meaning only; dashed/hatched = estimated; every chart has a "View as table" toggle (visually hidden table by default for screen readers); tooltips are keyboard reachable; axis text ≥ 12 px; Recharts containers always have an explicit height.

---

## 3. Motion principles and the GSAP / Lenis rules

**Principles:** (1) *Explain, don't decorate:* motion shows causality (a funnel narrowing, a link lighting up, a rule changing the count). (2) *Fast by default:* 120 ms micro, 220 ms standard, 420 ms emphasis, 800–1200 ms only for the three cinematic moments below. (3) *Transform and opacity only.* (4) *Never animate data refreshes;* highlight diffs instead. (5) *Play once:* intros do not replay on revisit within a session. (6) *Reduced motion is a first-class path.*

| Token | Value |
|---|---|
| `--dur-micro / base / emph / cine` | 120 / 220 / 420 / 900 ms |
| Ease | `power3.out` (enter), `power2.inOut` (move), `power1.in` (exit) |
| Stagger | 0.04 s (lists), 0.08 s (cards) |

**The three cinematic moments (the only long animations):** (a) the **funnel collapse** on the dashboard, (b) the **funnel diff** after a rule change, (c) the **case entry** transition from queue into the Investigation Room. Everything else is ≤ 420 ms.

**GSAP usage rules:** `useGSAP` with scoped refs for cleanup; `gsap.matchMedia()` with a `(prefers-reduced-motion: reduce)` branch that sets durations to 0 and replaces timelines with instant state changes; `Flip` for reordering (queue, horizon change); `ScrollTrigger` only on the dashboard lower sections and the report view; GSAP never drives chart data, only the presentation of it.

**Lenis scope (verified pattern):** one `Lenis` instance created only on **`/login`, `/onboarding`, the dashboard page scroll, and `/cases/:id/report`**, with `lenis.on('scroll', ScrollTrigger.update)`, the GSAP ticker driving `lenis.raf`, and `lagSmoothing(0)`. **Destroyed on route change into the workspace.** The workspace, queue, governance and audit screens have several internal scroll panes, so they use **native scroll**. Elements that must scroll natively inside Lenis pages (tables, drawers, popovers) carry `data-lenis-prevent`. Lenis respects `prefers-reduced-motion` by default; do not override it.

---

## 4. App shell and global patterns

```
┌ Top bar ─────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ ClaimShield  [Run RUN-012 · as of 30 Sep ▾]  [Horizon 30|60|90]  [⌘K Search]   ⓘ Synthetic data │
│                                             [Role: Investigator ▾] [Language: हिन्दी ▾] [Ask ⌘/] │
├─ Left rail ─┬──────────────────────────────────────────────────────────────────────────────────┤
│ ◧ Command   │                                                                                  │
│ ☰ Queue     │                       Route content                                              │
│ ◉ Room(case)│                                                                                  │
│ ✦ Knowledge │                                                                                  │
│ ⚖ Governance│                                                                                  │
│ ⛓ Audit     │                                                                                  │
│ ✓ Trust(eval)│                                                                                 │
└─────────────┴──────────────────────────────────────────────────────────────────────────────────┘
```
- **Global horizon control (30/60/90)** lives in the top bar and drives risk everywhere (queue ranking, case header, dashboard).
- **Run selector** shows `run_id` and as-of date; after an exception approval it shows "RUN-013 (re-run complete)" with a diff chip.
- **Persistent "Synthetic data" chip** opens a provenance popover (CMS synthetic base + our overlay).
- **Command palette (⌘K, shadcn Command):** jump to case, provider, policy, precedent; run "Open queue", "Switch language". Premium feel for almost no cost.
- **Role switcher** (demo only) swaps Investigator ↔ Supervisor ↔ Governance ↔ Auditor so approvals can be shown with one browser.
- **Keyboard map:** `g q` queue, `g d` dashboard, `j/k` rows, `Enter` open, `a/m/r` accept/modify/reject, `?` shortcuts, `⌘/` Ask.
- **Page transitions:** 180 ms cross-fade + 8 px upward settle (GSAP), no sliding between peers.

---

## 5. Screens

For every screen: **Layout · Components · Interactions · Hierarchy · Animation (GSAP) · Lenis · Charts · Transitions · Micro-interactions.**

### 5.1 First-time language selection (`/onboarding/language`, first login only)
- **Layout:** full-screen, centred column on a slow, subtle gradient field (CSS only). Wordmark top-left. Headline "Choose your language" rendered live in the selected language. 11 large tiles in a 4-3-4 grid (mobile: 2 columns) showing the language in its **own script** with a small romanised label: English, हिन्दी, বাংলা, தமிழ், తెలుగు, ગુજરાતી, ಕನ್ನಡ, മലയാളം, मराठी, ਪੰਜਾਬੀ, ଓଡ଼ିଆ. Footer: mic glyph "Voice available in all of these", primary **Continue**, quiet text "Change later in the top bar".
- **Components:** shadcn `RadioGroup` styled as tiles (true radio semantics), `Button`.
- **Interactions:** default preselected from the browser language; selecting a tile instantly switches UI strings and loads that script's font subset; `Enter` confirms; arrow keys move; persists to the user profile and `localStorage`.
- **Hierarchy:** headline → tiles → Continue.
- **Animation (GSAP):** wordmark draws (stroke-dashoffset) 900 ms; tiles stagger in (0.04 s, 8 px rise); on select the tile border animates and the headline cross-fades into the new language. Skipped on revisit.
- **Lenis:** on (page is short, so effectively invisible; kept for consistency with `/login`).
- **Charts:** none. **Transitions:** exit fades into the onboarding dialog over the blurred dashboard. **Micro:** tile press scale 0.98; check icon draws.
- **States:** font-load delay → system script fallback so nothing is blank; if saving fails, continue locally and retry silently.

### 5.2 Skippable onboarding (modal over the real dashboard)
- **Layout:** shadcn `Dialog`, 720×460 desktop (full-screen sheet on mobile). Left 55% a looping micro-visual; right 45% copy. Footer: progress dots, **Skip** (always visible), Back/Next. `Esc` also skips. "Don't show again" checkbox.
- **Four steps:**
  1. *From thousands of alerts to cases you can trust:* a mini funnel.
  2. *Every claim is cited:* an **interactive** citation chip that lights up a tiny evidence row (the player learns the core interaction).
  3. *You decide, the AI advises:* a three-step approval ladder.
  4. *Speak your language:* a mic glyph and a language-switch demo.
- **Interactions:** arrow keys, focus trap, focus returns to the dashboard on close; replayable from **Help → Replay tour**.
- **Animation:** each visual is a short GSAP timeline that loops with a 1.2 s pause; paused when the tab is hidden; replaced by a static frame under reduced motion.
- **Lenis:** off (modal). **Micro:** dot expands to a pill on the active step. **Charts:** none.

### 5.3 Executive intelligence dashboard ("Command View", `/`)
```
┌ Greeting strip: "Good morning — RUN-012, as of 30 Sep" ──────────────────── [Data provenance ⓘ] ┐
│  ┌────────────────────────── THE FUNNEL (hero) ──────────────────────────────────────────┐   │
│  │ 4,812 alerts ━━━━━━━━━━━━━━━━━━━━━━━━▶ 1,930 active ━━━━━━▶ 74 cases ━━▶ 37 in capacity │   │
│  │                                           HIGH ▲ 12 · MEDIUM ◆ 31 · Monitor ○ 31        │   │
│  │ Exposure: $1.2M exact · ≈$0.7M estimated      Covers 91% of injected $ (synthetic)      │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│  [Needs you now: top 5 cases]      [Exposure by scheme (bars)]     [Risk outlook: 30/60/90]     │
│  [Alerts vs cases, 36 months (area)]     [Second Brain: precedents · exceptions · alerts avoided]│
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
(Numbers illustrative; all come from the run.)
- **Components:** custom SVG **funnel** (bespoke, not Recharts) with tier segmentation at the last stage; KPI strip; "Needs you now" cards (rank, tier glyph, subject, scheme chips, five-factor mini-bars); Recharts **BarChart** (exposure by official category, exact solid / estimated hatched), Recharts **AreaChart** (alerts vs cases over time), **risk-concentration** line (share of expected positives captured vs share of providers reviewed), compounding strip.
- **Interactions:** click a funnel stage → queue filtered to that stage; hover shows the definition ("Active = after exceptions"); horizon control re-computes the risk outlook tile; "View as table" on each chart.
- **Hierarchy:** the funnel dominates (≈ 40% of first-screen height); everything else supports it.
- **Animation (GSAP):** **Cinematic moment (a), the funnel collapse:** on first load of the session, the top bar widens to the alert count (counters tween with `tabular-nums`), then each stage narrows in sequence with the label "Exceptions → Consolidation → Scoring → Capacity" fading past; ~1.4 s total, then static. KPI tiles stagger (0.08 s). Lower sections reveal with `ScrollTrigger` (opacity + 12 px) once.
- **Lenis:** **on** for this page; tables inside carry `data-lenis-prevent`.
- **Transitions:** clicking a case card flips into the Room (§5.5).
- **Micro:** stage hover widens the stage by 4 px; delta chips (▲/▼) after a re-run.
- **States:** skeleton funnel (grey bars the same shape) while loading; if the run is missing, an empty state "No run yet. Run the pipeline" with the command; partial failure shows the funnel with a warning on the failed tile only.

### 5.4 SIU case queue (`/queue`)
```
┌ Capacity: [Investigators ─3─ +] [Hours/each ─40─] [Weeks ─2─] = 240 h   Used 212 h ▓▓▓▓▓▓▓▓▓░ ┐
│ Filters: [Tier ▾] [Scheme ▾] [Specialty ▾] [Status ▾]   Horizon: 30|60|90   Sort: Priority ▾   │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 ▲ HIGH  P-0488 DME supplier + 2 prescribers   [DME][RNG]   $48,211 exact  ▮▮▮▮▮ factors  18 h │
│ 2 ▲ HIGH  P-0201 Primary care                    [UPC]       ≈$31,900       ▮▮▮▯▯             12 h │
│ …                                                                                               │
│ ── capacity line · 240 h used ───────────────────────────────────────────────────────────────── │
│ 38 ◆ MED  …  (deferred: exceeds remaining capacity)                                             │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Components:** TanStack Table; each row is a "case strip": rank, tier glyph+word, subject/hypothesis chips, **five-factor signature** (risk, dollars, member impact, severity, evidence strength as five tiny bars), dollars with ≈/exact marker, estimated hours, a trend arrow (ESCALATING/STABLE/DECLINING). A **capacity bar** with steppers sits on top, and a **capacity line** divides in-capacity from deferred cases.
- **Interactions:** hover/focus opens a **peek panel** (right) with the brief headline and "why ranked here" (weight × value); `j/k` navigation; `Enter` opens the case; changing capacity or horizon re-ranks.
- **Hierarchy:** rank and tier first, then subject, then the signature, then hours.
- **Animation (GSAP):** **`Flip`** animates row reordering on horizon or capacity change (220–420 ms); the capacity line slides to its new position; the top "used hours" bar tweens.
- **Lenis:** off (native scroll in a dense table).
- **Charts:** the five-factor signature glyph (SVG); capacity bar.
- **Transitions:** row → Room via Flip (§5.5). **Micro:** stepper press feedback; row-hover rail indicator; disabled rows show why (deferred reason).
- **States:** empty ("No cases at this capacity and filter. Clear filters" / "No cases yet"); error ("Queue unavailable. Retry"; keeps the last good queue with a stale chip).

### 5.5 Case Investigation Workspace: **the hero screen** (`/cases/:id`, "the Room")
**Message to communicate: "AI-assisted investigation intelligence".** How the layout achieves it:
- **Evidence and confidence lead; narrative follows.** The first thing you see is the case strip and the evidence wall, not a text box.
- **No chat bubbles on this surface.** The analyst brief is a structured memo with citations. Chat is a drawer (§5.16).
- **A derivation strip** shows the chain *Retrieve → Interpret → Rules → Propose → Score → Cite → Review → Learn* with each step's owner (engine / analyst-AI / human) so the AI's role is visible and bounded.
- **Linked brushing:** everything is connected to everything.

```
┌ CASE STRIP ───────────────────────────────────────────────────────────────────────────────────────┐
│ CASE-0417  P-0488 DME supplier (+2 prescribers)  [DME] [RNG]  ▲ HIGH   ESCALATING ↗  Status: IN REVIEW │
│ $48,211 exact · ≈$61,000 est.    63 members    Risk outlook 30 ▮▮▯ 60 ▮▮▮ 90 ▮▮▮▮  [selected: 90]    │
│ Derivation:  ●Retrieve ●Interpret ●Rules ◐Propose ●Score ●Cite  ○Review  ○Learn   (engine│AI│human)  │
├─ EVIDENCE & SIGNALS (26%) ─┬─ INVESTIGATION CANVAS (46%) ───────────────────┬─ DECISION RAIL (28%) ──┤
│ CHANNELS                   │ [Brief] [Network] [Timeline] [Claims]  ◀ tabs   │ CONFIDENCE             │
│ ■ LINE     ▮▮▮▮▮ 0.80     │ ┌ ANALYST BRIEF · validated ✓ ────────────────┐ │ ▲ HIGH · why?          │
│ ● PEER     ▮▮▮▮▯ 0.62     │ │ Headline [E1][E2]                           │ │ ✓ 4 channels ✓ hard fact│
│ ▲ SELF     ▮▮▮▯▯ 0.48     │ │ Summary sentences with chips [E1][E3]       │ │ ✓ no conflicting prec.  │
│ ◆ NETWORK  ▮▮▮▮▯ 0.71     │ │ Timeline notes … Network notes …            │ │ ─────────────────────── │
│ ───────────────────────── │ │ Precedent notes … Limitations …             │ │ AI PROPOSES             │
│ E1 ■ R-DME-01 63 orders…   │ └─────────────────────────────────────────────┘ │ Request records         │
│ E2 ◆ Referral concentr…    │ ┌ EVIDENCE WALL (mini network + timeline) ─────┐ │ (rule default: same)    │
│ E3 ● Member distance…      │ │  [network minimap]   [timeline strip]        │ │ ─────────────────────── │
│ E4 ▲ Rapid ramp…           │ └─────────────────────────────────────────────┘ │ YOUR DECISION           │
│ E5 ★ Precedent PRC-0057    │                                                 │ Accept│Modify│Reject│Info│
│ [filter] [sort by $]       │                                                 │ Precedents · Limitations│
└────────────────────────────┴─────────────────────────────────────────────────┴─────────────────────────┘
                                                                           [Ask the case ⌘/] (secondary)
```
- **Components:** case strip; **channel meters** (four rows, glyph + bar + value); evidence list (IDs `E1…`, channel glyph, one-line templated statement, dollars); tabbed canvas with the *Brief* tab showing the brief plus an "evidence wall" containing a network minimap and a timeline strip; confidence panel (§5.10); review panel (§5.11); precedents and limitations accordions; the derivation strip.
- **The signature interaction: linked brushing.** Hover or focus any citation chip, evidence row, graph node/edge, timeline marker or claim row → all related items highlight, the rest dim to 35%. A single Zustand store holds `highlight = {evidenceIds, nodeIds, edgeIds, claimKeys, timeRange}`. Click pins the highlight; `Esc` clears it.
- **Hierarchy:** (1) tier and dollars, (2) channel meters and evidence, (3) brief, (4) decision tools.
- **Animation (GSAP):**
  - **Cinematic moment (c), case entry (≈ 900 ms):** the queue row is the shared element. `Flip` expands it into the case strip; the three panels then reveal in order (evidence rail → canvas → decision rail), channel meters fill (0.4 s, 0.08 s stagger), the confidence segments light up, and the evidence wall's graph edges reveal in order of evidence strength.
  - After entry, interaction animation is limited to highlight transitions (≤ 120 ms).
  - The derivation strip's "Propose" step pulses once while the brief is being generated.
- **Lenis:** **off**; the three panes scroll natively.
- **Charts:** minimap and strip reuse §5.8 and §5.7 in compact form; channel meters are SVG bars.
- **Transitions:** tab changes are cross-fades with preserved scroll; opening the evidence explorer slides a drawer from the right.
- **Micro-interactions:** chips have a 1-frame press scale; evidence rows reveal a "why this matters" tooltip; the `$` figure shows exact vs estimated in a popover; the derivation steps are clickable (each opens a one-paragraph description of who did what).
- **Responsive:** ≥ 1440: three columns. 1024–1439: decision rail becomes a collapsible right drawer with a sticky "Decide" button. 768–1023: single column with tabs; the evidence rail turns into a horizontal scroller. < 768: stacked sections with a sticky bottom decision bar; the graph defaults to table view.
- **States:** loading shows the case strip skeleton, rail skeletons, and "Retrieving evidence" text; **brief states:** Generating (skeleton lines), Validated ✓, **Template (validation fallback)** (amber chip with a "why?" popover), Unavailable (retry plus template); error for a missing evidence pack: "Evidence pack unavailable. Actions are disabled" with retry; LOW cases show a calm "Insufficient evidence" layout (see §5.10).

### 5.6 Evidence explorer (drawer from the Room, also `/cases/:id/evidence`)
- **Layout:** left filters (channel, detector, scheme, date, "exact/estimated"); centre grouped table; right preview. Header shows counts ("63 lines · 5 evidence items").
- **Components:** grouped `Table` with expandable evidence items → implicated claim lines (claim ID, member, provider, date, code + our short label, units, paid, flag role); preview pane with `rule_id@version`, parameters, the **policy text** cited, "how this number was computed" (the formula and inputs), and the claim line's raw fields. A read-only "Show detection logic" accordion points to the rule's definition.
- **Interactions:** multi-select lines → "Highlight in timeline and network"; column chooser; export CSV of the selected lines; keyboard row navigation; paginated (lines are capped per case, so virtualisation is unnecessary).
- **Hierarchy:** evidence item → its lines → raw fields.
- **Animation:** drawer slide 220 ms; expand/collapse height tween; selected rows get an accent edge. **Lenis:** off. **Charts:** a tiny dollars-by-month sparkline per evidence item. **Micro:** copy-ID buttons confirm with a check.
- **States:** empty ("No lines match these filters"); error ("Couldn't load lines. Retry"); a note when lines are capped ("Showing top 200 of 1,204 by dollars").

### 5.7 Claim timeline (tab in the Room; compact strip on the wall)
- **Layout:** stacked small multiples sharing one x-domain: (1) paid dollars per week (Recharts `Bar`/`Area`), (2) flagged lines as markers by channel glyph (`Scatter`), (3) context lane: **inpatient stays as bands (`ReferenceArea`), death date and enrolment as lines (`ReferenceLine`)**, investigations and exceptions as pins, (4) alert dollars with the **escalation trend** label. A `Brush` at the bottom zooms all lanes together.
- **Interactions:** brush to zoom (filters the graph and the claim table too); hover a marker → tooltip and linked highlight; a marker inside an inpatient band is visually emphasised (phantom-service story); keyboard: arrow keys move between markers; "View as table".
- **Hierarchy:** the flagged markers and context events stand out; volume is quiet.
- **Animation (GSAP):** first open only: a clip-path reveal left → right (700 ms); cited markers then pop in sequence (0.03 s). **Lenis:** off. **Micro:** crosshair and a dollars readout.
- **States:** empty ("No dated lines in this window"); error with retry; loading shows lane skeletons.

### 5.8 Provider / member / facility network graph (tab in the Room; minimap on the wall)
- **Engine:** Cytoscape.js, preset layout with server-computed positions. No force layout at runtime, so no jitter and screenshots are repeatable.
- **Nodes:** provider ●, member · (small, capped), facility ■, address ⬥ (location), owner ⬡, flagged claim ▴. Colour follows the *role in the case* (primary subject highlighted), not the node type; shape carries the type.
- **Edges:** `refers_to` solid with arrow, width ∝ claim count; `owns` thick double-line; `located_at` dotted; `treated_at` thin; `uses_phone` dash-dot. Every edge has a label on hover and in the table view.
- **Layer lenses (segmented control):** Ownership · Referrals · Members · Locations · Claims. Each lens dims the other edge types.
- **Interactions:** click a node → neighbourhood focus (others 25%) and a side card with facts ("Owner O-031 controls 3 entities"); click an edge → the claims behind it open in the explorer; box-select; pan/zoom with on-screen buttons and keyboard (+/−/arrows); "Reset view"; legend toggle.
- **Accessibility:** the canvas has `role="img"` with a summary label, and a **"Table view" toggle is always one click away** (nodes and edges as sortable tables, with keyboard focus linking back to the canvas). The default view on small screens is the table.
- **Animation (GSAP + Cytoscape):** on first open, edges reveal in order of evidence strength: GSAP timeline toggles a `revealed` class at staggered times and Cytoscape style transitions interpolate opacity (**verify transitions work on day 1**, otherwise instant). Ring structures get a one-time soft pulse on the shared owner node.
- **Lenis:** off. **Charts:** none (the graph itself). **Micro:** hover thickens the edge; focus ring on nodes.
- **States:** large graph guard ("Showing 60 of 212 nodes, highest-dollar first. Show more"); empty ("No relationships found for this case"); error with retry and table fallback.

### 5.9 AI investigation brief ("Analyst Brief")
- **Layout:** a memo card: header row with **provenance chips** (Validated ✓ · model · generated time · pack hash short), headline, then sections (Summary, Timeline notes, Network notes, Precedents, Confidence statement, Recommended action with rationale, Investigator checklist, What would change my mind, Limitations). Print stylesheet and `/cases/:id/report` produce a clean PDF-ready page.
- **Components:** sentences are inline spans with superscript **citation chips** `[E1]`; numbers rendered from the engine carry a subtle dotted underline ("from data, E1.n") so they are visibly not model-typed; a language switch (English ↔ chosen language) per brief; "Show derivation" reveals who produced each part; a "Validated" popover lists the checks that ran.
- **Interactions:** hover a sentence → its evidence highlights across the Room; click a chip → evidence drawer; copy and export.
- **Hierarchy:** headline → confidence statement → recommended action → supporting sections → limitations (never hidden).
- **Animation (GSAP):** once per generated brief: sections reveal top → bottom with a 0.04 s stagger and 8 px rise; chips settle in 120 ms. **No typewriter effect**: the point is a document assembled from evidence, not a chatbot talking.
- **Lenis:** only on the report route.
- **Micro:** chip hover shows the evidence template as a tooltip; the fallback badge pulses once when shown.
- **States:** Generating (skeleton paragraphs + "Brief is validated before it is shown"); **Template fallback** with explanation; LOW tier uses the fixed "Insufficient evidence" layout; error → retry or template.

### 5.10 Confidence visualisation
- **Components:** (a) **tier badge** (glyph + word + fill); (b) **corroboration bar:** four segments (one per channel) lit by strength with glyphs and values, plus "n of 4 channels"; (c) **evidence-strength meter** (0–1, thin bar with tick marks at the tier thresholds); (d) **"Why this tier" checklist** (✓ / ✗ rows mirroring the deterministic rules: channels, hard fact, precedent fit, data adequacy); (e) **"What would raise confidence"** list for MEDIUM and LOW; (f) a small **decision-path diagram** showing the ordered tier rules with the first match highlighted.
- **Interactions:** hover a checklist row → highlights the evidence that satisfies it; the diagram nodes are focusable with text equivalents.
- **LOW/insufficient layout:** calm neutral palette, ○ glyph, the text "Insufficient evidence to open a case", and a prominent "What would raise confidence" panel. Framing: a knowledge gap is a feature, not an error.
- **Animation (GSAP):** segments fill sequentially (0.4 s, 0.08 s stagger) once on entry; the first-match rule in the diagram draws its highlight. **Lenis:** n/a. **Charts:** custom SVG; on the dashboard, a stacked tier-distribution bar.
- **Micro:** the badge never animates on refresh; a tier change after re-run shows a diff chip ("MEDIUM → LOW, via EXC-0002").

### 5.11 Human review panel (decision rail, bottom of the Room)
- **Layout:** card with: "AI proposes: Request records (rule default: Request records)" with a diff marker if they differ; four action buttons **Accept · Modify · Reject · Request info** as a segmented control; contextual fields; an **approval ladder** (Proposer → Supervisor → Action) with status for each rung.
- **Interactions:**
  - *Modify* opens a select limited to **permitted actions**; unavailable actions show a lock and the tooltip "Requires supervisor" or "Not permitted for this tier".
  - *Modify* and *Reject* require a **reason code** (searchable select) and notes.
  - High-impact actions open a confirmation dialog summarising the action ("simulated action; no payments are changed").
  - **Close case:** outcome (Confirmed / Unfounded / Education / Insufficient), reason code, rationale. An "Insert AI draft" button fills the field and tags it **"AI draft: edit required"**; submission is blocked until the text is edited.
  - The proposer cannot approve their own action; a clear message explains why.
- **Hierarchy:** the AI-vs-human distinction first, then the decision, then the ladder.
- **Animation:** ladder rungs fill with a 220 ms sweep when status changes; success state morphs the button into a check. **Lenis:** off.
- **Micro:** `a/m/r` shortcuts; disabled buttons explain themselves; a toast (sonner) confirms with an Undo for 8 s on reversible steps only.
- **States:** pending supervisor approval shows a waiting state; failure keeps the form data and shows an inline error.

### 5.12 Precedent / Second Brain interface
**A. In-case Precedent panel (decision rail):** top-k precedents as cards: similarity ring, disposition chip, reason code, one-line rationale, and a **feature-by-feature comparison** (paired dot plot: this case vs the precedent for each of the 12 features, not a radar chart). "Why similar" and "Why different" lines are computed, not generated. Empty state: "No similar precedent. If closed, this case becomes the first."

**B. Knowledge route (`/knowledge`)**
- **Layout:** left object browser (Policies · Rules · Glossary · Precedents · Exceptions) with counts and status chips; centre a **knowledge constellation** (Cytoscape): precedents, rules, policies and exceptions as typed nodes clustered by scheme, links = cites / derived-from / supersedes / conflicts; right detail panel with provenance, status timeline, and linked objects. A **Compounding panel** across the top: active precedents, active exceptions, alerts avoided in the latest run, share of cases with ≥ 1 precedent.
- **Interactions:** click a node → detail and neighbours; filter by status; "Conflicts" lens highlights `CONFLICTS_WITH` links; list view toggle (default on small screens and for screen readers).
- **Animation (GSAP):** **only on events:** when a precedent becomes active, its node appears with a single ripple and links draw to related objects; counters tick; it does not play on page load. **Lenis:** off.
- **Micro:** nodes grow slightly with support count (reinforcements). **States:** empty constellation message; error with list fallback.

### 5.13 Rule and exception governance (`/governance`)
- **Layout:** tabs: **Proposals · Active · Retired · Lint findings · Override rates**. Proposal detail: stepper (DRAFT → SIMULATED → PENDING → APPROVED/REJECTED); a **readable condition sentence** with chips ("When *specialty = Nephrology* and *visits per member per month ≤ 14* and *no hard-fact alert*, downgrade to Monitor"), with thresholds editable only within safe bounds (shadcn Slider); a **simulation report** (alerts suppressed, providers, dollars, tier shifts, conflicts, breadth) with a mini before/after funnel; **lint verdict** (PASS/WARN/BLOCK) with reasons; a validated **plain-language explanation** card; approve/reject buttons available only to the Governance role and disabled with reasons otherwise (proposer ≠ approver; BLOCK cannot be approved).
- **Interactions:** "Run simulation" updates the report; approving triggers the **re-run overlay** ("Re-running… applying EXC-0002") with progress, then the diff view.
- **Animation (GSAP):** **Cinematic moment (b), the funnel diff (≈ 1.2 s):** after the re-run, ghost bars show the previous run's stage widths; live bars animate to the new widths; a delta counter ("−312 alerts") counts up; affected cases flip in the queue toward Monitor. This is the Second Brain proof moment.
- **Charts:** override-rate horizontal bars per rule; simulation before/after bars. **Lenis:** off.
- **Micro:** stepper rung fills; lint badge has a text and glyph variant per verdict.
- **States:** empty ("No proposals. Exceptions appear here after a case is closed as unfounded"); error with retry; BLOCK state explained with the exact conflicting precedent linked.

### 5.14 Audit trail (`/audit`)
- **Layout:** left filters (case, actor, event type, date); centre a **vertical ledger** where each event is a block with a short hash chip and a link line to the previous block; right drawer for event detail. Top: **Verify chain** button and last-verified time.
- **Interactions:** **Verify chain** calls the verify endpoint and a quick sweep marks blocks ✓ in order (a one-shot GSAP stagger, ≈ 1 s for the visible window; the true result is shown as text); filters; open an event → payload (hashes, actors, `ai_proposal` vs `human_decision` diff); **Replay at time T**: a slider that updates a read-only panel (pack, brief with validation, decisions, exceptions in force) for the selected moment.
- **Hierarchy:** actor and event type first, then time, then hash.
- **Animation:** the verify sweep only; no ambient animation. **Lenis:** off. **Charts:** a small events-per-day strip. **Micro:** copy hash; hover shows the full hash.
- **States:** empty ("No events for these filters"); **verification failure** (red banner naming the first broken block); error with retry.

### 5.15 30/60/90 risk view
- **Global control:** the top-bar segmented control (30 | 60 | 90) with a plain definition tooltip ("likelihood of repeat or escalating activity within N days").
- **In the Room (case strip + a dedicated "Outlook" card in the decision rail):** three horizontal lanes (30/60/90) each showing the probability as a bar with a calibration tick, the **top-3 associated factors** with direction arrows and peer percentile ("referral concentration 99th pct ↑"), a **sparkline of the provider's risk over past snapshots**, and a fixed caveat: *"Trained on synthetic labels. Indicates prioritisation, not wrongdoing."* The factors are labelled "associated", never "causes".
- **On the dashboard:** the risk-concentration curve (cumulative expected positives vs share reviewed).
- **On Trust/Eval:** reliability (calibration) chart, PR curve, and the lift over the "recent alerts" baseline, including an honest note if lift is small.
- **Interactions:** switching horizon re-ranks the queue (Flip) and updates every risk figure; hover the calibration tick for the explanation.
- **Animation:** the selected lane's bar tweens (220 ms); the queue re-rank uses Flip. **Lenis:** off. **Charts:** Recharts `AreaChart` sparklines, `BarChart` lanes, `LineChart` for calibration.
- **States:** "Outlook unavailable for this provider (insufficient history)" with the reason; error with retry.

### 5.16 Multilingual chatbot ("Ask Nexus", right sheet)
- **Not a floating bubble.** It opens from the top bar **Ask** or `⌘/` as a 420 px sheet, scoped to the current page (context chip: "CASE-0417 · EN → हिन्दी · Investigator").
- **Layout:** header (context + language), conversation as **answer cards**, input row with mic.
- **Answer cards:** each sentence carries citation chips; a "Validated ✓" micro-badge; a per-answer toggle **Translated / English original**; a collapsed "Looked up: case summary, evidence E1–E3" line (tool activity); suggested links as small chips ("Open CASE-0417"). Out-of-scope replies use a neutral info card with a shield icon and the fixed, pre-translated message.
- **Suggested prompts** by context (3 chips): on a case, "Why is this ranked first?", "Which claims were duplicates?", "Have we seen this before?"; elsewhere, "How do confidence tiers work?".
- **Interactions:** `Enter` sends; `Shift+Enter` newline; language selector; citation chips behave exactly like in the brief (hover brushes the Room behind the sheet); links navigate and keep the sheet open.
- **Animation (GSAP):** sheet slides in 220 ms with focus moved to the input; a new answer card fades in (≤ 180 ms); sentences within one card do not stagger. **Lenis:** off; the sheet scroll area has `data-lenis-prevent`.
- **Micro:** send button becomes a stop control while waiting; character counter near the limit; "Role-scoped: you can only ask about what your role can see" tooltip.
- **States:** empty (greeting with the three prompts and a one-line scope statement); loading (skeleton card + "Looking up…"); **degraded** ("Validated facts only" list when Claude validation fails; "Voice off" when Sarvam is unavailable); error with retry.

### 5.17 Voice interaction (Sarvam; inside the chat sheet)
- **Components:** mic button with states:
  1. *Idle* → click (or hold Space) to talk; **toggle mode** is always available for accessibility.
  2. *Requesting permission.*
  3. *Recording:* a live **level meter** (Web Audio `AnalyserNode`, drawn with `requestAnimationFrame`) and a **28 s countdown ring** (SVG stroke).
  4. *Transcribing.*
  5. ***Transcript review:*** the transcript with detected language, editable, **auto-sends after ~1.5 s unless you edit or press Cancel** (guards against misheard IDs and numbers).
  6. *Answering* (the usual answer card).
  7. *Spoken summary:* a compact player with simple bars for the short Sarvam audio; the full answer stays as text.
- **Interactions:** language chip (from the UI language, changeable); "audio is not stored" note; stop/cancel anywhere; keyboard operable.
- **Failure states, each with a plain message and a next step:** microphone permission denied (browser instructions + type instead); recording too long (auto-stops at 28 s); STT unavailable ("Voice is unavailable. Type your question"); **low language confidence** (inline language picker); translation failed for a sentence (that sentence shows in English with a note); TTS failed (text only); offline (voice disabled, banner).
- **Animation:** the ring and meter are the only motion; GSAP handles state-to-state morphs of the mic button (≤ 180 ms). Reduced motion: static indicators, no meter animation, a numeric timer.
- **Lenis:** off.

### 5.18 Supporting screens
- **Login:** Lenis-on hero with the wordmark, a single sign-in card, role hints for the demo, and the synthetic-data notice.
- **Trust / Evaluation (`/trust`):** ablation table (rules → + peer → + self → + network → full), precision@k and dollar coverage, recall by difficulty (showing blind spots), calibration chart, decoys reaching HIGH (target 0), a "what these numbers do and don't prove" panel, and the audit-chain status. Judges who read it will see rigour.

---

## 6. Loading, empty and error states (global rules)

| Type | Rule |
|---|---|
| **Loading** | Skeletons **match the final layout** (same widths, row counts). Show a skeleton only after 150 ms to avoid flicker. Long operations name their stage ("Applying EXC-0002…", "Validating citations…"). A spinner is never the only indicator |
| **Empty** | One sentence on *why* it's empty, one on *what to do*, one primary action. Never a blank panel |
| **Error** | Plain language, what still works, and a retry. Keep the last good data with a "stale" chip where possible. Never show raw stack traces |
| **Degraded** | A slim banner names the degraded service and the fallback in use ("Template mode: Claude unavailable" / "Voice unavailable: typing still works") |
| **Permission** | Disabled controls explain who can do it ("Requires Supervisor") and offer the role switch in demo mode |
| **Validation fallback** | Template briefs and "validated facts only" answers carry a visible amber chip, never silent |

---

## 7. Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| ≥ 1440 | Full three-column Room; dashboard in a 12-column grid |
| 1024–1439 | Decision rail becomes a collapsible drawer with a sticky **Decide** button; rail tabs for evidence |
| 768–1023 | Single-column Room with tabs; left rail collapses to icons; queue rows reflow to two lines |
| < 768 | Stacked sections; bottom sticky decision bar; queue rows become cards; **graph defaults to table view**; chat becomes full-screen; language tiles two per row |

Touch targets ≥ 44 px; no hover-only affordances (every tooltip has a focus/tap equivalent); Lenis is not forced on touch.

---

## 8. Accessibility (target: WCAG 2.2 AA)

- **Contrast:** all text and control colours are computed in §2.1; essential control borders use `--border-strong` (≥ 3:1).
- **Colour independence:** tiers and channels always have glyph + text.
- **Keyboard:** everything reachable; visible focus; documented shortcuts; no keyboard traps (modals trap and return focus correctly).
- **Screen readers:** landmarks; `aria-live="polite"` for run completion, funnel diff and brief validation results; each chart has a table alternative; the graph has a table view; `lang` attributes set on translated text so Indic scripts are pronounced correctly; icon buttons have names.
- **Motion:** `prefers-reduced-motion` disables GSAP timelines (replaced by state changes) and Lenis smoothing; no autoplaying loops longer than 5 s without a pause control (onboarding visuals pause on focus and under reduced motion).
- **Time limits:** voice auto-send can be cancelled; no session timeouts mid-form without warning.
- **Text:** supports 200% zoom and 40% string expansion; no text in images.
- **Targets and forms:** labels tied to inputs; errors announced and linked with `aria-describedby`.

---

## 9. Performance and engineering notes

- **Code splitting:** route-level `React.lazy`; Cytoscape and Recharts load only on routes that use them; Indic font subsets load after language selection; self-hosted fonts with `font-display: swap`.
- **GSAP:** import only `gsap`, `ScrollTrigger`, `Flip`; animate transform/opacity; `will-change` only during an active tween.
- **Graph:** ≤ ~60 nodes per case, preset layout, no runtime layout; batch updates with `cy.batch()` when applying many highlight changes.
- **State:** TanStack Query for server data; Zustand for UI and the **linked-brushing store**; i18n via react-i18next with lazy namespaces.
- **Component inventory:** `TierBadge`, `ChannelMeter`, `CitationChip`, `EvidenceRow`, `FiveFactorSignature`, `FunnelViz`, `CapacityBar`, `ConfidencePanel`, `DerivationStrip`, `ReviewPanel`, `ApprovalLadder`, `NetworkCanvas` (Cytoscape wrapper), `TimelineLanes`, `BriefMemo`, `PrecedentCard`, `ConstellationCanvas`, `ConditionSentence`, `LedgerBlock`, `AskSheet`, `MicButton`.
- **Targets (not measured yet):** first meaningful paint under about 2.5 s on a laptop; route changes without layout shift; no animation longer than 420 ms outside the three cinematic moments.

---

## 10. The 6-minute demo: exactly what a judge sees

*Run from a freshly reset demo state. Dark theme, 1440×900, language preselected English for the first beat, Hindi used later.*

| Time | Screen | What the judge sees | What moves | Line to say |
|---|---|---|---|---|
| **0:00–0:25** | Language → onboarding | Eleven tiles in native scripts; tapping हिन्दी flips the headline instantly. Onboarding dialog opens over a blurred dashboard; the presenter taps **Skip** | Tile stagger; headline cross-fade; dialog fade | "First login asks your language. The tour is skippable." |
| **0:25–1:05** | Command View | The **funnel collapses** from thousands of alerts to a few dozen in-capacity cases; HIGH/MEDIUM/Monitor split; exact vs estimated dollars; compounding strip | Counters roll, bars narrow once (≈ 1.4 s) | "Thousands of unexplained alerts become cases investigators can act on." |
| **1:05–1:35** | Queue | Ranked case strips with five-factor signatures; the presenter drops capacity from 3 to 2 investigators: the capacity line moves and rows glide into new order; switch horizon 30 → 90 and rows reorder again | Flip reorder; capacity bar | "Six factors, investigator capacity, and a 30/60/90 horizon." |
| **1:35–3:00** | **Investigation Room** | Entering the top case: the strip expands, evidence meters fill, a confidence panel shows ▲ HIGH with checklist. The brief assembles with citations. The presenter **hovers a citation**: the evidence row, graph edges, timeline marker and claim lines light up together. The graph shows the shared owner and referral concentration; the timeline shows the service inside an inpatient stay band | Case-entry transition; meters; brushing highlights | "Every sentence is traceable. The AI explains; the engine decides." |
| **3:00–3:30** | A LOW item | A calm "Insufficient evidence" screen with "what would raise confidence" | none beyond a fade | "A confident wrong answer is riskier than an explicit knowledge gap." |
| **3:30–4:00** | Review panel | AI proposes *Request records*; the presenter chooses *Modify → Pre-pay flag*, which shows 🔒 "Requires supervisor"; switches role to Supervisor and approves; the ladder fills; audit toast | Ladder sweep; role switch | "Human decides. Two-person rule. The AI has no write access." |
| **4:00–5:10** | Governance (**climax**) | The presenter opens a recurring-treatment-center case, **rejects it as legitimate** and closes it; the precedent appears; a draft exception with a readable condition sentence and a lint PASS; simulation shows "N alerts suppressed, no confirmed precedent matched"; Governance approves; **re-run overlay**; the **funnel diff** animates (ghost bars → new bars, "−N alerts"); the case moves to Monitor; reopening a similar case shows it citing the precedent and exception | Funnel diff (≈ 1.2 s); constellation ripple if shown | "Every approved decision makes the next thousand decisions better." |
| **5:10–5:40** | Chat + voice | Open Ask; hold the mic and ask in Hindi "यह केस पहले क्यों है?" The transcript appears (auto-send), a cited answer card in Hindi with the English toggle, and a short spoken summary | Mic ring; answer fade | "Multilingual, voice-enabled, grounded and validated. Refuses to speculate." |
| **5:40–6:00** | Audit + Trust | Audit ledger: **Verify chain ✓**; Trust page: ablation table and the "what these numbers don't prove" panel | Verify sweep | "Fully auditable, measured against ground truth, honest about limits." |

**What the judge should remember visually:** the funnel collapse, the single hover that lights up evidence everywhere, the calm "insufficient evidence" screen, the locked high-impact action, and the funnel diff after an approved exception. Rehearse three times; keep a recorded fallback for voice and for the Claude call (cached briefs; template mode is a safe, visible fallback).

---

## 11. Build order and cut line (frontend)

1. Tokens, shell, i18n, auth/roles, `TierBadge`, `ChannelMeter`, `CitationChip`, linked-brushing store.
2. Queue → Room with brief + evidence rail + review panel (**the hero; do not cut**).
3. Dashboard funnel (custom SVG) and the case-entry transition.
4. Network (Cytoscape) with table view; timeline lanes.
5. Governance with simulation and the **funnel diff** (the climax; do not cut).
6. Language selection + onboarding.
7. Chat sheet, then voice.
8. Audit ledger with verify.
9. Knowledge constellation (**cut first** if short; fall back to the list view).
10. Polish: Lenis pages, reduced-motion pass, light theme, print/report view.

**If time runs short:** drop the knowledge constellation, the audit replay slider and the light theme; keep Lenis only on login/onboarding; keep every accessibility item that costs under an hour (focus rings, table views, glyphs, reduced motion).
