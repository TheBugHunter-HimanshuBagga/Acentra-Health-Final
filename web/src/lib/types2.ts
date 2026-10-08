import type { Tier } from '@/lib/types'

export type LangCode = 'en' | 'hi' | 'bn' | 'ta' | 'te' | 'gu' | 'kn' | 'ml' | 'mr' | 'pa' | 'od'

export const LANGUAGES: { code: LangCode; native: string; english: string }[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'od', native: 'ଓଡ଼ିଆ', english: 'Odia' },
]

export interface OutlookFactor {
  feature?: string
  label?: string
  text?: string
  direction?: string
  value?: number
}

export interface OutlookHorizon {
  probability: number
  provider: string
  factors: OutlookFactor[]
}

/** A model estimate trained on synthetic labels. It is never evidence and never changes the tier. */
export interface Outlook {
  available: boolean
  reason?: string
  caveat?: string
  beatsPersistence?: boolean
  liftOverBestPersistence?: number
  horizons?: Record<'30' | '60' | '90', OutlookHorizon>
}

export interface FunnelStage {
  key: string
  label: string
  count: number
}

export interface Funnel {
  runId: string
  capacityHours: number
  stages: FunnelStage[]
  tiers: Record<string, number>
  dollars: { exact: number; estimated: number }
  coverage?: { pct: number; dollarsInCapacityCases: number; positiveDollars: number; basis: string }
  diff: Record<string, unknown>
  diffFrom: string | null
  suppressedByException: Record<string, number>
}

export interface CompoundingNow {
  activeExceptions: number
  alertsSuppressed: number
  casesTotal: number
  casesWithPrecedent: number
  livePrecedents: number
  seedPrecedents: number
  tierChangedByPrecedent: { caseId: string; with: string; without: string }[]
}

export interface Dashboard {
  runId: string
  kpis: { alerts: number; cases: number; high: number; medium: number; monitor: number; exactDollars: number; estimatedDollars: number }
  needsYouNow: { caseId: string; dollars: number; hypotheses: string[]; primary: string; tier: Tier }[]
  exposureByScheme: { scheme: string; label: string; cases: number; dollars: number }[]
  compounding: CompoundingNow
}

export interface RunSummary {
  runId: string
  createdAt: string
  exceptionSet: string[]
  precedentCount: number
  stages: FunnelStage[]
  tiers: Record<string, number>
  diffFrom: string | null
  diff: Record<string, unknown>
  suppressedByException: Record<string, number>
}

export interface Compounding {
  current: CompoundingNow
  runs: RunSummary[]
  activeLivePrecedents: number
  pendingCosign: number
  approvedExceptions: number
}

export interface EvalReport {
  basis: string
  coverage: { pct: number; dollarsInCapacityCases: number; positiveDollars: number }
  notes: string[]
  decoys: { falselyFlagged: number; lines: number }
  decoyProviders: { type: string; scheme: string; bestTier: string; reachedHigh: boolean; providers: string[] }[]
  network: { casesPerRing: number; ringRecovered: boolean; ringProviders: string[] }
  rules: { rule: string; channel: string; flagged: number; positives: number; recall: number; precisionLowerBound: number }[]
  temporal: { detected: number; schemeProviders: number; medianDelayMonths: number; falseAlarmsPer1000ProviderMonths: number }
  prediction: {
    available: boolean
    model: string
    notes: string[]
    split: Record<string, string>
    features: string[]
    horizons: Record<string, { chosen: string; test: Record<string, unknown>; positives: Record<string, unknown>; rows: Record<string, unknown>; importance: { feature: string; importance: number }[] }>
  }
}

export interface GraphNode {
  id: string
  label: string
  type: string
  role?: string
  specialty?: string | null
  x?: number
  y?: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  label: string
  nClaims: number
}

export interface CaseGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface CaseTimeline {
  primary: string
  events: { date: string; entity: string; label: string; type: string }[]
  months: { month: string; flaggedDollars: number; flaggedLines: number; lines: number; paid: number }[]
  signals: Record<string, unknown>[]
  trend: { label: string; slope: number }
}

export interface Precedent {
  precedentId: string
  source: 'SEED' | 'LIVE'
  caseId: string | null
  schemeType: string
  specialtyCode: string | null
  disposition: string
  reasonCode: string | null
  rationale: string | null
  aiDrafted: boolean
  status: 'ACTIVE' | 'PENDING_COSIGN' | 'RETIRED'
  createdBy: string
  closedDt: string | null
}

export interface SimulationReport {
  alertsSuppressed: number
  providersAffected: number
  casesAffected: number
  affectedCases: string[]
  dollarsNoLongerReviewed: number
  tierShifts: Record<string, number>
  conflictsWithConfirmed: string[]
  breadthShare: number
  hardFactTouches: number
}

export interface ExceptionRule {
  excId: string
  version: number
  status: 'DRAFT' | 'SIMULATED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETIRED'
  scope: { rule_ids: string[]; specialty_code: string | null }
  condition: { field: string; op: string; value: number | string }[]
  effect: 'DOWNGRADE_TO_MONITOR' | 'SUPPRESS_ALERT'
  supportN: number
  flags: unknown[]
  sourcePrecedentId: string | null
  simulation: SimulationReport | null
  lintVerdict: string | null
  explanation: unknown
  proposedBy: string
  approvedBy: string | null
  approvedAt: string | null
  approvalNotes: string | null
  reviewDue: string | null
  createdAt: string
  suppressedInLastRun?: number
  reused?: boolean
}

export interface ChatBlock {
  text: string
  textEn: string
  sourceIds: string[]
  translated: boolean
}

export interface ChatReply {
  sessionId: string
  intent: string
  mode: 'FACTS_ONLY' | 'LLM' | 'REFUSAL'
  label: string
  insufficientKnowledge: boolean
  blocks: ChatBlock[]
  links: { type: string; id: string; label?: string }[]
  notices: string[]
  audio?: { mimeType: string; base64: string }
  transcript?: string
  needsConfirmation?: boolean
}

export interface Health {
  status: string
  run: string | null
  engine: 'UP' | 'DOWN'
  llm: 'LIVE' | 'TEMPLATE' | 'DEGRADED'
  voice: 'ON' | 'OFF' | 'DEGRADED'
}
