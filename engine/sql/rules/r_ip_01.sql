-- R-IP-01 office or home service strictly between a member's inpatient admission and discharge dates.
SELECT 'R-IP-01' AS rule_id, cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id,
       cl.service_dt, cl.hcpcs, cl.paid_amt, cl.paid_amt AS dollars,
       'service ' || CAST(cl.service_dt AS VARCHAR) || ' during stay ' || CAST(s.admit_dt AS VARCHAR) || ' to '
         || CAST(s.discharge_dt AS VARCHAR) AS detail,
       'DURING_STAY' AS flag_role
FROM claim_line cl
JOIN claim c ON c.claim_id = cl.claim_id
JOIN ref_place_of_service p ON p.pos_code = cl.pos_code AND NOT p.is_facility
JOIN inpatient_stay s ON s.member_id = c.member_id AND cl.service_dt > s.admit_dt AND cl.service_dt < s.discharge_dt
WHERE cl.rendering_provider_id IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY cl.claim_id, cl.line_no ORDER BY s.admit_dt) = 1
