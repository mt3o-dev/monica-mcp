# 06 — Deployment and clients

**Depends on**: 00–05.

## The server

A long-lived HTTP Streamable service on the shared internal Docker network,
alongside the other stacks. **No public route in v1.** Every caller is
authenticated — the network is not the trust boundary, because CI runners sit on
that same network.
([ADR 0002](../docs/adr/0002-http-streamable-long-lived-service.md))

## Clients

**n8n** — drains captured notes on a schedule and writes interactions. Needs an
AI Agent node with this server attached via the MCP Client Tool; the drain
requires an LLM, since turning free text into an Interaction is language work.
HTTP Streamable specifically: SSE is deprecated there.

**The chat bot** — a Telegram bot running `claude -p`, for the read tools. Note
its `ALLOWED_TOOLS` list is a deliberate security boundary and currently grants
no MCP access; widening it is a decision, not a detail.

**The capture bot** — one-way by design, but needs to ask the disambiguation
question. Use an **inline keyboard**, not a text reply: `callback_data` carries
the pending-capture id plus contact id, which gives correlation for free and is
one tap from a pub. It needs a small `pending.json`, which is precedent it
already has for sessions.

Both bot changes live in the second-brain vault — a **different repo**, so use a
worktree rather than switching branches in its live checkout.

## Ambiguity, end to end

Capture arrives → drain calls `log_interaction` → server returns `ambiguous` →
the capture stays unprocessed in the vault → the capture bot asks via inline
keyboard → the answer re-calls with `contact_id`. The write is delayed, never
guessed, and nothing is stored server-side in between.

## Done when

- The server runs on the internal network, unreachable from outside.
- n8n's AI Agent can call it and log an interaction end to end.
- The chat bot can call the read tools.
- An ambiguous capture reaches Telegram as buttons and resolves on one tap.

## Out of scope for v1

Public route and the claude.ai connector (needs the identity provider from
[ADR 0003](../docs/adr/0003-validate-credentials-never-issue-them.md)); any
cache; contact creation; anything in Monica without a sentence attached — gifts,
debts, documents, journal.
