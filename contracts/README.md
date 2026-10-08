# contracts/

The shared agreements between the three processes. **Change a contract here first, then change the code.**

| Path | Owner (writer) | Consumers | What it is |
|---|---|---|---|
| `sql/serving_schema.sql` | Python engine | Java gateway (read-only) | `serving_*` tables, versioned by `run_id` |
| `sql/wf_schema.sql` | Java gateway | nobody else | `wf_*` workflow, precedent, exception, audit tables (applied at gateway startup) |
| `schemas/*.schema.json` | engine (producer) | gateway validator | JSON Schemas: `evidence_pack` (pk_v1), `brief_output`, `chat_answer`, engine request/response bodies |

Rules
- The engine writes only `serving_*`; the gateway writes only `wf_*`. Neither touches the other's tables.
- The gateway splits `wf_schema.sql` on a line of three caret characters. Never write that token in a comment.
- Freeze these at integration checkpoint IC0 (see docs/ClaimShield_Nexus_Execution_Plan.md).
