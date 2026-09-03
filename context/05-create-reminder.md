# 05 — `create_reminder`

**Blocks**: 06. **Depends on**: 00, 01.

*"remind me to ask Bob how Berlin went in April"* — a fourth tool, and it earns
its place because you would say that sentence whether or not the drain existed.
Not because the drain needs it. That distinction is the whole discipline: a tool
exists only if you can name the sentence that triggers it.

## Input

`contact` / `contact_id`, `title`, `initial_date` (ISO), `frequency`
(`one_time` | `week` | `month` | `year`, default `one_time`), `frequency_number`
(default 1), `description` (optional).

## Behaviour

Resolve, then `POST /api/reminders`.

**The server does no date parsing.** "April" → an ISO date is language work, and
the model already holds the context needed to do it. A server-side date parser
would be a second, worse interpreter of the same sentence.

**Cost**: 1 resolve + 1 write.

## Done when

- A one-off reminder lands with the right date.
- A recurring reminder lands with the right frequency.
- A date in the past is rejected clearly rather than silently accepted.
- A reminder created against an alias-resolved contact attaches to the right one.
