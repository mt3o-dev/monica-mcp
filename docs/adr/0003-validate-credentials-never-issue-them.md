# The server validates credentials and never issues them

Connecting a claude.ai account requires the server to be a full OAuth 2.1
authorization server: discovery documents, dynamic client registration, PKCE,
authorization-code and refresh-token grants, and refresh rotation. We are not
building that. Claude's advanced connector settings accept a pre-registered
client ID and secret, so an external identity provider can be the authorization
server and this server's entire responsibility is to validate a presented
credential and reject anything else.

Hand-rolling an authorization server would have made a public endpoint guarding
the user's relationship history depend on security-critical code written for
this project alone, and it would have been larger than the CRM adapter it
protects.

Practically this means auth is one function, not a feature threaded through the
server: v1 validates a static bearer token on an unpublished `internal`-only
endpoint, and v2 swaps that function for JWT validation against an identity
provider when the claude.ai connector is wired up. No other part of the server
knows which is in use, and nothing outside that function reads anything out of
the credential.
