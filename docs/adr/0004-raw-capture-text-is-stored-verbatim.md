# The raw capture text is stored verbatim in Monica

An Interaction written by the scheduled drain has passed through speech
recognition and then through a model that summarised it. Neither step reports
its own failures: a mangled transcript and a confidently wrong summary both
arrive as ordinary, plausible records. The model's summary goes in Monica's
`summary` field, and the original text goes in `description` unedited, so every
record carries the source it was derived from.

The alternative was keeping raw text only in the vault and storing a link back
to it. That keeps the CRM tidier — transcription noise is genuinely ugly, and
Monica's UI will show it — but it makes the audit trail depend on two systems
staying in sync, and the record becomes unreadable the moment they drift.

We are optimising for being able to answer "where did this come from?" in a year,
against data the user intends to trust more than their notes. That is worth an
untidy field.
