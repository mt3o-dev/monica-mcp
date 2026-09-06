# 04 — `find_overdue`

**Blocks**: 06. **Depends on**: 00.

*"who haven't I spoken to in a while?"* — what a personal CRM is actually for,
and the thing a thin endpoint wrapper cannot do at an acceptable request count.

## Input

`limit` (default 10), `include_never_contacted` (default true).

## Behaviour

1. Page `/api/contacts?limit=100` and filter client-side. Monica has no
   server-side overdue filter — this was checked, it does not exist.
2. Keep contacts where `stay_in_touch_frequency` is set **and** the more recent
   of `last_activity_together` / `last_called` is older than that many days.
   Both timestamps are maintained by Monica and present in the list response,
   so no per-contact fetch is needed
   ([ADR 0005](../docs/adr/0005-overdue-reads-monicas-own-timestamps.md)).
   **Contacts with no Cadence are excluded** — an unset cadence means the user
   never expressed an intention, and including them returns the entire address
   book sorted by neglect.
3. Sort by days overdue, descending. Return name, id, cadence, days overdue.
   Deliberately compact — not full contact objects.

**Cost**: ~5 requests for 500 contacts, and no writes at all.

## Note

**Cadence can only be set in Monica's web UI** — the API exposes
`stay_in_touch_frequency` read-only. This tool reads intentions the user has
already expressed; it cannot create them.

Monica's own reminder emails need `php artisan schedule:run` in cron. This tool
does not depend on it.

## Done when

- Cadence-set-never-contacted appears, and sorts as most overdue.
- Cadence-unset never appears, regardless of how long it has been.
- Pagination past the first page works.
- `limit` truncates after sorting, not before.
