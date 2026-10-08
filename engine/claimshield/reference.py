"""Reference and knowledge data for M1.

IMPORTANT HONESTY NOTE: the code pairs and unit limits below are FIXTURES written for the mini-generator.
They are NOT CMS NCCI/MUE data (those files sit behind an AMA click-through and are loaded later by an
adapter). Labels are our own short labels. Policy sections are synthetic text written for this demo.
"""

from __future__ import annotations

from datetime import date

WINDOW_START = date(2024, 1, 1)
WINDOW_END = date(2025, 12, 31)
ASOF = WINDOW_END

FIXTURE_SOURCE = "FIXTURE (not CMS data)"

SPECIALTIES = [
    ("PRIMARY_CARE", "Primary care", "PROFESSIONAL"),
    ("CARDIOLOGY", "Cardiology", "PROFESSIONAL"),
    ("PHYSICAL_THERAPY", "Physical therapy", "PROFESSIONAL"),
    ("RADIOLOGY", "Radiology", "PROFESSIONAL"),
    ("ORTHOPEDICS", "Orthopedics", "PROFESSIONAL"),
    ("DME_SUPPLIER", "Durable medical equipment supplier", "DME"),
    ("CLINIC", "Multi-specialty clinic", "PROFESSIONAL"),
]

# hcpcs, our label, family, em_level, typical_minutes, is_timed, reference_allowed
HCPCS = [
    ("99213", "Office visit, established patient, level 3", "EM_OFFICE", 3, 20, False, 92.00),
    ("99214", "Office visit, established patient, level 4", "EM_OFFICE", 4, 30, False, 130.00),
    ("99215", "Office visit, established patient, level 5", "EM_OFFICE", 5, 40, False, 180.00),
    ("93000", "ECG with interpretation", "PROCEDURE", None, 10, False, 18.00),
    ("93005", "ECG tracing only", "PROCEDURE", None, 5, False, 8.00),
    ("20610", "Large joint injection", "PROCEDURE", None, 15, False, 55.00),
    ("97110", "Therapeutic exercise (15-minute unit)", "THERAPY", None, 15, True, 32.00),
    ("71046", "Chest X-ray, two views", "IMAGING", None, 10, False, 45.00),
    ("36415", "Blood draw", "LAB", None, 5, False, 6.00),
    ("85025", "Complete blood count", "LAB", None, 0, False, 9.00),
    ("E0601", "CPAP device", "DME", None, 0, False, 120.00),
    ("E1390", "Oxygen concentrator", "DME", None, 0, False, 85.00),
    ("K0823", "Power wheelchair", "DME", None, 0, False, 1850.00),
]
REFERENCE_ALLOWED = {h[0]: h[6] for h in HCPCS}

# col1, col2, modifier_ind (0 = never allowed together, 1 = allowed with an appropriate modifier)
FIXTURE_PTP = [
    ("93000", "93005", 0),
    ("20610", "99213", 1),
    ("20610", "99214", 1),
]
# Modifiers that justify billing a pair separately. Initial list is from memory of CMS policy: [verify].
PTP_BYPASS_MODIFIERS = ["25", "59", "XE", "XP", "XS", "XU", "24", "57", "58", "78", "79"]

# hcpcs, service_type, mue_value, mai
FIXTURE_MUE = [
    ("99213", "PRACTITIONER", 1, 1),
    ("99214", "PRACTITIONER", 1, 1),
    ("99215", "PRACTITIONER", 1, 1),
    ("93000", "PRACTITIONER", 1, 1),
    ("93005", "PRACTITIONER", 1, 1),
    ("20610", "PRACTITIONER", 2, 2),   # date-of-service edit (MAI 2), exercises the day-sum branch
    ("97110", "PRACTITIONER", 4, 1),
    ("71046", "PRACTITIONER", 2, 1),
    ("36415", "PRACTITIONER", 1, 1),
    ("85025", "PRACTITIONER", 1, 1),
    ("E0601", "DME", 1, 1),
    ("E1390", "DME", 1, 1),
    ("K0823", "DME", 1, 1),
]

