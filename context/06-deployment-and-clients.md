# 06 — Deployment and clients

**Depends on**: 00–05.

## Running it

`compose.yml` builds and runs the server with no `ports:` — reachable only from
the shared Docker network. The network's real name comes from `DOCKER_NETWORK`
in `.env`, so the committed file carries no infrastructure names.

```bash
docker compose up -d --build
docker compose logs -f monica-mcp
```

The container runs as `node`, not root: this process holds a token that can read
every contact. `/health` needs no credential and reveals only liveness, which is
what the healthcheck uses.

Verify from the network rather than the host — the host cannot reach it, by
design:

```bash
docker run --rm --network "$DOCKER_NETWORK" curlimages/curl -s http://monica-mcp:8779/health
```

## Wiring the clients

**n8n** — a workflow named *Monica drain — 2-Inbox to CRM* is imported and
**inactive**: schedule trigger every 15 minutes, read `/vault/2-Inbox/*.md`,
extract the text, hand it to an AI Agent with the MCP Client Tool attached.

- Endpoint `http://monica-mcp:8779/mcp`, transport **HTTP Streamable** (not SSE,
  which is deprecated there)
- Auth: an `httpBearerAuth` credential named `monica-mcp bearer`, encrypted at
  rest with n8n's encryption key

The agent prompt tells it to pass the note text through **unedited** as
`raw_text`, to set `capture_id` to the filename so a retry cannot double-write,
and — importantly — to **stop and report candidates** if `log_interaction`
returns `ambiguous`, rather than calling again with a guess.

The drain needs an LLM in the loop, since turning free text into an Interaction
is language work. That belongs on an AI Agent node, never an HTTP Request node.

Two things it still needs before activation:

1. **A mount.** n8n cannot see the vault. Add to its compose service and
   recreate:
   ```yaml
   volumes:
     - /path/to/vault/2-Inbox:/vault/2-Inbox
   ```
2. **An LLM credential** on the Anthropic Chat Model node.

**Claude Code**:

```bash
claude mcp add --transport http monica http://monica-mcp:8779/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

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

**The capture bot** — one-way by design, but the disambiguation question has to
reach Telegram somehow. **It probably needs no code change at all.** n8n has a
Telegram node, and it already owns the drain: it can send the inline keyboard
using the capture bot's own token and receive the tap through a Telegram
trigger. The message arrives from the same bot either way, so the user-visible
behaviour is what was asked for, without giving a deliberately one-way bot a
conversation loop.

Use an inline keyboard rather than a text reply: `callback_data` carries the
pending-capture id plus the contact id, which gives correlation for free and is
one tap from a pub.

Bot changes live in the second-brain vault — a **different repo**, so clone or
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
