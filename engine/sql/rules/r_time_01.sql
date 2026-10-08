-- R-TIME-01 daily-minute overload. Typical minutes per code are OUR assumption (ref_hcpcs.typical_minutes), not CMS data.
-- A provider-day over $cap minutes flags every line of that day; dollars = paid x (excess / total minutes), ESTIMATED.
WITH day_lines AS (
  SELECT cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id, cl.service_dt, cl.hcpcs,
         cl.paid_amt, h.typical_minutes * cl.units AS minutes
  FROM claim_line cl
  JOIN claim c ON c.claim_id = cl.claim_id
  JOIN ref_hcpcs h ON h.hcpcs = cl.hcpcs
  WHERE cl.rendering_provider_id IS NOT NULL
),
totals AS (
  SELECT provider_id, service_dt, SUM(minutes) AS total_min, COUNT(*) AS n_lines
  FROM day_lines GROUP BY provider_id, service_dt HAVING SUM(minutes) > $cap
)
SELECT 'R-TIME-01' AS rule_id, d.claim_id, d.line_no, d.member_id, d.provider_id, d.service_dt, d.hcpcs, d.paid_amt,
       ROUND(CAST(d.paid_amt AS DOUBLE) * (t.total_min - $cap) / t.total_min, 2) AS dollars,
       CAST(t.total_min AS VARCHAR) || ' typical minutes on one day (cap ' || CAST($cap AS VARCHAR) || ')' AS detail,
       'DAY_OVERLOAD' AS flag_role
FROM day_lines d
JOIN totals t ON t.provider_id = d.provider_id AND t.service_dt = d.service_dt
