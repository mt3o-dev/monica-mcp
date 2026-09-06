# Overdue is read from Monica's timestamps, not from a clock we maintain

We planned for `log_interaction` to reset each participant's stay-in-touch clock,
so that the cheap sweep in `find_overdue` would read a clock kept honest by our
own writes. That is not possible: `stay_in_touch_frequency` is absent from the
`UpdateContact` validation rules, and the only route that sets it —
`POST /people/{contact}/stayintouch` — lives in `web.php` behind session auth.
The API exposes stay-in-touch as read-only.

It turns out not to matter, because Monica already maintains what we wanted.
Creating an Activity sets `last_activity_together` on every participant, a Call
sets `last_called`, and both appear in the contact *list* response. Overdue is
therefore the more recent of those two compared against
`stay_in_touch_frequency` — computed on read, from data Monica keeps itself.

This is better than the design it replaces. There is no second write per
interaction, so no partial-failure state where the interaction lands and the
bookkeeping does not; no dependency on Monica's scheduler having been wired into
cron; and no clock of our own to drift. `find_overdue` stays at roughly five
requests for five hundred contacts.

The cost is that **Cadence can only be set in Monica's web UI**. We are content
with that: a cadence is a statement of intent about a relationship, which is
exactly the kind of thing a person should type themselves rather than have a
drain infer at three in the morning.
