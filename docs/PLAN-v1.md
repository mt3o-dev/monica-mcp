# v1 plan

Scope: four tools, all four designed to the same depth before any of them is
built. The domain language is in [../CONTEXT.md](../CONTEXT.md); the decisions
behind this shape are in [adr/](./adr/).

## Shared machinery

Everything below is used by more than one tool, so it is specified once and
built first. Roughly two thirds of v1 is here rather than in the tools.

### Startup

The server refuses to run half-configured. On boot, in order:

1. Read `MONICA_BASE_URL`, `MONICA_API_TOKEN`, `MCP_BEARER_TOKEN`,
   `MONICA_EXPECTED_ACCOUNT`. Any missing → exit non-zero with the name of the
   missing variable.
2. `GET /api/me`. Unreachable, 401, or an account that is not
   `MONICA_EXPECTED_ACCOUNT` → exit non-zero. This is what stops a
   misconfigured token writing test data into the real account.
3. `GET /api/activitytypes`. The result becomes an enum in the
   `log_interaction` schema, so the model picks a valid type in the call it was
   already making. Failure here → exit non-zero.

Consequence: activity types added in Monica's UI need a restart to appear. That
is data which changes yearly, and it is not worth a cache-invalidation story.

### Authentication

One function: `validate(credential) -> ok | reject`. Nothing else in the server
reads anything out of the credential. v1 compares against `MCP_BEARER_TOKEN`;
v2 swaps the body for JWT validation without touching a caller. See
[ADR 0003](./adr/0003-validate-credentials-never-issue-them.md).

### Resolution

Turning a name the user typed into exactly one contact. Used by three of the
four tools, and the single most important piece of behaviour in the server.

Tiers, checked in order — never a similarity score:

1. Exact full-name match, case-insensitive, across name fields **and
   `nickname`**.
2. Unique match on first name, or a unique substring hit across name fields and
   `nickname`.
3. More than one survivor in the winning tier → **ambiguous**. Stop.

Rules:

- Recency is never a tiebreaker. It is offered as a *hint* in the ambiguous
  result, because "last spoken to in 2023" helps a human choose, but letting it
  decide would silently favour frequently-contacted people — exactly the
  contacts whose records you would notice were wrong.
- Zero matches is **not** an invitation to create a contact. It returns
  `not_found` with near-misses.
- Resolution never guesses. A wrong contact is invisible: the tool reports
  success and the note lands on someone else's record.

### The ambiguity contract

Every tool taking a contact name shares one result shape, so clients handle it
in one place:

```
{ status: "ambiguous",
  query: "bob",
  candidates: [ { id, name, hint: "last interaction 2026-03-14" }, ... ] }
```

The caller — `capture-bot` with an inline keyboard, or `assistant-bot` in
conversation — asks the human and calls again with `contact_id` instead of a
name. **The server holds no pending state.** Every tool therefore accepts
either `contact` (a name) or `contact_id` (exact), and re-calls carry their full
payload.

### Throttling

Monica allows 60 requests/minute by default (a `throttle:60,1` middleware, so
raisable on the hosted instance). The server owns this entirely — it is the
only component that sees every call from every client.

- Track `X-RateLimit-Remaining` from every response.
- On 429, respect `Retry-After`, retry once, then fail.
- When exhausted, **fail loudly — never queue.** A tool that silently defers
  writes cannot be reasoned about, and the vault still holds the unprocessed
  capture, so a failed drain loses nothing.
- `log_interaction` accepts an optional `capture_id` (the vault filename or its
  hash), recorded on the Monica record, so a retried batch does not double-write
  interactions that already landed.

### Result shape

Every tool returns `status` — one of `ok`, `ambiguous`, `not_found`,
`rate_limited`, `error` — and never throws a bare API error at the model.
Successful writes return the Monica record id, so the caller can log what it
did and a human can find it later.

---

## `log_interaction`

*"log that I had coffee with Mike"* — the tool the project exists for. One call,
no lookups.

**Input**: `contact` or `contact_id` (accepts several — an interaction may have
multiple participants), `summary` (required; the model writes it, having been
in the conversation), `raw_text` (the untouched capture or transcript),
`activity_type` (enum from startup), `happened_at` (ISO date, defaults to now),
`medium` (optional: `phone`, `in_person`, `message`), `capture_id` (optional),
`follow_up` (optional — delegates to `create_reminder` below).

**Behaviour**:

1. Resolve every contact. Any ambiguity → return `ambiguous` and write nothing.
   Partial success is not a thing here.
2. Choose the storage shape ([ADR 0001](./adr/0001-server-chooses-interaction-shape.md)):
   more than one contact → Activity; `medium: phone` → Call; per-message
   authorship genuinely matters → Conversation. The caller never names a Monica
   resource.
