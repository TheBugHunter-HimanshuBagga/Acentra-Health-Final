-- R-MUE-01 units above the published limit.
--   MAI 1     : line edit, units on the line > limit.
--   MAI 2 / 3 : date-of-service edit, units summed over member + rendering provider + code + date > limit.
-- Dollars are pro-rata: the share of the line's payment attributable to units above the limit.
WITH base AS (
  SELECT cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id, cl.service_dt,
         cl.hcpcs, cl.units, cl.paid_amt,
         CASE WHEN c.claim_type = 'DME' THEN 'DME' ELSE 'PRACTITIONER' END AS service_type
  FROM claim_line cl JOIN claim c ON c.claim_id = cl.claim_id
),
joined AS (
  SELECT b.*, m.mue_value, m.mai,
         SUM(b.units) OVER (PARTITION BY b.member_id, b.provider_id, b.hcpcs, b.service_dt) AS day_units
  FROM base b JOIN ref_mue m ON m.hcpcs = b.hcpcs AND m.service_type = b.service_type
)
SELECT 'R-MUE-01' AS rule_id, claim_id, line_no, member_id, provider_id, service_dt, hcpcs, paid_amt,
       ROUND(paid_amt * (units - mue_value) / units, 2) AS dollars,
       'units ' || units || ' vs limit ' || mue_value AS detail,
       'EXCESS_UNITS' AS flag_role
FROM joined
WHERE mai = 1 AND units > mue_value
UNION ALL
SELECT 'R-MUE-01', claim_id, line_no, member_id, provider_id, service_dt, hcpcs, paid_amt,
       ROUND(paid_amt * (day_units - mue_value) / day_units, 2),
       'units that day ' || day_units || ' vs limit ' || mue_value,
       'EXCESS_UNITS'
FROM joined
WHERE mai IN (2, 3) AND day_units > mue_value
