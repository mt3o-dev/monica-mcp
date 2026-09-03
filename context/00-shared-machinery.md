# 00 — Shared machinery

**Blocks**: everything. **Depends on**: nothing.

Roughly two thirds of v1. The tools are thin; this is the project.

## Build

### Startup sequence

Refuse to run half-configured. In order:

1. Read `MONICA_BASE_URL`, `MONICA_API_TOKEN`, `MCP_BEARER_TOKEN`,
   `MONICA_EXPECTED_ACCOUNT`. Missing → exit non-zero naming the variable.
2. `GET /api/me`. Unreachable, 401, or an account other than
   `MONICA_EXPECTED_ACCOUNT` → exit non-zero. This is what stops a misconfigured
   token writing test data into the real account.
3. `GET /api/activitytypes`. The result becomes an enum in the
   `log_interaction` schema. Failure → exit non-zero.

Activity types added in Monica's UI need a restart to appear. Accepted: that
data changes yearly and is not worth an invalidation story.

### Authentication

One function: `validate(credential) -> ok | reject`. Nothing else in the server
reads anything out of the credential. v1 compares against `MCP_BEARER_TOKEN`.
v2 replaces the body with JWT validation and no caller changes. See
[ADR 0003](../docs/adr/0003-validate-credentials-never-issue-them.md).

### Result shape

Every tool returns `status`: `ok` | `ambiguous` | `not_found` | `rate_limited` |
`error`. A raw API error is never thrown at the model. Successful writes return
the Monica record id so the caller can log what it did.

### Throttling

Monica allows 60 req/min by default (`throttle:60,1`, raisable on the hosted
instance). The server owns this — it is the only component that sees every call
from every client.

- Track `X-RateLimit-Remaining` on every response.
- On 429: respect `Retry-After`, retry once, then fail.
- Exhausted → **fail, never queue**. The vault still holds the unprocessed
  capture, so a failed drain loses nothing, and a tool that silently defers
  writes cannot be reasoned about.

### Transport

HTTP Streamable, long-lived. stdio mode retained for local development only.
See [ADR 0002](../docs/adr/0002-http-streamable-long-lived-service.md).

## Done when

- Server exits non-zero, with a useful message, for: each missing env var; an
  unreachable Monica; a bad token; an account mismatch.
- A request with a wrong or absent bearer token is rejected.
- A forced 429 is retried once and then surfaces `rate_limited`.
- It starts, serves an empty tool list over HTTP Streamable, and answers stdio.
