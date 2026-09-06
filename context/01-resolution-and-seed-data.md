# 01 — Resolution and seed data

**Blocks**: 02, 03, 05. **Depends on**: 00.

The single most important behaviour in the server. Build it standalone and test
it hard before any tool uses it.

## Build

### Tiers, in order — never a similarity score

1. Exact full-name match, case-insensitive, across name fields **and
   `nickname`**.
2. Unique match on first name, or a unique substring hit across name fields and
   `nickname`.
3. More than one survivor in the winning tier → **ambiguous**. Stop.

Thresholds were rejected deliberately: you cannot justify 0.8 over 0.75, and you
tune it forever. A tie no tier breaks is the definition of doubt.

### Rules

- **Recency is never a tiebreaker.** It is offered as a *hint* in the ambiguous
  result — "last spoken to 2023" helps a human choose — but deciding by it would
  silently favour frequently-contacted people, whose records you are least
  likely to audit.
- **Zero matches never creates a contact.** Return `not_found` with near-misses.
- `nickname` is searched at tiers 1 and 2. This is what makes "Mike" resolve to
  Michael without a round-trip, once the alias has been written back.

### The ambiguity contract

```
{ status: "ambiguous",
  query: "grimlock",
  candidates: [ { id, name, hint: "last interaction 2026-03-14" }, ... ] }
```

The caller asks the human and calls again with `contact_id`. **The server holds
no pending state.** Every tool accepts either `contact` (name) or `contact_id`
(exact), and re-calls carry their full payload.

## Alias write-back

Resolution's feedback loop: every ambiguity resolved once should be one you never
see again. Monica is the shared brain, so a confirmed alias goes there — not into
local state this server does not have.

The server is stateless, so it cannot know that a disambiguation just happened.
The caller carries that instead:

- Tools accept **both** `contact_id` and the original `contact` string. When both
  are present and the string matches neither the contact's names nor its
  `nickname`, the result carries an `alias_suggestion`.
- The suggestion **rides along with success** — it never gates the write. The log
  succeeds; the question is a passenger on the result.
- The caller passes `remember_alias: true` on a later call to apply it. **Never
  written without an explicit yes**, even though it is reversible in Monica's UI.
- Only written when `nickname` is **empty**. If a nickname is already set, do not
  offer to overwrite it — that is something the user typed by hand.

`nickname` is single-valued, so it holds one alias. Mike/Mikey/Mick for the same
contact is a known limitation, accepted for v1: the alternative was local state,
which was rejected twice.

## Seed data

A fantasy cast in the dev account — unicorns, D&D trolls — so test data can never
be mistaken for a real person, in the database or in a bug report. It exists to
exercise resolution:

| Fixture | Exercises |
| --- | --- |
| Two trolls both called Grimlock | tier 3, the ambiguity contract |
| "Sparklehoof", nickname "Sparky" | tier 1 must read `nickname` |
| Grim / Grimlock / Grimlockson | tier 2 must not silently pick the shortest |
| Cadence set, zero interactions | `find_overdue` edge |
| Cadence unset | must be **excluded** from `find_overdue` |
| A contact with 200 interactions | `brief_contact` pagination |
| A contact with an empty `nickname` | alias write-back offers |
| A contact with `nickname` already set | alias write-back stays silent |

Re-running the seed converges to these fixtures, so it clears any nickname that
exercising the alias write-back wrote. Expected: the fixtures define what the
dev account looks like.

## Done when

- Each fixture above resolves to the documented outcome, as a test.
- An alias in `nickname` resolves at tier 1.
- Ambiguity returns candidates with hints, and writes nothing anywhere.
