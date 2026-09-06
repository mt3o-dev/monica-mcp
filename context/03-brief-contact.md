# 03 — `brief_contact`

**Blocks**: 06. **Depends on**: 00, 01.

*"what do I know about Bob?"* — the pre-meeting lookup. One call instead of the
model stitching four.

Read-only, so it cannot corrupt anything. That makes it the safest tool to
exercise against real data, and a reasonable first thing to actually use daily.

## Input

`contact` / `contact_id`, and `history` (default 5 interactions).

## Behaviour

Resolve, then assemble into prose-shaped structured data — **not** raw API
payloads:

- who they are: name, how you know them, key dates
- recent interactions: dates and summaries, most recent first
- relationships
- outstanding reminders and tasks
- cadence status, phrased usefully: "monthly, 12 days overdue"

**Cost**: ~6 requests — the contact is always refetched by id after resolution,
because `?query=` results report `stay_in_touch_frequency` as null whatever the
real value is, and a briefing that silently says "no cadence set" is worse than
one that costs an extra request.

## Done when

- A contact with no interactions returns a briefing, not an error.
- A contact with 200 interactions returns `history` of them and does not page
  through all 200.
- A relationship pointing at a deleted contact does not break the briefing.
- Cadence status is present, and absent cleanly when no cadence is set.