POS = [("11", "Office", False), ("12", "Home", False), ("21", "Inpatient hospital", True)]

DME_VISIT_WINDOW_DAYS = 60
TIME_CAP_MINUTES = 720          # R-TIME-01: more than 12 h of typical service time for one provider in one day
GEO_KM = 100.0                  # R-GEO-01: same member, same day, two places further apart than this
GEO_HISTORY_DAYS = 180          # R-GEO-01: how far back to look for the member's usual provider

# ---- peer statistics (channel PEER) ------------------------------------------------------------------------
PEER_MIN_PEERS = 5              # a peer group smaller than this gives no signal (low_peer)
PEER_Z_ALERT = 3.0              # robust z needed to alert
PEER_SHRINK_K = 10.0            # shrinkage of a provider rate toward the peer median: n / (n + k)
PEER_WINDOW_MONTHS = 6          # months of the data window that are evaluated (the most recent)
PEER_MIN_EM = 20                # S-UPC: office E&M lines in the trailing 3 months
PEER_MIN_MEMBERS = 8            # S-UTL / S-GHOST / S-DIST: distinct members
UPC_MIN_GAP = 0.15              # S-UPC: also needs this absolute gap in level 4-5 share over the peer median
UTL_MIN_RATIO = 1.5             # S-UTL: lines per member must also be this multiple of the peer median
GHOST_MIN_SHARE = 0.25          # S-GHOST: minimum exclusive-member share
DIST_MIN_KM = 100.0             # S-DIST: minimum mean member distance
GHOST_LOOKBACK_MONTHS = 12
# ---- graph (channel NETWORK) and temporal (channel SELF) thresholds
REFCONC_MIN_PEERS = 4          # G-REFCONC: peers needed (a specialty may have few referral-fed members)
GRAPH_WINDOW_MONTHS = 6         # referral statistics window for owner groups and loops
GRAPH_REFCONC_MONTHS = 12       # referral concentration needs more orders to be meaningful
OWNREF_MIN_SHARE = 0.5
OWNREF_MIN_REFERRALS = 30
REFCONC_MIN_SHARE = 0.8
REFCONC_MIN_REFERRALS = 30
LOOP_MIN_EDGE_REFERRALS = 5
LOOP_MAX_GROUP = 25
INFRA_LINK_WEIGHT = {"owner": 0.5, "phone": 0.3, "address": 0.2, "facility": 0.2}
INFRA_CAP = 0.4
CUSUM_K = 0.5
CUSUM_H = 5.0
CUSUM_BASE_MONTHS = 6
GROWTH_Z_ALERT = 3.0
RAMP_TENURE_MONTHS = 12
PEER_MIN_MONTHS = 2             # a peer pattern must show in this many evaluated months (a pattern, not a blip)
DOLLAR_MIN_HARD_FACT = 100.0   # d_min for the "hard fact alone => HIGH" tier rule

