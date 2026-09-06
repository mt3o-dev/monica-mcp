/** Configuration, read once at startup. Nothing here is re-read at runtime. */

export interface Config {
  monicaBaseUrl: string;
  monicaApiToken: string;
  mcpBearerToken: string;
  /** Account the token must belong to: an account id, or the user's email. */
  expectedAccount: string;
  port: number;
}

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `See .env.example.`,
    );
    this.name = 'ConfigError';
  }
}

const REQUIRED = [
  'MONICA_BASE_URL',
  'MONICA_API_TOKEN',
  'MCP_BEARER_TOKEN',
  'MONICA_EXPECTED_ACCOUNT',
] as const;

/**
 * Reads and validates configuration. Throws ConfigError naming *every* missing
 * variable rather than the first, so a misconfigured deploy is fixed in one pass.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length > 0) throw new ConfigError([...missing]);

  const port = Number(env['MCP_PORT'] ?? 8779);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MCP_PORT must be a port number, got: ${env['MCP_PORT']}`);
  }

  return {
    monicaBaseUrl: env['MONICA_BASE_URL']!.trim().replace(/\/+$/, ''),
    monicaApiToken: env['MONICA_API_TOKEN']!.trim(),
    mcpBearerToken: env['MCP_BEARER_TOKEN']!.trim(),
    expectedAccount: env['MONICA_EXPECTED_ACCOUNT']!.trim(),
    port,
  };
}
