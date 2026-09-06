# Work context

The v1 build, split into pickup-able units. Each file is self-contained enough
to start cold: what to build, why it is shaped that way, and how you know it is
done.

Read [../CONTEXT.md](../CONTEXT.md) first — it is the glossary, and the words in
these files are used precisely. Decisions with reasoning behind them are in
[../docs/adr/](../docs/adr/).

## Order

Numbered because it is a dependency order, not a preference. Each unit lists
what it blocks.

| # | Unit | Status |
| --- | --- | --- |
| 00 | [Shared machinery](./00-shared-machinery.md) | **done** |
| 01 | [Resolution and seed data](./01-resolution-and-seed-data.md) | **done** |
| 02 | [`log_interaction`](./02-log-interaction.md) | **done** |
| 03 | [`brief_contact`](./03-brief-contact.md) | **done** |
| 04 | [`find_overdue`](./04-find-overdue.md) | **done** |
| 05 | [`create_reminder`](./05-create-reminder.md) | not started |
| 06 | [Deployment and clients](./06-deployment-and-clients.md) | not started |

Update the status column when a unit lands. It is the only place that tracks
progress.

## Standing constraints

These hold across every unit and are not repeated in each one:

- **Stack**: TypeScript on `@modelcontextprotocol/sdk`.
- **Never guess a contact.** A wrong contact is invisible — the tool reports
  success and the record lands on the wrong person. Ambiguity is returned, not
  resolved.
- **Reference data belongs in the schema; only user data belongs behind a call.**
- **The server holds no state.** No cache, no database, no pending queue.
- **Fail loudly.** No silent queueing, no partial success reported as success.
- Development runs against a **separate Monica account**, guarded by
  `MONICA_EXPECTED_ACCOUNT`.
