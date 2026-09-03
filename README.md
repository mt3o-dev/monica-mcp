# monica-mcp

An MCP server over [Monica CRM](https://www.monicahq.com/) that exposes the
personal-CRM domain as **the tasks a person actually performs**, not as a mirror
of Monica's ~30 REST endpoints.

Other Monica MCP servers wrap the API one tool per endpoint, which leaves the
model doing the orchestration: search the contact, read its id, list the activity
types, pick one, then write. Five of those six calls carry no information — they
exist to satisfy Monica's foreign keys. This server collapses them.

> **Status: design, no implementation.** The domain language is in
> [CONTEXT.md](./CONTEXT.md) and the decisions so far are in [docs/adr/](./docs/adr/).
> Nothing here runs yet.

## Tools

Four, and a tool exists only if you can name the sentence you would say to
trigger it.

| Tool | The sentence | Used by |
| --- | --- | --- |
| `log_interaction` | "log that I had coffee with Mike" | the write path |
| `find_overdue` | "who haven't I spoken to in a while?" | the read path |
| `brief_contact` | "what do I know about Bob?" | the read path |
| `create_reminder` | "remind me to ask Bob how Berlin went in April" | either |

`log_interaction` resolves the contact by name, picks which Monica resource to
store the interaction in, and resets the contact's stay-in-touch clock, in one
call. Ambiguous names are never guessed — the tool returns the candidates and
the caller asks the human.

## Design in one paragraph

Reference data — activity types — is fetched once at startup and embedded as an
enum in the tool schema, so the model picks a valid type in the call it was
already making rather than in a lookup round-trip. That makes startup depend on
Monica: if Monica is unreachable or the token is wrong, the server does not
start. Monica holds all state, including aliases; this server has no database
and no cache. Contact identity is the one thing it will not guess, because a
wrong contact is a silent, invisible error, while a wrong storage shape is not.

## Deployment

A long-lived HTTP Streamable service on the `internal` Docker network, alongside a
self-hosted Monica. There is no public route in v1 and every caller is
authenticated — the network is not the trust boundary. See
[ADR 0002](./docs/adr/0002-http-streamable-long-lived-service.md) and
[ADR 0003](./docs/adr/0003-validate-credentials-never-issue-them.md).

A stdio mode exists for local development. It is not how the server is deployed.

### Clients

- **n8n** — drains captured notes on a schedule and writes interactions
- **`assistant-bot`** — a Telegram bot running `claude -p`, for the read tools
- **claude.ai** — a later addition, and the reason auth is a swappable layer

## Configuration

| Variable | Description |
| --- | --- |
| `MONICA_BASE_URL` | Base URL of the Monica instance |
| `MONICA_API_TOKEN` | Monica API token, from Settings → API |
| `MCP_BEARER_TOKEN` | Credential callers must present |
| `MONICA_EXPECTED_ACCOUNT` | Account the token must belong to; the server refuses to start on a mismatch |

## Development

TypeScript, on the `@modelcontextprotocol/sdk`, which speaks both Streamable
HTTP and stdio.

Development runs against a **separate Monica account on the same instance**, not
against a separate instance. That keeps the real relationship history out of
reach of a half-written write path, but only by account isolation — a
misconfigured token would otherwise write test junk into real data, which is
what `MONICA_EXPECTED_ACCOUNT` exists to prevent.

## License

Not yet chosen.
