# 04 — `find_overdue`

**Blocks**: 06. **Depends on**: 00.

*"who haven't I spoken to in a while?"* — what a personal CRM is actually for,
and the thing a thin endpoint wrapper cannot do at an acceptable request count.

## Input

`limit` (default 10), `include_never_contacted` (default true).

## Behaviour

1. Page `/api/contacts?limit=100` and filter client-side. Monica has no
   server-side overdue filter — this was checked, it does not exist.
2. Keep contacts where `stay_in_touch_frequency` is set **and**
   `stay_in_touch_trigger_date` is in the past.
   **Contacts with no Cadence are excluded** — an unset cadence means the user
   never expressed an intention, and including them returns the entire address
   book sorted by neglect.
3. Sort by days overdue, descending. Return name, id, cadence, days overdue.
   Deliberately compact — not full contact objects.

**Cost**: ~5 requests for 500 contacts. Cheap *because* 02 resets the clock on
write, so the trigger date is the true clock rather than stale bookkeeping.

## Note

Monica's own reminder emails need `php artisan schedule:run` in cron. This tool
does **not** depend on it — `stay_in_touch_trigger_date` is recomputed at request
time — but it is worth confirming the cron exists if email nags are expected.

## Done when

- Cadence-set-never-contacted appears, and sorts as most overdue.
- Cadence-unset never appears, regardless of how long it has been.
- Pagination past the first page works.
- `limit` truncates after sorting, not before.
