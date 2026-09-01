# monica-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes [Monica CRM](https://www.monicahq.com/)
to MCP clients such as Claude Code, Claude Desktop, and other MCP-capable tools.

Monica is a personal CRM: contacts, the relationships between them, activities,
notes, reminders, gifts, and tasks. This server puts that data behind the MCP
protocol so an agent can read and update it directly.

> **Status:** early. The repository is being set up; nothing is implemented yet.

## Requirements

- Node.js 20+
- A Monica instance (hosted at monicahq.com, or self-hosted)
- A Monica API token — generate one under **Settings → API**

## Setup

```bash
npm install
npm run build
```

## Configuration

The server reads its credentials from the environment:

| Variable           | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `MONICA_BASE_URL`  | Base URL of your Monica instance, e.g. `https://app.monicahq.com` |
| `MONICA_API_TOKEN` | Personal API token from Monica's settings                          |

## Usage

Register the server with an MCP client. For Claude Code:

```bash
claude mcp add monica -- node /path/to/monica-mcp/dist/index.js
```

Or add it to your client's MCP configuration:

```json
{
  "mcpServers": {
    "monica": {
      "command": "node",
      "args": ["/path/to/monica-mcp/dist/index.js"],
      "env": {
        "MONICA_BASE_URL": "https://app.monicahq.com",
        "MONICA_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

## License

MIT
