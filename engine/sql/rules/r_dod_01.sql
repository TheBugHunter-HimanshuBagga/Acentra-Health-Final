-- R-DOD-01 service dated after the member's recorded date of death.
SELECT 'R-DOD-01' AS rule_id, cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id,
       cl.service_dt, cl.hcpcs, cl.paid_amt, cl.paid_amt AS dollars,
       'service ' || CAST(cl.service_dt AS VARCHAR) || ' after death ' || CAST(m.death_dt AS VARCHAR) AS detail,
       'POST_DEATH' AS flag_role
FROM claim_line cl
JOIN claim c ON c.claim_id = cl.claim_id
JOIN member m ON m.member_id = c.member_id
WHERE m.death_dt IS NOT NULL AND cl.service_dt > m.death_dt
