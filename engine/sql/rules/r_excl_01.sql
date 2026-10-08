-- R-EXCL-01 billing by a provider on the exclusion list, on or after the exclusion date
-- (and before reinstatement, if any).
SELECT 'R-EXCL-01' AS rule_id, cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id,
       cl.service_dt, cl.hcpcs, cl.paid_amt, cl.paid_amt AS dollars,
       'excluded since ' || CAST(e.excl_dt AS VARCHAR) AS detail,
       'EXCLUDED_BILLING' AS flag_role
FROM claim_line cl
JOIN claim c ON c.claim_id = cl.claim_id
JOIN exclusion e ON e.provider_id = cl.rendering_provider_id
WHERE cl.service_dt >= e.excl_dt AND (e.reinstate_dt IS NULL OR cl.service_dt < e.reinstate_dt)
