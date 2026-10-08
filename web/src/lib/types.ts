export type Role = 'INVESTIGATOR' | 'SUPERVISOR' | 'GOVERNANCE' | 'AUDITOR'
export type Tier = 'HIGH' | 'MEDIUM'
export type ActionName = 'REQUEST_RECORDS' | 'PROVIDER_EDUCATION' | 'PREPAY_REVIEW_FLAG' | 'MONITOR' | 'REFER_EXTERNAL'

export interface Me {
  id: string
  username: string
  displayName: string
  role: Role
  language: string
  onboarded: boolean
  onboardingSkipped: boolean
}

export interface Subject {
  id: string
  role: 'PRIMARY' | 'NETWORK' | 'RELATED'
  label: string
  specialty: string
}

export interface QueueItem {
  caseId: string
  rank: number
  tier: Tier
  status: string
  subjects: Subject[]
  hypotheses: string[]
  factors: { risk: number; dollarScore: number; memberImpact: number; severity: number; evidenceStrength: number }
  utility: number
  dollars: { exact: number; estimated: number; basis: string }
  trend: string | null
  estHours: number
  inCapacity: boolean
  deferReason: string | null
  assignedTo: string | null
}

export interface QueueResponse {
  runId: string
  horizon: number
  capacityHours: number
  usedHours: number
  items: QueueItem[]
}

export interface PermittedAction {
  action: ActionName
  needs: 'NONE' | 'SUPERVISOR'
}

export interface CaseDetail {
  caseId: string
  tier: Tier
  tierReasons: { id: string; text: string }[]
  subjects: Subject[]
  hypotheses: { code: string; text: string; dollars: number }[]
  factors: QueueItem['factors']
  dollars: QueueItem['dollars']
  trend: string | null
  estHours: number
  memberCount: number
  ruleIds: string[]
  hardFactAlerts: boolean
  defaultAction: ActionName
  permittedActions: PermittedAction[]
  packSha256: string
  status: string
  assignedTo: string | null
  outcome: string | null
  outlook: import('@/lib/types2').Outlook
  channels?: Record<string, number>
  alertCount?: number
  firstServiceDt?: string
  lastServiceDt?: string
  briefAvailable: boolean
}

export interface EvidenceItem {
  id: string
  detector: string
  channel: string
  name: string
  statement: string
  dollars: number
  lineCount: number
  hardFact: boolean
  dollarsBasis?: 'EXACT' | 'ESTIMATED'
  policyRefs: string[]
}

export interface EvidencePack {
  caseId: string
  evidence: EvidenceItem[]
  limitations: { id: string; mandatory: boolean; text: string }[]
  policies: { id: string; title: string; text: string }[]
  hypotheses: string[]
  defaultAction: ActionName
  permittedActions: PermittedAction[]
}

export interface ClaimLine {
  evidenceId: string
  claimId: string
  lineNo: number
  memberId: string
  providerId: string
  serviceDt: string
  hcpcs: string
  label: string
  units: number
  paid: number
  flagRole: string
}

export interface ClaimsPage {
  total: number
  page: number
  size: number
  items: ClaimLine[]
}

export interface ReviewRecord {
  actionId: string
  actor: string
  role: Role
  action: 'ACCEPT' | 'MODIFY' | 'REJECT' | 'REQUEST_INFO'
  status: 'RECORDED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED'
  reasonCode: string | null
  notes: string | null
  requiresApproval: boolean
  humanDecision: { action: string | null; hypothesis: string | null }
  approver: string | null
  createdAt: string
}

export interface ReviewResponse {
  actionId: string
  caseId: string
  caseStatus: string
  effectiveAction: string | null
  status: string
  requiresApproval: boolean
  approvalNeeded: string | null
}

export interface AuditEvent {
  seq: number
  ts: string
  actor: string
  role: string
  eventType: string
  entityType: string | null
  entityId: string | null
  payload?: Record<string, unknown>
  prevHash?: string
  hash: string
}

export const REASON_CODES = [
  'LEGIT_CLINICAL_PATTERN',
  'LEGIT_SHARED_BUILDING',
  'LEGIT_RURAL_ACCESS',
  'LEGIT_HIGH_ACUITY',
  'DOC_SUPPORTS_BILLING',
  'DATA_ERROR',
  'CONFIRMED_PATTERN',
  'NEEDS_RECORDS',
] as const

export const OUTCOMES = ['CONFIRMED', 'UNFOUNDED', 'EDUCATION', 'INSUFFICIENT'] as const

export interface BriefLine {
  text: string
  cites: string[]
}

export interface BriefSection {
  key: string
  title: string
  items: BriefLine[]
}

export interface BriefCheck {
  id: string
  name: string
  severity: 'BLOCK' | 'WARN'
  status: 'PASS' | 'FAIL' | 'WARN'
  details: string[]
}

/** GET/POST /api/cases/{id}/brief. `sections` is the validated, human-readable rendering. */
export interface Brief {
  briefId: string
  caseId: string
  mode: 'LLM' | 'TEMPLATE'
  badge: 'VALIDATED' | 'TEMPLATE_FALLBACK'
  generatedAt: string
  packSha256: string
  model: string | null
  sections: {
    headline: BriefLine
    hypothesis: string
    recommendedAction: string
    insufficientEvidence: boolean
    sections: BriefSection[]
    markdown: string
  }
  validation: {
    passed: boolean
    retries: number
    fallbackReason: string | null
    checks: BriefCheck[]
  }
}
