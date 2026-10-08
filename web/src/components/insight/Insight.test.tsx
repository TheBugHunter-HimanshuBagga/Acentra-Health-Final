import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import type { ConfidenceBlock, Explanation, ImpactBlock, ReasoningStep } from '@/lib/types2'
import { ImpactGrid, ReasoningChain, Triad } from './ConfidenceViews'
import { ExplanationCard } from './WhyFlagged'

const conf = (over: Partial<ConfidenceBlock> = {}): ConfidenceBlock => ({
  level: 'LOW', statement: 'Moderate.', insufficientEvidence: true, insufficientText: 'Insufficient evidence - human review required.',
  route: { code: 'ESCALATE_INSUFFICIENT', text: 'Escalate to a human reviewer.', requiresHuman: true, automationEligible: false },
  risk: { score: 0.71, severity: 0.4, note: 'Risk is not confidence.', drivers: [{ channel: 'RULE', contribution: 0.5, strength: 0.9, text: 't' }], outlook: { available: false, p90: null, label: '' } },
  evidence: { strength: 0.32, count: 2, channelsAgreeing: ['RULE'], supporting: [{ id: 'E1', channel: 'RULE', strength: 0.8, text: 's' }], contradicting: [{ id: 'CF1', text: 'A past case was unfounded.', source: 'PRECEDENT', refs: [] }], missing: ['No peer comparison'], evidenceIds: ['E1', 'E2'] },
  precedent: { fit: 0, matches: 0, strong: 0, partial: 0, conflicting: 0, supporting: 0, ids: [], live: 0 },
  ...over,
})

describe('Triad', () => {
  it('keeps risk and confidence apart and states the gap for LOW confidence', () => {
    renderWithProviders(<Triad c={conf()} />)
    expect(screen.getByText('0.71')).toBeInTheDocument()
    expect(screen.getByText('LOW')).toBeInTheDocument()
    expect(screen.getByText('Insufficient evidence - human review required.')).toBeInTheDocument()
    expect(screen.getByText('Missing evidence required')).toBeInTheDocument()
    expect(screen.getByText('No peer comparison')).toBeInTheDocument()
    expect(screen.getByText('A past case was unfounded.')).toBeInTheDocument()
  })
  it('shows what would raise confidence for MEDIUM', () => {
    renderWithProviders(<Triad c={conf({ level: 'MEDIUM', insufficientEvidence: false, insufficientText: null })} />)
    expect(screen.getByText('What would raise confidence')).toBeInTheDocument()
    expect(screen.getByText('Moderate.')).toBeInTheDocument()
  })
})

describe('ImpactGrid', () => {
  const impact: ImpactBlock = {
    items: [{ id: 'IM1', key: 'members', label: 'Members affected', value: 4, display: '4', basis: 'EXACT', why: 'Distinct members on flagged lines.', evidenceIds: ['E1'], sourceFields: ['claim.member_id'] }],
    severity: { value: 0.5, pattern: null, why: 'Typical.' }, exposureBasis: 'ESTIMATED', memberImpactScore: 0.2,
  }
  it('explains every figure and its basis', () => {
    renderWithProviders(<ImpactGrid impact={impact} />)
    expect(screen.getByText('Members affected')).toBeInTheDocument()
    expect(screen.getByText('exact')).toBeInTheDocument()
    expect(screen.getByText('Distinct members on flagged lines.')).toBeInTheDocument()
    expect(screen.getByText(/IM1 · E1/)).toBeInTheDocument()
  })
})

describe('ReasoningChain', () => {
  const steps: ReasoningStep[] = [
    { id: 'RS1', step: 'RETRIEVE', title: 'Retrieve', summary: 'Read 5 lines.', details: [], refs: ['E1'] },
    { id: 'RS7', step: 'HUMAN_REVIEW', title: 'Human review', summary: 'A person decides.', details: ['Two-person approval'], refs: [] },
  ]
  it('walks the steps and ends with human review', async () => {
    renderWithProviders(<ReasoningChain steps={steps} note="Nothing here is automated." />)
    expect(screen.getByText('Read 5 lines.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /HUMAN REVIEW/ }))
    expect(screen.getByText('A person decides.')).toBeInTheDocument()
    expect(screen.getByText('Two-person approval')).toBeInTheDocument()
  })
})

describe('ExplanationCard', () => {
  it('explains a case that was not flagged', () => {
    const x: Explanation = { flagged: false, headline: 'Not flagged: below peer threshold.', confidenceLine: 'Confidence LOW.', missingEvidence: ['Peer baseline'], recommendedHumanAction: { action: 'MONITOR', text: 'Keep monitoring.' }, whatWasSeen: ['z=1.2'] }
    renderWithProviders(<ExplanationCard x={x} />)
    expect(screen.getByText('Not flagged: below peer threshold.')).toBeInTheDocument()
    expect(screen.getByText('z=1.2')).toBeInTheDocument()
  })
})