# ---- scheme / rule vocabulary ---------------------------------------------------------------------------
# rule_id -> (scheme_type, name, base_strength, policy_section, hard_fact, default_action, flag_role)
RULES = {
    "R-DUP-01": ("DUP", "Exact duplicate line", 1.0, "POL-BILL-1.1", True, "REQUEST_RECORDS"),
    "R-PTP-01": ("UNB", "Code pair billed together without allowed modifier", 0.9, "POL-CODE-2.1", True,
                 "PROVIDER_EDUCATION"),
    "R-MUE-01": ("EXU", "Units above published limit", 0.9, "POL-CODE-2.2", True, "PROVIDER_EDUCATION"),
    "R-DOD-01": ("PHA", "Service dated after recorded death", 1.0, "POL-ELIG-3.1", True, "REQUEST_RECORDS"),
    "R-EXCL-01": ("EXC", "Billing by an excluded provider", 1.0, "POL-ENR-5.1", True, "REFER_EXTERNAL"),
    "R-DME-01": ("DME", "DME order without a qualifying visit", 0.8, "DME-POL-4.2", False, "REQUEST_RECORDS"),
    "R-TIME-01": ("TMA", "More service time in a day than a provider can deliver", 0.8, "POL-TIME-6.1", False,
                  "REQUEST_RECORDS"),
    "R-GEO-01": ("TMB", "Same member in two distant places on one day", 0.8, "POL-TIME-6.2", True,
                 "REQUEST_RECORDS"),
    "R-IP-01": ("PHB", "Office or home service during an inpatient stay", 0.85, "POL-ELIG-3.2", True,
                "REQUEST_RECORDS"),
    # PEER channel (statistical, base strength is replaced per alert by the z-based strength)
    "S-UPC": ("UPC", "Higher share of high-level office visits than peers", 0.6, "POL-CODE-2.3", False,
              "REQUEST_RECORDS"),
    "S-UTL": ("UTL", "More lines per member than peers", 0.6, "POL-UTIL-7.1", False, "REQUEST_RECORDS"),
    "S-GHOST": ("PHC", "Members who see no other provider", 0.6, "POL-ELIG-3.3", False, "REQUEST_RECORDS"),
    "S-DIST": ("DIS", "Members travel further than for peers", 0.5, "POL-UTIL-7.2", False, "MONITOR"),
    # NETWORK channel (graph analytics)
    "G-OWNREF": ("RNG", "Patients referred inside one owner group", 0.7, "POL-NET-8.1", False, "REQUEST_RECORDS"),
    "G-LOOP": ("RNG", "Closed loops of referrals between providers", 0.6, "POL-NET-8.1", False, "REQUEST_RECORDS"),
    "G-REFCONC": ("RFC", "Referrals concentrated in a few referrers", 0.6, "POL-NET-8.2", False,
                  "REQUEST_RECORDS"),
    "G-INFRA": ("INF", "Providers that share infrastructure", 0.4, "POL-NET-8.3", False, "MONITOR"),
    # SELF channel (a provider against its own history)
    "T-CUSUM": ("TRD", "A sustained change from the provider's own history", 0.5, "POL-TEMP-9.1", False,
                "REQUEST_RECORDS"),
    "T-GROWTH": ("GRW", "Billing growing much faster than peers", 0.5, "POL-TEMP-9.1", False, "REQUEST_RECORDS"),
    "T-RAMP": ("RMP", "A new provider already billing like an established one", 0.5, "POL-TEMP-9.2", False,
               "REQUEST_RECORDS"),
}
# rules whose dollars are inferred, not read from the claim lines
PEER_RULES = {"S-UPC", "S-UTL", "S-GHOST", "S-DIST"}
GRAPH_RULES = {"G-OWNREF", "G-LOOP", "G-REFCONC", "G-INFRA"}
TEMPORAL_RULES = {"T-CUSUM", "T-GROWTH", "T-RAMP"}
ESTIMATED_RULES = {"R-TIME-01"} | PEER_RULES | GRAPH_RULES | TEMPORAL_RULES
# detectors that raise an alert without claim lines (the evidence is a statistic about the provider or the group)
ALERT_ONLY_RULES = {"G-INFRA"} | TEMPORAL_RULES
SQL_RULES = ["R-DUP-01", "R-PTP-01", "R-MUE-01", "R-DOD-01", "R-EXCL-01", "R-DME-01", "R-TIME-01", "R-GEO-01",
             "R-IP-01"]
CHANNEL_OF = {r: ("PEER" if r in PEER_RULES else "NETWORK" if r in GRAPH_RULES else "SELF" if r in TEMPORAL_RULES
                  else "LINE") for r in RULES}
RULE_VERSION = 1
HARD_FACT_RULES = {r for r, v in RULES.items() if v[4]}

# scheme_type -> (severity_weight, harm_weight). Triage weights are design judgements, not statistics.
SCHEME_WEIGHTS = {
    "EXC": (1.00, 0.70), "PHA": (0.95, 0.90), "DME": (0.85, 0.80),
    "UNB": (0.55, 0.30), "DUP": (0.50, 0.30), "EXU": (0.50, 0.30),
    "PHB": (0.85, 0.80), "PHC": (0.90, 0.70), "TMA": (0.60, 0.40), "TMB": (0.75, 0.50),
    "UPC": (0.55, 0.45), "UTL": (0.50, 0.50), "DIS": (0.30, 0.20),
    "RNG": (0.90, 0.60), "RFC": (0.60, 0.40), "INF": (0.30, 0.20), "TRD": (0.40, 0.30), "GRW": (0.40, 0.30),
    "RMP": (0.50, 0.40),
}

