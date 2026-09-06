import type { Config } from './config.js';
import { MonicaClient, type ActivityType, type MonicaUser } from './monica.js';

export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupError';
  }
}

export interface StartupResult {
  user: MonicaUser;
  activityTypes: ActivityType[];
}

/**
 * The server refuses to run half-configured. Reaching Monica is a startup
 * dependency, not a runtime one: activity types become an enum in the
 * log_interaction schema, so the model picks a valid type in the call it was
 * already making rather than in a lookup round-trip.
 */
export async function runStartupChecks(
  config: Config,
  client: MonicaClient,
): Promise<StartupResult> {
  const user = await identify(config, client);

  const activityTypes = await client.activityTypes().catch((cause: unknown) => {
    throw new StartupError(
      `Could not read activity types from Monica: ${describe(cause)}. ` +
        `They are compiled into the tool schema, so the server cannot start without them.`,
    );
  });

  if (activityTypes.length === 0) {
    throw new StartupError(
      'Monica returned no activity types. log_interaction needs at least one to offer.',
    );
  }

  return { user, activityTypes };
}

async function identify(config: Config, client: MonicaClient): Promise<MonicaUser> {
  const user = await client.me().catch((cause: unknown) => {
    throw new StartupError(
      `Could not reach Monica at ${config.monicaBaseUrl} with the supplied token: ${describe(cause)}`,
    );
  });

  if (!accountMatches(config.expectedAccount, user)) {
    throw new StartupError(
      `Token belongs to account ${user.account.id} (${user.email}), but ` +
        `MONICA_EXPECTED_ACCOUNT is "${config.expectedAccount}". Refusing to start: ` +
        `this guard exists so a mistyped token cannot write into the wrong account.`,
    );
  }

  return user;
}

/**
 * An all-digits value is compared against the account id; anything else is
 * compared against the user's email. Prefer the email — a bare id silently
 * matches whatever happens to be first on any given instance.
 */
function accountMatches(expected: string, user: MonicaUser): boolean {
  if (/^\d+$/.test(expected)) return Number(expected) === user.account.id;
  return expected.toLowerCase() === user.email.toLowerCase();
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
