import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { ConfigError, loadConfig, type Config } from './config.js';
import { MonicaClient } from './monica.js';
import { makeBearerValidator, type Validator } from './auth.js';
import { runStartupChecks, StartupError, type StartupResult } from './startup.js';
import { registerTools } from './tools.js';

const NAME = 'monica-mcp';
const VERSION = '0.1.0';

interface Deps {
  config: Config;
  client: MonicaClient;
  startup: StartupResult;
}

/**
 * A fresh server per request. The transport is stateless (no session id), which
 * matches the design rule that this server holds no state — and keeps
 * concurrent callers (the drain and a bot) from sharing one connection.
 */
function buildMcpServer(deps: Deps): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerTools(server, { client: deps.client, activityTypes: deps.startup.activityTypes });
  // Still to come: 03 brief_contact, 04 find_overdue, 05 create_reminder.
  return server;
}

async function main(): Promise<void> {
  const useStdio = process.argv.includes('--stdio');

  let config: Config;
  try {
    config = loadConfig();
  } catch (cause) {
    fail(cause instanceof ConfigError ? cause.message : describe(cause));
  }

  const client = new MonicaClient(config.monicaBaseUrl, config.monicaApiToken);

  let startup: StartupResult;
  try {
    startup = await runStartupChecks(config, client);
  } catch (cause) {
    fail(cause instanceof StartupError ? cause.message : describe(cause));
  }

  const deps: Deps = { config, client, startup };

  // stderr, never stdout: stdout is the JSON-RPC channel in stdio mode.
  console.error(
    `${NAME} ${VERSION} | account ${startup.user.account.id} (${startup.user.email}) | ` +
      `${startup.activityTypes.length} activity types`,
  );

  if (useStdio) {
    const server = buildMcpServer(deps);
    await server.connect(new StdioServerTransport());
    console.error('listening on stdio');
    return;
  }

  await listenHttp(deps);
}

async function listenHttp(deps: Deps): Promise<void> {
  const validate = makeBearerValidator(deps.config.mcpBearerToken);

  const http = createHttpServer((req, res) => {
    void handle(req, res, deps, validate).catch((cause: unknown) => {
      console.error('unhandled request error:', describe(cause));
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(deps.config.port, () => {
      http.removeListener('error', reject);
      resolve();
    });
  }).catch((cause: unknown) => {
    const code = (cause as { code?: string } | null)?.code;
    if (code === 'EADDRINUSE') {
      fail(
        `Port ${deps.config.port} is already in use. Set MCP_PORT to a free port, ` +
          `or stop whatever is listening there.`,
      );
    }
    if (code === 'EACCES') {
      fail(`Not permitted to bind port ${deps.config.port}. Ports below 1024 need privileges.`);
    }
    fail(`Could not listen on port ${deps.config.port}: ${describe(cause)}`);
  });
  console.error(`listening on http://0.0.0.0:${deps.config.port}/mcp`);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: Deps,
  validate: Validator,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Unauthenticated, so a container healthcheck needs no credential. Reveals
  // only liveness.
  if (url.pathname === '/health') {
    send(res, 200, { status: 'ok', rate_limit: deps.client.rateLimit });
    return;
  }

  if (url.pathname !== '/mcp') {
    send(res, 404, { error: 'not found' });
    return;
  }

  if (!validate(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    send(res, 401, { error: 'unauthorized' });
    return;
  }

  const body = req.method === 'POST' ? await readJson(req) : undefined;

  const server = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

await main();