HYPOTHESIS_TEXT = {
    "DUP": "Billing pattern consistent with duplicate submission",
    "UNB": "Code combinations that published coding edits do not allow together",
    "EXU": "Service units above published limits",
    "PHA": "Services dated after a recorded death",
    "EXC": "Billing by an entity listed as excluded",
    "DME": "Equipment orders without qualifying visits by the ordering provider",
    "TMA": "Billed service time in a single day that exceeds what one provider can deliver",
    "TMB": "The same member billed in two distant places on one day",
    "PHB": "Office or home services billed while the member was an inpatient elsewhere",
    "UPC": "Visit levels higher than peers with a similar practice",
    "UTL": "More services per member than peers with a similar practice",
    "PHC": "Services for members who show no other care in the prior year",
    "DIS": "Members travel unusually far to reach the provider",
    "RNG": "Providers under one owner refer patients to each other",
    "RFC": "Referrals come from very few referring providers",
    "INF": "Providers share an owner, a phone number or a building",
    "TRD": "The provider's own billing pattern changed and stayed changed",
    "GRW": "Billed dollars grew far faster than for peers",
    "RMP": "A newly enrolled provider bills like an established one",
}

# rule evidence statement templates: placeholders {{E<n>.key}} are filled from the numbers registry
RULE_TEMPLATE = {
    "R-DUP-01": "{{EV.n}} lines duplicate an earlier identical line (same member, date, code, modifiers, units)",
    "R-PTP-01": "{{EV.n}} lines were billed together with a paired code without an allowed modifier",
    "R-MUE-01": "{{EV.n}} lines exceed the published unit limit for their code",
    "R-DOD-01": "{{EV.n}} lines have service dates after the member's recorded date of death",
    "R-EXCL-01": "{{EV.n}} lines were billed after the provider's recorded exclusion date",
    "R-DME-01": "{{EV.n}} equipment orders had no qualifying visit by the ordering provider in the prior "
                "{{EV.days}} days",
    "R-TIME-01": "{{EV.n}} lines fall on {{EV.days}} days when the typical service time billed exceeds {{EV.cap}} "
                 "minutes",
    "R-GEO-01": "{{EV.n}} lines were billed for a member who was billed more than {{EV.km}} km away on the same date",
    "R-IP-01": "{{EV.n}} office or home services fall between the admission and discharge dates of an inpatient stay",
    "S-UPC": "The share of high-level office visits (levels four and five) is {{EV.share}} against a peer median of "
             "{{EV.peer}} "
             "({{EV.peers}} peers); members' mean acuity is {{EV.acuity}} against {{EV.peerAcuity}}",
    "G-OWNREF": "{{EV.share}} of the referral dollars from this owner group stay inside it ({{EV.referrals}} "
                "referrals among {{EV.members}} providers)",
    "G-LOOP": "{{EV.cycles}} closed referral loops of at most {{EV.length}} providers under one owner",
    "G-REFCONC": "{{EV.share}} of the referrals come from {{EV.referrers}} referring providers (peer median "
                 "{{EV.peer}}, {{EV.peers}} peers)",
    "G-INFRA": "{{EV.members}} providers share infrastructure: {{LINKS}}",
    "T-CUSUM": "{{METRIC}} moved from {{EV.from}} to {{EV.to}} and stayed there for {{EV.months}} months",
    "T-GROWTH": "Billed dollars are {{EV.ratio}} the level of the previous ninety days (peer median {{EV.peer}})",
    "T-RAMP": "Enrolled {{EV.tenure}} months ago and already billing {{EV.ratio}} the volume of established peers",
    "S-UTL": "{{EV.lpm}} lines per member per month against a peer median of {{EV.peer}} ({{EV.peers}} peers)",
    "S-GHOST": "{{EV.share}} of this provider's members had no claim from any other provider in the prior "
               "{{EV.months}} months (peer median {{EV.peer}}, {{EV.peers}} peers)",
    "S-DIST": "Members live {{EV.km}} km from this provider on average against a peer median of {{EV.peer}} km "
              "({{EV.peers}} peers)",
}

