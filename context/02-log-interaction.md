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
| `remember_alias` | optional; see 01 — writes the alias back after a disambiguation |
| `resolved_from` | optional; the name originally typed, when re-calling with `contact_ids` |

There is deliberately no `follow_up`: you chose four separate tools over three
with a follow-up parameter, and a parameter that duplicates a tool is how
surface area doubles. A capture containing both an interaction and a future
event produces two calls.

## Behaviour

1. Resolve every contact. **Any ambiguity → return `ambiguous`, write nothing.**
   Partial success is not a thing here.
2. Choose the storage shape — `medium: phone` → Call; everything else →
   Activity. The caller never names a Monica resource.
   **Conversation is out of scope for v1**: it needs a `contact_field_type_id`
   (the channel — SMS, email) that no input supplies, it is the most expensive
   write of the three, and "per-message authorship matters" has never been a
   sentence anyone said.
   ([ADR 0001](../docs/adr/0001-server-chooses-interaction-shape.md))
3. Write: `summary` into Monica's summary field, `raw_text` **verbatim** into
   `description`. ([ADR 0004](../docs/adr/0004-raw-capture-text-is-stored-verbatim.md))
There is **no fourth step**. We planned to reset each participant's
stay-in-touch clock here; the API cannot write it, and Monica maintains
`last_activity_together` / `last_called` by itself when the record is created.
See [ADR 0005](../docs/adr/0005-overdue-reads-monicas-own-timestamps.md). That
removes a write, and with it the partial-failure state where the interaction
lands but the bookkeeping does not.

**Cost**: ~2 requests for a single-contact log.

## Done when

- A single-contact log writes one record and resets one clock.
- A multi-contact log produces an Activity; `medium: phone` produces a Call.
- No input can produce a Conversation.
- An ambiguous participant returns `ambiguous` and leaves Monica untouched.
- The same `capture_id` twice does not produce two records.
- After a log, the participant's `last_activity_together` reflects `happened_at`.
- `raw_text` survives into `description` byte-for-byte.
