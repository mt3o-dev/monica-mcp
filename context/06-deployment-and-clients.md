# 06 — Deployment and clients

**Depends on**: 00–05.

## Running it

`compose.yml` builds and runs the server on the shared Docker network, plus a
loopback publish on `127.0.0.1:8779` for host processes (the bots). The network's
real name comes from `DOCKER_NETWORK` in `.env`, so the committed file carries no
infrastructure names.

```bash
docker compose up -d --build
docker compose logs -f monica-mcp
```

The container runs as `node`, not root: this process holds a token that can read
every contact. `/health` needs no credential and reveals only liveness, which is
what the healthcheck uses.

Verify from either side — from the host over loopback, or from the network the
way another container sees it:

```bash
curl -s http://127.0.0.1:8779/health
docker run --rm --network "$DOCKER_NETWORK" curlimages/curl -s http://monica-mcp:8779/health
```

The publish is loopback-only. `ss -ltn` shows `LISTEN 127.0.0.1:8779`, and the
host's own LAN address refuses the connection — check that if you ever change it.

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

**The chat bot** — a Telegram bot running `claude -p`, with all four tools. Its
`ALLOWED_TOOLS` list is a deliberate security boundary; widening it was a
decision, taken on 2026-09-08. It lives in `shared/modes.js`, not in
`chat-bot.js` as that repo's README claims, and it is shared with the unattended
email responder — so the widening is a *separate* constant
(`ALLOWED_TOOLS_WITH_MONICA`), never a change to `ALLOWED_TOOLS` itself.

**The capture bot** — **superseded 2026-09-08.** This file previously argued it
should stay one-way, with n8n's Telegram node owning the inline keyboard. That
was overruled deliberately: the capture bot now logs **inline**, running its own
`claude -p` immediately after a capture is saved, and owns the disambiguation
keyboard itself.

What that buys: a capture reaches Monica in seconds rather than waiting up to 15
minutes for the drain, and the Telegram path no longer depends on n8n at all.
What it costs: two writers for the same note, so dedupe matters (below).

The capture is still acknowledged first and instantly — the LLM call happens
after the reply and its failure never fails the capture. Only text notes and
transcribed voice are considered; links, photos and documents are not
interactions and never reach an LLM.

Use an inline keyboard rather than a text reply: `callback_data` carries the
pending-capture id plus the contact id, which gives correlation for free and is
one tap from a pub.

Bot changes live in the second-brain vault — a **different repo**, so clone or
worktree rather than switching branches in its live checkout.

## Ambiguity, end to end

Capture arrives → the capture bot calls `log_interaction` → server returns
`ambiguous` → the note keeps `monica_logged` unset → the bot asks via inline
keyboard → the tap re-calls with `contact_ids`. The write is delayed, never
guessed, and nothing is stored server-side in between.

The drain follows the same path when it is the one that picks a note up.

## Done when

- The server runs on the internal network, unreachable from outside. Since
  2026-09-08 it also publishes `127.0.0.1:8779` so host processes — the bots —
  can reach it. Loopback only: verified `LISTEN 127.0.0.1:8779`, and the host's
  own LAN address refuses. Not a public route.
- n8n's AI Agent can call it and log an interaction end to end.
- Both bots can call all four tools.
- An ambiguous capture reaches Telegram as buttons and resolves on one tap.

## Two writers

Both the capture bot and the drain are active, so the same note can be seen
twice. Two guards, and both are needed:

1. **Source-side.** On a successful log the bot appends `monica_logged: true` to
   the note's frontmatter, and the drain skips files carrying it.
2. **CRM-side.** `capture_id` (the `.md` filename, used by both writers) is
   written into the record as a `[capture:<id>]` marker and looked for on the
   way in.

The CRM-side guard alone is **not** sufficient: `findByCaptureId` scans only the
first participant's most recent records *of one shape*, so two independent LLM
extractions that disagree on `medium` — Activity versus Call — never see each
other's marker. That is why the source-side mark exists.

## Out of scope for v1

Public route and the claude.ai connector (needs the identity provider from
[ADR 0003](../docs/adr/0003-validate-credentials-never-issue-them.md)); any
cache; contact creation; anything in Monica without a sentence attached — gifts,
debts, documents, journal.
