-- R-GEO-01 same member, same date, two providers more than $km kilometres apart (Haversine on practice locations).
-- One side is flagged: the claim from the provider the member has used LESS in the prior $history days (the unfamiliar
-- place); ties go to the lower-paid claim, then the larger provider ID. The other side is only context.
WITH visits AS (
  SELECT c.claim_id, c.member_id, c.rendering_provider_id AS provider_id, c.from_dt AS dt, c.paid_amt, l.lat, l.lon
  FROM claim c JOIN provider_location l ON l.provider_id = c.rendering_provider_id
  WHERE c.claim_type = 'CARRIER'
),
pairs AS (
  SELECT a.claim_id AS a_claim, b.claim_id AS b_claim, a.member_id, a.dt, a.provider_id AS a_prov,
         b.provider_id AS b_prov, a.paid_amt AS a_paid, b.paid_amt AS b_paid,
         2 * 6371.0 * asin(sqrt(pow(sin(radians(b.lat - a.lat) / 2), 2)
              + cos(radians(a.lat)) * cos(radians(b.lat)) * pow(sin(radians(b.lon - a.lon) / 2), 2))) AS km
  FROM visits a JOIN visits b ON a.member_id = b.member_id AND a.dt = b.dt AND a.provider_id < b.provider_id
),
far AS (SELECT * FROM pairs WHERE km > $km),
hist AS (
  SELECT f.a_claim, f.b_claim,
    (SELECT COUNT(*) FROM claim x WHERE x.member_id = f.member_id AND x.rendering_provider_id = f.a_prov
        AND x.from_dt < f.dt AND x.from_dt >= f.dt - CAST($history AS INTEGER)) AS a_hist,
    (SELECT COUNT(*) FROM claim x WHERE x.member_id = f.member_id AND x.rendering_provider_id = f.b_prov
        AND x.from_dt < f.dt AND x.from_dt >= f.dt - CAST($history AS INTEGER)) AS b_hist
  FROM far f
),
chosen AS (
  SELECT f.*, h.a_hist, h.b_hist,
    CASE WHEN h.a_hist < h.b_hist THEN 'A' WHEN h.b_hist < h.a_hist THEN 'B'
         WHEN f.a_paid < f.b_paid THEN 'A' WHEN f.b_paid < f.a_paid THEN 'B' ELSE 'B' END AS side
  FROM far f JOIN hist h USING (a_claim, b_claim)
)
SELECT 'R-GEO-01' AS rule_id, cl.claim_id, cl.line_no, ch.member_id,
       CASE WHEN ch.side = 'A' THEN ch.a_prov ELSE ch.b_prov END AS provider_id,
       cl.service_dt, cl.hcpcs, cl.paid_amt, cl.paid_amt AS dollars,
       'also billed ' || CAST(ROUND(ch.km) AS VARCHAR) || ' km away on the same date' AS detail,
       'DISTANT_SAME_DAY' AS flag_role
FROM chosen ch
JOIN claim_line cl ON cl.claim_id = CASE WHEN ch.side = 'A' THEN ch.a_claim ELSE ch.b_claim END
QUALIFY ROW_NUMBER() OVER (PARTITION BY cl.claim_id, cl.line_no ORDER BY ch.km DESC) = 1
