-- R-DUP-01 exact duplicate line. Keeps the earliest identical line as context and flags the rest.
-- Identity: member, rendering provider, date of service, code, both modifiers, units.
WITH ranked AS (
  SELECT cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id,
         cl.service_dt, cl.hcpcs, cl.paid_amt,
         ROW_NUMBER() OVER (
           PARTITION BY c.member_id, cl.rendering_provider_id, cl.service_dt, cl.hcpcs,
                        COALESCE(cl.modifier1, ''), COALESCE(cl.modifier2, ''), cl.units
           ORDER BY c.from_dt, cl.claim_id, cl.line_no) AS rn
  FROM claim_line cl JOIN claim c ON c.claim_id = cl.claim_id
)
SELECT 'R-DUP-01' AS rule_id, claim_id, line_no, member_id, provider_id, service_dt, hcpcs, paid_amt,
       paid_amt AS dollars,
       'identical to an earlier line' AS detail,
       'DUPLICATE_COPY' AS flag_role
FROM ranked
WHERE rn > 1
