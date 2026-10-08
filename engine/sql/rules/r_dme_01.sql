-- R-DME-01 equipment order without a qualifying visit: no CARRIER claim for the same member billed by the
-- ordering provider in the $days days up to the order date. Orders with no ordering provider are not evaluated
-- (a limitation, not an alert).
SELECT 'R-DME-01' AS rule_id, cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id,
       cl.service_dt, cl.hcpcs, cl.paid_amt, cl.paid_amt AS dollars,
       'no visit by ' || c.referring_provider_id || ' in the prior ' || CAST($days AS VARCHAR) || ' days' AS detail,
       'NO_QUALIFYING_VISIT' AS flag_role
FROM claim c
JOIN claim_line cl ON cl.claim_id = c.claim_id
WHERE c.claim_type = 'DME'
  AND c.referring_provider_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM claim v
    WHERE v.claim_type = 'CARRIER'
      AND v.member_id = c.member_id
      AND v.billing_provider_id = c.referring_provider_id
      AND v.from_dt BETWEEN c.from_dt - CAST($days AS INTEGER) AND c.from_dt
  )
