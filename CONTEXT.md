# monica-mcp

An MCP server over Monica CRM. It exposes the personal-CRM domain as the tasks a
person actually performs, not as a mirror of Monica's REST endpoints.

## Language

**Interaction**:
A recorded exchange with one or more contacts at a point in time.
_Avoid_: conversation, activity, call, log entry

Monica stores interactions in three different resources (`Activity`, `Call`,
`Conversation`). Those are storage shapes, chosen by the server. They are not
vocabulary the caller uses, and "conversation" in particular means something
narrower in Monica than it does here.

**Alias**:
A name the user calls a contact by, which is not the name stored on that contact.
_Avoid_: nickname, synonym, shortname

"Nickname" is Monica's single-valued field and holds at most one alias. A contact
may have many aliases.

**Resolution**:
Turning a name the user typed into exactly one contact.
_Avoid_: lookup, matching, search

Resolution either succeeds outright or is ambiguous. Ambiguity is a tie no tier
breaks — never a confidence score.
