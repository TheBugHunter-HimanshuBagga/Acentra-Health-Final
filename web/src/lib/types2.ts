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
  distributions?: {
    confidence: Record<'HIGH' | 'MEDIUM' | 'LOW', number>
    evidenceStrength: { bucket: string; cases: number }[]
    channelsAgreeing: { channels: number; cases: number }[]
    risk: { bucket: string; cases: number }[]
  }
  networks?: { caseId: string; providers: number; rules: string[]; dollars: number }[]
  trends?: Record<string, number>
  outlook?: { available: boolean; label: string; mean: Record<string, number | null>; top: { caseId: string; p90: number }[] }
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
  decoyProviders: { type: string; scheme: string; bestTier: string | null; reachedHigh: boolean; providers: string[] }[]
  network: { casesPerRing: number; ringRecovered: boolean; ringProviders: string[] }
  rules: { rule: string; channel: string; flagged: number; positives: number; truePositives?: number; recall: number | null; precisionLowerBound: number | null }[]
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
  handoffOffered?: boolean
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

// ------------------------------------------------------------------------------ insight: impact, confidence, reasoning
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

export interface Observation {
  channel: string
  threshold: string
  strength: number
  observed: Record<string, unknown> | null
  peerBaseline: Record<string, unknown> | null
  history: Record<string, unknown> | null
  network: Record<string, unknown> | null
  sourceFields: string[]
}

export interface ImpactItem {
  id: string
  key: string
  label: string
  value: number
  display: string
  basis: 'EXACT' | 'ESTIMATED' | 'DERIVED'
  why: string
  evidenceIds: string[]
  sourceFields: string[]
}

export interface ImpactBlock {
  items: ImpactItem[]
  severity: { value: number; pattern: string | null; why: string }
  exposureBasis: 'EXACT' | 'ESTIMATED' | 'MIXED'
  memberImpactScore: number
}

export interface ConfidenceBlock {
  level: ConfidenceLevel
  statement: string
  insufficientEvidence: boolean
  insufficientText: string | null
  route: { code: string; text: string; requiresHuman: boolean; automationEligible: boolean }
  risk: {
    score: number
    severity: number
    note: string
    drivers: { channel: string; contribution: number; strength: number; text: string }[]
    outlook: { available: boolean; p90: number | null; label: string }
  }
  evidence: {
    strength: number
    count: number
    channelsAgreeing: string[]
    supporting: { id: string; channel: string; strength: number; text: string }[]
    contradicting: { id: string; text: string; source: string; refs: string[] }[]
    missing: string[]
    evidenceIds: string[]
  }
  precedent: { fit: number; matches: number; strong: number; partial: number; conflicting: number; supporting: number; ids: string[]; live: number }
}

export interface ReasoningStep {
  id: string
  step: 'RETRIEVE' | 'INTERPRET' | 'APPLY_RULES' | 'PROPOSE' | 'SCORE' | 'CITE' | 'HUMAN_REVIEW'
  title: string
  summary: string
  details: string[]
  refs: string[]
}

export interface Explanation {
  flagged: boolean
  headline: string
  confidenceLine: string
  trigger?: { id: string; statement: string } | null
  strongestEvidence?: { id: string; statement: string; hardFact: boolean } | null
  supportingEvidence?: { id: string; statement: string }[]
  riskContribution?: { channel: string; share: number; strength: number }[]
  whyUnusual?: string[]
  peerComparison?: { id: string; observed: Record<string, unknown>; peer: Record<string, unknown>; threshold: string }[]
  historicalBehaviour?: { id: string; history: Record<string, unknown>; observed: Record<string, unknown> }[]
  networkContext?: { id: string; statement: string }[]
  contradictory?: { id: string; text: string; source: string }[]
  missingEvidence: string[]
  recommendedHumanAction: { action: string; text: string }
  impactLine?: string
  whatWasSeen?: string[]
  whatWouldChangeThis?: string[]
  reasons?: string[]
  viaException?: string | null
}

export interface AiSentence {
  text: string
  citations: string[]
}

export interface ReasoningOutput {
  available?: boolean
  mode: 'LLM' | 'TEMPLATE'
  badge: 'VALIDATED' | 'TEMPLATE_FALLBACK'
  model: string | null
  createdAt: string
  validation: { passed: boolean; retries: number; fallbackReason: string | null }
  content: {
    source: string
    confidenceStatement?: string
    sections?: Record<string, AiSentence[]>
    precedents?: {
      id: string
      precedentId: string
      strength: 'STRONG' | 'PARTIAL' | 'CONFLICTING'
      similarity: number
      disposition: string
      reasonCode: string | null
      mostSimilarOn: string[]
      whyRelevant: string
      relevanceNarrative?: string
      differencesNarrative?: string
    }[]
    summary?: string
    overallNarrative?: string
    influencedBy?: number
  }
}

export interface MemoryPrecedent {
  precedentId: string
  similarity: number
  disposition: string
  reasonCode: string | null
  strength: 'STRONG' | 'PARTIAL' | 'CONFLICTING'
  source: string
  cosignedBy: string | null
  rationale: string | null
  mostSimilarOn: string[]
  whyShown: string
}

export interface KnowledgeItem {
  itemId: string
  caseId: string
  kind: string
  title: string
  text: string
  source: 'AI' | 'DETERMINISTIC'
  model: string | null
  schemeType: string | null
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RETIRED'
  createdBy: string
  reviewedBy: string | null
  reviewNotes: string | null
  whyShown?: string
}

export interface Memory {
  caseId: string
  precedents: MemoryPrecedent[]
  approvedKnowledge: KnowledgeItem[]
  influencedBy: number
  influencedByReviewerPrecedents: number
  summary: string
  knowledgeConfidence: 'NONE' | 'PARTIAL' | 'STRONG'
}

export interface HandoffMessage {
  seq: number
  role: 'USER' | 'AGENT' | 'SYSTEM'
  sender: string
  text: string
  at: string
}

export interface Handoff {
  handoffId: string
  status: 'WAITING' | 'ACTIVE' | 'CLOSED'
  requestedBy: string
  agent: string | null
  reason: string
  caseId: string | null
  createdAt: string
}

export interface CaseSummaryBlocks {
  confidence?: {
    level: ConfidenceLevel
    route: string
    automationEligible: boolean
    evidenceStrength: number
    evidenceCount: number
    channelsAgreeing: number
    contradictions: number
    missing: number
  }
  impact?: {
    members: number
    claims: number
    lines: number
    exposureExact: number
    exposureEstimated: number
    providers: number
    regions: number
    services: number
    severity: number
  }
}

export interface Growth {
  approvedKnowledge: number
  pendingKnowledge: number
  feedback: number
  livePrecedents: number
  byDay: { day: string; n: number }[]
  recentDecisions: { case_id: string; action: string; actor: string; status: string; created_at: string }[]
}

/** Challenge, network analysis and copilot outputs: the same validated-or-fallback shape as the reasoning output. */
export interface GroundedOutput {
  available?: boolean
  mode: 'LLM' | 'TEMPLATE'
  badge: 'VALIDATED' | 'TEMPLATE_FALLBACK'
  model: string | null
  createdAt?: string
  validation: { passed: boolean; retries: number; fallbackReason: string | null }
  content: {
    source: string
    sections?: Record<string, AiSentence[]>
    answerable?: boolean
    notInPack?: string
    metrics?: { label: string; value: number; detail?: string; source: string }[]
  }
}

export interface CopilotAnswer extends GroundedOutput {
  question: string
}
