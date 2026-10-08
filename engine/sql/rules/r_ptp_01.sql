-- R-PTP-01 paired codes billed on the same date. Flags the Column 2 line.
-- Violation if the edit never allows the pair (modifier_ind = 0), or allows it only with a modifier
-- (modifier_ind = 1) and neither line carries one of the bypass modifiers ($bypass).
WITH pairs AS (
  SELECT b.claim_id, b.line_no, cb.member_id, b.rendering_provider_id AS provider_id, b.service_dt,
         b.hcpcs, b.paid_amt, a.hcpcs AS col1, p.modifier_ind
  FROM claim_line a
  JOIN claim ca ON ca.claim_id = a.claim_id
  JOIN claim_line b ON b.rendering_provider_id = a.rendering_provider_id
                   AND b.service_dt = a.service_dt
                   AND NOT (b.claim_id = a.claim_id AND b.line_no = a.line_no)
  JOIN claim cb ON cb.claim_id = b.claim_id AND cb.member_id = ca.member_id
  JOIN ref_ncci_ptp p ON p.col1_hcpcs = a.hcpcs AND p.col2_hcpcs = b.hcpcs
                     AND a.service_dt >= p.eff_dt AND (p.del_dt IS NULL OR a.service_dt < p.del_dt)
  WHERE p.modifier_ind = 0
     OR (p.modifier_ind = 1
         AND NOT list_contains($bypass, COALESCE(a.modifier1, ''))
         AND NOT list_contains($bypass, COALESCE(a.modifier2, ''))
         AND NOT list_contains($bypass, COALESCE(b.modifier1, ''))
         AND NOT list_contains($bypass, COALESCE(b.modifier2, '')))
)
SELECT 'R-PTP-01' AS rule_id, claim_id, line_no, ANY_VALUE(member_id) AS member_id,
       ANY_VALUE(provider_id) AS provider_id, ANY_VALUE(service_dt) AS service_dt, ANY_VALUE(hcpcs) AS hcpcs,
       ANY_VALUE(paid_amt) AS paid_amt, ANY_VALUE(paid_amt) AS dollars,
       'billed with ' || MIN(col1) AS detail,
       'ADDED_COL2' AS flag_role
FROM pairs
GROUP BY claim_id, line_no
