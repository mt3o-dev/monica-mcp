/**
 * Monica API client. Owns rate limiting for the whole process, because it is
 * the only place that sees every call from every client.
 */

export class MonicaError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'MonicaError';
  }
}

export class RateLimitError extends MonicaError {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('Monica rate limit exhausted', 429);
    this.name = 'RateLimitError';
  }
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
}

export interface MonicaUser {
  id: number;
  email: string;
  name: string;
  account: { id: number };
}

export interface ActivityType {
  id: number;
  name: string;
}

/** Longest we will wait on a Retry-After before giving up and failing loudly. */
const MAX_RETRY_WAIT_SECONDS = 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class MonicaClient {
  readonly rateLimit: RateLimitState = { limit: null, remaining: null };

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * One request, with a single retry on 429.
   *
   * `Accept: application/json` is not optional: without it Laravel answers an
   * unauthenticated API call with a 302 to the login page instead of a 401,
   * which is indistinguishable from success to a naive client.
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const attempt = async (): Promise<Response> =>
      this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    let response = await attempt();
    this.recordRateLimit(response);

    if (response.status === 429) {
      const wait = this.retryAfterSeconds(response);
      if (wait === null || wait > MAX_RETRY_WAIT_SECONDS) throw new RateLimitError(wait);
      await sleep(wait * 1000);
      response = await attempt();
      this.recordRateLimit(response);
      if (response.status === 429) throw new RateLimitError(this.retryAfterSeconds(response));
    }

    if (!response.ok) {
      throw new MonicaError(
        `Monica ${method} ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
        await response.text().catch(() => undefined),
      );
    }

    return (await response.json()) as T;
  }

  private recordRateLimit(response: Response): void {
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (limit !== null) this.rateLimit.limit = Number(limit);
    if (remaining !== null) this.rateLimit.remaining = Number(remaining);
  }

  private retryAfterSeconds(response: Response): number | null {
    const header = response.headers.get('Retry-After');
    if (header === null) return null;
    const seconds = Number(header);
    return Number.isFinite(seconds) ? seconds : null;
  }

  async me(): Promise<MonicaUser> {
    const { data } = await this.request<{ data: MonicaUser }>('GET', '/api/me');
    return data;
  }

  async activityTypes(): Promise<ActivityType[]> {
    const { data } = await this.request<{ data: ActivityType[] }>('GET', '/api/activitytypes');
    return data;
  }
}
