// A small case in the shape of the real API responses, for tests.
import type { CaseDetail, ClaimLine, EvidencePack } from '@/lib/types'
import type { CaseGraph } from '@/lib/types2'

export const graph: CaseGraph = {
  nodes: [
    { id: 'P-0044', label: 'P-0044', type: 'provider', role: 'PRIMARY', specialty: 'PRIMARY_CARE' },
    { id: 'P-0207', label: 'P-0207', type: 'provider', role: 'NETWORK' },
    { id: 'OWN-0044', label: 'OWN-0044', type: 'owner' },
    { id: 'M-1', label: 'M-1', type: 'member' },
    { id: 'M-2', label: 'M-2', type: 'member' },
    { id: 'M-3', label: 'M-3', type: 'member' },
  ],
  edges: [
    { id: 'owner:P-0044>OWN-0044', source: 'P-0044', target: 'OWN-0044', type: 'owner', label: 'controls 100%', nClaims: 0 },
    { id: 'owner:P-0207>OWN-0044', source: 'P-0207', target: 'OWN-0044', type: 'owner', label: 'controls 100%', nClaims: 0 },
    { id: 'billed:M-1>P-0044', source: 'M-1', target: 'P-0044', type: 'billed', label: '3 flagged claims', nClaims: 3 },
    { id: 'billed:M-2>P-0044', source: 'M-2', target: 'P-0044', type: 'billed', label: '2 flagged claims', nClaims: 2 },
    { id: 'billed:M-3>P-0207', source: 'M-3', target: 'P-0207', type: 'billed', label: '1 flagged claims', nClaims: 1 },
  ],
}

const line = (claimId: string, memberId: string, paid: number, evidenceId = 'E1'): ClaimLine => ({
  evidenceId, claimId, lineNo: 1, memberId, providerId: 'P-0044', serviceDt: '2025-03-01', hcpcs: '99213', label: 'Office visit', units: 1, paid, flagRole: 'POST_DEATH',
})
export const lines: ClaimLine[] = [line('C-0000000001', 'M-1', 120), line('C-0000000002', 'M-1', 80), line('C-0000000003', 'M-2', 60)]

export const pack = {
  caseId: 'CASE-0014', hypotheses: ['PHA'], defaultAction: 'REQUEST_RECORDS', permittedActions: [], policies: [], limitations: [],
  evidence: [
    { id: 'E1', detector: 'R-DOD-01@v1', channel: 'LINE', name: 'Service dated after recorded death', statement: '66 lines have service dates after the recorded date of death', dollars: 4857.6, lineCount: 66, hardFact: true, dollarsBasis: 'EXACT', policyRefs: [] },
    { id: 'E2', detector: 'S-GHOST@v1', channel: 'PEER', name: 'Members who see no other provider', statement: '70% of members saw no other provider', dollars: 0, lineCount: 0, hardFact: false, policyRefs: [] },
  ],
  confidence: {
    level: 'HIGH', statement: 'Confidence: HIGH - 2 independent channels agree.', insufficientEvidence: false, insufficientText: null,
    route: { code: 'HIGH_NONBLOCKING', text: 'High confidence: eligible for the non-blocking workflow. A person still decides.', requiresHuman: true, automationEligible: false },
    risk: { score: 0.94, severity: 0.95, note: '', drivers: [{ channel: 'LINE', contribution: 0.85, strength: 1, text: 'LINE channel strength 1.00' }, { channel: 'PEER', contribution: 0.6, strength: 1, text: 'PEER channel strength 1.00' }], outlook: { available: true, p90: 0.99, label: '' } },
    evidence: { strength: 0.77, count: 2, channelsAgreeing: ['LINE', 'PEER'], supporting: [], contradicting: [], missing: ['No relationship signal was found'], evidenceIds: ['E1', 'E2'] },
    precedent: { fit: 0, matches: 0, strong: 0, partial: 0, conflicting: 0, supporting: 0, ids: [], live: 0 },
  },
} as unknown as EvidencePack

export const detail = { caseId: 'CASE-0014', tier: 'HIGH', status: 'NEW', defaultAction: 'REQUEST_RECORDS', assignedTo: null, dollars: { exact: 4857.6, estimated: 10598.4 }, memberCount: 30 } as unknown as CaseDetail
