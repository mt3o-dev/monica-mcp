# The server chooses which Monica resource an Interaction is stored in

Monica stores "I talked to someone" in three different resources — `Activity`
(multi-contact, requires an activity type), `Call` (single contact), and
`Conversation` (single contact, medium-specific, with child Messages). Callers of
this server name a single concept, an Interaction, and the server selects the
storage shape: multiple contacts implies Activity, a phone exchange implies Call,
and Conversation is used only when per-message authorship genuinely matters.

We rejected exposing the shape as an explicit parameter. It is the more honest
API and it is what every other Monica MCP server does, but it forces the caller
to learn Monica's storage model in order to record a sentence about their day —
which is the entire friction this project exists to remove.

The cost is that this is expensive to reverse. Once history is spread across
three resources by an implicit rule, changing the rule does not migrate the data
already written, and a reader who sees `log_interaction` produce a `Call` row
will have no way to know why without this note. We accept that in exchange for
the one-call write.