ALLOWED_ACTIONS = ["REQUEST_RECORDS", "PROVIDER_EDUCATION", "PREPAY_REVIEW_FLAG", "MONITOR", "REFER_EXTERNAL"]
FORBIDDEN_TERMS = ["fraud", "fraudulent", "criminal", "guilty", "illegal", "steal", "scam", "intentional",
                   "deliberate", "knowingly", "kickback"]

POLICY_SECTIONS = [
    ("POL-BILL-1.1", "POL-BILL", "Duplicate submissions",
     "A line identical to an earlier line for the same member, rendering provider, date of service, code, "
     "modifiers and units is treated as a duplicate submission and is not payable twice."),
    ("POL-CODE-2.1", "POL-CODE", "Paired procedure codes",
     "Where a published edit pairs two codes, the second code is not separately payable on the same date "
     "unless a modifier that supports separate reporting is present (where the edit allows one)."),
    ("POL-CODE-2.2", "POL-CODE", "Units of service limits",
     "Units billed for a code on one date of service must not exceed the published unit limit for that code."),
    ("POL-ELIG-3.1", "POL-ELIG", "Services after death",
     "Services are not payable for dates after a member's recorded date of death."),
    ("POL-ENR-5.1", "POL-ENR", "Excluded providers",
     "Items and services furnished by a provider on the exclusion list are not payable for dates on or "
     "after the exclusion date."),
    ("POL-CODE-2.3", "POL-CODE", "Visit levels",
     "The level of an office visit must be supported by the medical decision making or time documented for it; "
     "a share of high-level visits far above comparable providers is reviewed."),
    ("POL-TIME-6.1", "POL-TIME", "Service time in a day",
     "The service time implied by the codes billed by one provider in one day must be deliverable in that day."),
    ("POL-TIME-6.2", "POL-TIME", "One member, one place",
     "A member cannot receive services in two places that are far apart on the same date unless one is remote."),
    ("POL-ELIG-3.2", "POL-ELIG", "Services during an inpatient stay",
     "Office or home services are not payable for dates between a member's inpatient admission and discharge."),
    ("POL-ELIG-3.3", "POL-ELIG", "Members who are not otherwise seen",
     "Services for members with no other recorded care are reviewed to confirm the member received them."),
    ("POL-UTIL-7.1", "POL-UTIL", "Utilization compared with peers",
     "Services per member that are far above comparable providers are reviewed for medical need."),
    ("POL-UTIL-7.2", "POL-UTIL", "Member travel",
     "Members who travel unusually far for routine services are reviewed to confirm access and need."),
    ("POL-NET-8.1", "POL-NET", "Common ownership and referrals",
     "Providers under one controlling owner that send most of their referrals to each other are reviewed for "
     "steering of patients."),
    ("POL-NET-8.2", "POL-NET", "Concentrated referral sources",
     "A provider that receives nearly all its referrals from a few sources is reviewed for the relationship."),
    ("POL-NET-8.3", "POL-NET", "Shared infrastructure",
     "Providers that share an owner, a phone number or a building are reviewed together; sharing a building alone "
     "is not a finding."),
    ("POL-TEMP-9.1", "POL-TEMP", "Changes in billing pattern",
     "A lasting change in a provider\'s own billing pattern, or growth far above peers, is reviewed."),
    ("POL-TEMP-9.2", "POL-TEMP", "New providers",
     "A newly enrolled provider billing at the volume of established providers is reviewed."),
    ("DME-POL-4.2", "DME-POL", "Equipment orders",
     "Equipment orders require a qualifying visit between the member and the ordering provider within the "
     f"{DME_VISIT_WINDOW_DAYS} days before the order."),
]
POLICY_PROVENANCE = "SYNTHETIC: written for this demo, modeled on public CMS concepts"
POLICY_EFF_DT = date(2024, 1, 1)

