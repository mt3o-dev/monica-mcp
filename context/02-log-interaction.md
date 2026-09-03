# 02 — `log_interaction`

**Blocks**: 06. **Depends on**: 00, 01.

*"log that I had coffee with Mike"* — the tool the project exists for. One call,
no lookups. Six calls became one by moving the lookups into the schema and the
resolution into the server.

## Input

| Field | Notes |
| --- | --- |
| `contact` / `contact_id` | accepts several — an interaction may have multiple participants |
| `summary` | required; the model writes it, having been in the conversation |
| `raw_text` | the untouched capture or transcript |
| `activity_type` | enum, built at startup |
| `happened_at` | ISO date, defaults to now |
| `medium` | optional: `phone` \| `in_person` \| `message` |
| `capture_id` | optional; vault filename or hash, for retry safety |
| `follow_up` | optional; delegates to `create_reminder` (05) |

## Behaviour

1. Resolve every contact. **Any ambiguity → return `ambiguous`, write nothing.**
   Partial success is not a thing here.
2. Choose the storage shape — more than one contact → Activity; `medium: phone`
   → Call; per-message authorship genuinely matters → Conversation. The caller
   never names a Monica resource.
   ([ADR 0001](../docs/adr/0001-server-chooses-interaction-shape.md))
3. Write: `summary` into Monica's summary field, `raw_text` **verbatim** into
   `description`. ([ADR 0004](../docs/adr/0004-raw-capture-text-is-stored-verbatim.md))
4. Reset each participant's stay-in-touch clock (`PUT /api/contacts/:id`).
   **Best-effort** — never fail the log because bookkeeping failed. The
   interaction is the data; the clock is derived.

Step 4 is what keeps `find_overdue` (04) cheap: Monica's trigger date stays the
true clock instead of drifting, so the sweep never needs per-contact history.

**Cost**: ~3 requests for a single-contact log.

## Done when

- A single-contact log writes one record and resets one clock.
- A multi-contact log produces an Activity; `medium: phone` produces a Call.
- An ambiguous participant returns `ambiguous` and leaves Monica untouched.
- A failed clock reset still reports `ok` with the record id.
- The same `capture_id` twice does not produce two records.
- `raw_text` survives into `description` byte-for-byte.