3. Write, with `summary` in Monica's summary field and `raw_text` verbatim in
   `description` ([ADR 0004](./adr/0004-raw-capture-text-is-stored-verbatim.md)).
4. Reset each participant's stay-in-touch clock (`PUT /api/contacts/:id`).
   **Best-effort**: never fail the log because the bookkeeping write failed. The
   interaction is the data; the clock is derived.

**Cost**: 1 resolve (cached within the call) + 1 write + 1 clock reset per
participant. ~3 requests for a single-contact log.

**Failure modes to test**: ambiguous participant among several; clock reset
fails after a successful write; `activity_type` absent for a Call-shaped log;
the same `capture_id` submitted twice.

---

## `find_overdue`

*"who haven't I spoken to in a while?"* — the thing a personal CRM is for, and
the thing a thin endpoint wrapper cannot do at an acceptable request count.

**Input**: `limit` (default 10), `include_never_contacted` (default true).

**Behaviour**:

1. Page `/api/contacts?limit=100` and filter client-side — Monica has no
   server-side overdue filter.
2. Keep contacts where `stay_in_touch_frequency` is set **and**
   `stay_in_touch_trigger_date` is in the past. **Contacts with no Cadence are
   excluded**: an unset cadence means the user never expressed an intention, and
   including them would return the entire address book sorted by neglect.
3. Sort by days overdue, descending. Return name, contact id, cadence, days
   overdue — deliberately compact, not full contact objects.

**Cost**: ~5 requests for 500 contacts. Cheap because we reset the clock on
write, so Monica's trigger date is the true clock rather than bookkeeping that
has drifted.

**Failure modes to test**: a contact whose cadence was set but who has never
been contacted; pagination past the first page; an instance where the scheduler
has never run.

---

## `brief_contact`

*"what do I know about Bob?"* — the pre-meeting lookup. One call instead of the
model stitching four.

**Input**: `contact` or `contact_id`, `history` (default 5 interactions).

**Behaviour**: resolve, then assemble — who they are (name, how you know them,
key dates), recent interactions with dates and summaries, relationships,
outstanding reminders and tasks, and cadence status ("monthly, 12 days
overdue"). Returns prose-shaped structured data, not raw API payloads.

**Cost**: ~4–5 requests. Read-only, so it cannot corrupt anything — which makes
it the safest tool to exercise against real data.

**Failure modes to test**: a contact with no interactions at all; a contact with
hundreds (pagination and truncation); relationships pointing at deleted
contacts.

---

## `create_reminder`

*"remind me to ask Bob how Berlin went in April"* — earns its place because you
would say that sentence whether or not a drain existed, not because the drain
needs it.

**Input**: `contact` or `contact_id`, `title`, `initial_date` (ISO),
`frequency` (`one_time` | `week` | `month` | `year`, default `one_time`),
`frequency_number` (default 1), `description` (optional).

**Behaviour**: resolve, then `POST /api/reminders`. **The server does no date
parsing.** "April" → an ISO date is language work, and the model is already
holding the context needed to do it; a server-side date parser would be a second,
worse interpreter of the same sentence.

**Cost**: 1 resolve + 1 write.

**Failure modes to test**: a date in the past; a recurring reminder with
`frequency_number` 0; reminder created against a contact resolved from an alias.

---

## Seed data

A fantasy cast in the dev account — unicorns, D&D trolls — so test data can
never be mistaken for a real person, in the database or in a bug report.

It must exercise resolution, which is the point of seeding at all:

- **Two exact first-name collisions** (two trolls both called Grimlock) → forces
  tier 3, ambiguity, the inline keyboard.
- **A nickname that differs from the name** ("Sparklehoof", nickname "Sparky")
  → tier 1 must hit `nickname`.
- **A substring trap** (Grim, Grimlock, Grimlockson) → tier 2 must not silently
  pick the shortest.
- **A contact with cadence set and no interactions** → `find_overdue` edge.
- **A contact with cadence unset** → must be excluded from `find_overdue`.
- **A contact with 200 interactions** → `brief_contact` pagination.

## Build order

The tools are equally specified; they need not be built simultaneously.

1. Shared machinery: startup, auth, throttle, result shape.
2. Resolution + seed data. Testable on its own, and everything else depends on it.
3. `log_interaction`.
4. `brief_contact` (read-only, safe against real data).
5. `find_overdue`, `create_reminder`.
6. Deployment on the `internal` network, then the `second-brain vault` changes: `capture-bot`'s
   inline keyboard, and `ALLOWED_TOOLS` in the bot's shared config.

## Out of scope for v1

Public route and the claude.ai connector (needs the identity provider from
ADR 0003); any cache; contact creation; anything in Monica without a sentence
attached to it — gifts, debts, documents, journal.