GLOSSARY = [
    ("GL-DUP", "Duplicate submission", "The same service billed more than once with identical details.", "billing"),
    ("GL-PTP", "Paired code edit", "A published rule that two codes are not payable together on one date, "
     "sometimes unless a supporting modifier is present.", "billing"),
    ("GL-MUE", "Unit limit", "The published maximum units of a code that is plausible for one date of service.",
     "billing"),
    ("GL-PEER", "Peer comparison", "A statistical comparison with providers of the same specialty. It shows an unusual "
     "pattern, not a cause; legitimate practices can look unusual.", "platform"),
    ("GL-NET", "Network signal", "A relationship between providers (shared owner, referrals, location). It points "
     "to a group to review together; it does not show wrongdoing.", "platform"),
    ("GL-SELF", "Change from own history", "A comparison of a provider with its own earlier months, so it does not "
     "depend on how comparable the peers are.", "platform"),
    ("GL-TIME", "Typical service time", "Minutes assumed for a code in this demo (our own assumption, not published "
     "CMS data).", "platform"),
    ("GL-QV", "Qualifying visit", "A visit between member and ordering provider that supports an equipment order.",
     "policy"),
    ("GL-EXACT", "Exact vs estimated dollars", "Exact dollars come from implicated claim lines; estimated "
     "dollars are inferred (not used in this build).", "platform"),
    ("GL-TIER", "Confidence tier", "HIGH, MEDIUM or LOW, computed by fixed rules from independent evidence "
     "channels. LOW items are monitored, not opened as cases.", "platform"),
]

# deterministic action policy (docs/..._AI_Second_Brain.md section 10.1)
def permitted_actions(tier: str) -> list[dict]:
    if tier == "LOW":
        return [{"action": "MONITOR", "needs": "NONE"}]
    base = [
        {"action": "REQUEST_RECORDS", "needs": "NONE"},
        {"action": "PROVIDER_EDUCATION", "needs": "NONE"},
        {"action": "MONITOR", "needs": "NONE"},
    ]
    if tier == "HIGH":
        base += [
            {"action": "PREPAY_REVIEW_FLAG", "needs": "SUPERVISOR"},
            {"action": "REFER_EXTERNAL", "needs": "SUPERVISOR"},
        ]
    return base


# short platform help articles (served by the knowledge screen and used by the assistant)
HELP = [
    ("HLP-001", "How cases are ranked",
     "Cases are ranked by a transparent utility that combines risk, dollars, member impact, severity and evidence "
     "strength, then filled into investigator capacity from the top. Every factor is shown as its own column."),
    ("HLP-002", "What the confidence tiers mean",
     "HIGH means independent evidence agrees or a recorded fact stands alone. MEDIUM means expert review is "
     "justified. LOW items are not cases; they sit on the Monitor list with what would raise confidence."),
    ("HLP-003", "How to review a case",
     "Open the case, read the evidence and the brief, then Accept, Modify or Reject the suggested action. Modify "
     "and Reject need a reason code. Nothing is applied until a person decides."),
    ("HLP-004", "How to approve a high-impact action",
     "Prepayment review flags and external referrals need a supervisor who is not the person who proposed them."),
    ("HLP-005", "What a precedent is",
     "A precedent is a closed case turned into knowledge. It becomes active only after a second person co-signs "
     "it, and then it informs the evidence strength of similar future cases."),
    ("HLP-006", "What an exception rule is",
     "An exception moves a repeated false alarm from the review queue to the Monitor list. It is drafted from a "
     "rejected case, simulated, and approved by someone other than its proposer. It can never touch a recorded "
     "fact such as a duplicate, a service after death or an excluded provider."),
    ("HLP-007", "What the Monitor list is",
     "Items with too little independent evidence to open a case, plus items an approved exception downgraded. "
     "Each one says what would raise confidence."),
    ("HLP-008", "What estimated dollars mean",
     "Exact dollars are read from flagged claim lines. Estimated dollars are inferred from comparisons with peers "
     "or from time assumptions and are never shown as recoverable amounts."),
]
