# The server is a long-lived HTTP service, not a stdio subprocess

The obvious deployment for an MCP server used by a CLI is stdio: the client
spawns it, talks over pipes, and it dies with the process. We are not doing
that, because n8n runs the scheduled drain of captured notes, that drain needs
an LLM to turn free text into an Interaction, and n8n's MCP client can only
reach a server over HTTP — stdio would mean shipping this code into the n8n
container image. The transport is HTTP Streamable specifically: SSE is
deprecated in n8n and unsupported by Claude's connector infrastructure.

We keep a stdio mode as well, because it costs almost nothing and it is how the
server is developed and debugged locally. It is not how it is deployed.

Two consequences follow. The server is reachable by every container on the
`internal` network, including CI runners, so it must authenticate callers rather
than trust the network — see ADR 0003. And because the process is now
long-lived, an in-process cache would work; we deliberately do not have one. The
Monica instance is remote rather than a neighbour on the `internal` network, so lookups are
public round-trips and a cache would genuinely save something — but it is an
optimisation we have not measured, and every earlier attempt to specify one
grew a staleness problem larger than the latency it removed.
