import type { MonicaClient, ActivityType } from './monica.js';
import { resolveContact, aliasSuggestion, toCandidate } from './resolution.js';
import { getContact, setNickname, type Contact } from './contacts.js';
import { ok, ambiguous, notFound, failed, type ToolResult } from './results.js';

export interface LogInteractionInput {
  contacts?: string[] | undefined;
  contact_ids?: number[] | undefined;
  /**
   * The name the human originally typed, when re-calling with contact_ids after
   * a disambiguation. Used only to offer the alias write-back — it never
   * resolves anyone, so it cannot double-add a participant.
   */
  resolved_from?: string | undefined;
  summary: string;
  raw_text?: string | undefined;
  activity_type?: string | undefined;
  happened_at?: string | undefined;
  medium?: 'phone' | 'in_person' | 'message' | undefined;
  capture_id?: string | undefined;
  remember_alias?: boolean | undefined;
}

export interface LogInteractionOk {
  shape: 'activity' | 'call';
  record_id: number;
  participants: { id: number; name: string }[];
  activity_type?: string;
  /** Set when a prior record carries the same capture_id — nothing was written. */
  already_logged?: boolean;
  /** Rides along with success; never gates it. Apply with remember_alias. */
  alias_suggestion?: { contact_id: number; alias: string; note: string };
  alias_remembered?: string;
}

/** How many recent records to scan when checking a capture_id for a repeat. */
const DUPLICATE_SCAN = 25;

const captureMarker = (id: string): string => `[capture:${id}]`;

/**
 * The tool this project exists for. One call: the contact is resolved here, the
 * storage shape is chosen here, and the activity type came down in the schema —
 * so nothing in this flow is a lookup the caller had to make first.
 *
 * There is no stay-in-touch reset: Monica maintains last_activity_together and
 * last_called itself (ADR 0005).
 */
export async function logInteraction(
  client: MonicaClient,
  activityTypes: ActivityType[],
  input: LogInteractionInput,
): Promise<ToolResult<LogInteractionOk>> {
  const participants: Contact[] = [];

  for (const id of input.contact_ids ?? []) {
    participants.push(await getContact(client, id));
  }

  for (const name of input.contacts ?? []) {
    const resolution = await resolveContact(client, name);
    if (resolution.kind === 'ambiguous') {
      // Any ambiguity aborts the whole write. Partial success is not a thing
      // here: half-logged participants are worse than none.
      return ambiguous(name, resolution.candidates.map(toCandidate));
    }
    if (resolution.kind === 'not_found') {
      return notFound(name, resolution.nearMisses.map(toCandidate));
    }
    participants.push(resolution.contact);
  }

  if (participants.length === 0) {
    return failed('No contact given. Pass contacts (names) or contact_ids.');
  }

  const happenedAt = (input.happened_at ?? new Date().toISOString()).slice(0, 10);
  const shape: 'activity' | 'call' =
    input.medium === 'phone' && participants.length === 1 ? 'call' : 'activity';

  if (input.capture_id !== undefined) {
    const existing = await findByCaptureId(client, participants[0]!.id, shape, input.capture_id);
    if (existing !== null) {
      return ok<LogInteractionOk>({
        shape,
        record_id: existing,
        participants: participants.map(named),
        already_logged: true,
      });
    }
  }

  const body = buildBody(input, participants, shape, happenedAt, activityTypes);
  if (typeof body === 'string') return failed(body);

  const { data } = await client.request<{ data: { id: number } }>(
    'POST',
    shape === 'call' ? '/api/calls' : '/api/activities',
    body.payload,
  );

  const result: LogInteractionOk = {
    shape,
    record_id: data.id,
    participants: participants.map(named),
    ...(body.activityTypeName === undefined ? {} : { activity_type: body.activityTypeName }),
  };

  await applyAlias(client, input, participants, result);
  return ok(result);
}

function buildBody(
  input: LogInteractionInput,
  participants: Contact[],
  shape: 'activity' | 'call',
  happenedAt: string,
  activityTypes: ActivityType[],
): { payload: Record<string, unknown>; activityTypeName?: string } | string {
  const marker = input.capture_id === undefined ? '' : `\n\n${captureMarker(input.capture_id)}`;

  if (shape === 'call') {
    // A Call has no summary field, so both halves live in `content`. The raw
    // capture is still present verbatim (ADR 0004); the summary precedes it.
    const parts = [input.summary, input.raw_text].filter(
      (p): p is string => typeof p === 'string' && p.trim() !== '',
    );
    return {
      payload: {
        contact_id: participants[0]!.id,
        called_at: happenedAt,
        content: [...new Set(parts)].join('\n\n') + marker,
      },
    };
  }

  const type =
    input.activity_type === undefined
      ? defaultType(activityTypes)
      : activityTypes.find((t) => t.name.toLowerCase() === input.activity_type!.toLowerCase());
  if (type === undefined) {
    return `Unknown activity_type "${input.activity_type}". Valid: ${activityTypes
      .map((t) => t.name)
      .join(', ')}`;
  }

  return {
    payload: {
      activity_type_id: type.id,
      summary: input.summary,
      description: (input.raw_text ?? input.summary) + marker,
      happened_at: happenedAt,
      contacts: participants.map((c) => c.id),
    },
    activityTypeName: type.name,
  };
}

/**
 * Monica returns activity types unordered, so falling back to the first one
 * logs coffee as "played a sport together". Prefer the generic type when the
 * caller did not name one; the result always reports what was used.
 */
function defaultType(activityTypes: ActivityType[]): ActivityType | undefined {
  const generic = ['just hung out', 'just talked at home'];
  for (const name of generic) {
    const match = activityTypes.find((t) => t.name.toLowerCase() === name);
    if (match !== undefined) return match;
  }
  return activityTypes[0];
}

/**
 * Retry safety without server state: the capture id is written into the record
 * and looked for on the way in. Bounded to the most recent records, which
 * covers the case that actually happens — a drain retrying a batch — and not a
 * capture resubmitted months later.
 */
async function findByCaptureId(
  client: MonicaClient,
  contactId: number,
  shape: 'activity' | 'call',
  captureId: string,
): Promise<number | null> {
  const path =
    shape === 'call'
      ? `/api/contacts/${contactId}/calls?limit=${DUPLICATE_SCAN}`
      : `/api/contacts/${contactId}/activities?limit=${DUPLICATE_SCAN}`;
  const { data } = await client.request<{
    data: { id: number; description?: string | null; content?: string | null }[];
  }>('GET', path);

  const marker = captureMarker(captureId);
  const hit = data.find((r) => (r.description ?? r.content ?? '').includes(marker));
  return hit?.id ?? null;
}

async function applyAlias(
  client: MonicaClient,
  input: LogInteractionInput,
  participants: Contact[],
  result: LogInteractionOk,
): Promise<void> {
  // Only meaningful for a single subject: with several participants there is no
  // one name the alias would belong to.
  const subject = participants.length === 1 ? participants[0] : undefined;
  if (subject === undefined) return;

  // Either the caller re-called after a disambiguation (resolved_from), or a
  // single typed name resolved to this contact by something other than an exact
  // match. Both mean "the user calls them something Monica does not know".
  const query =
    input.resolved_from ?? (input.contacts?.length === 1 ? input.contacts[0] : undefined);
  if (query === undefined) return;

  const alias = aliasSuggestion(query, subject);
  if (alias === null) return;

  if (input.remember_alias === true) {
    await setNickname(client, subject, alias);
    result.alias_remembered = alias;
    return;
  }

  result.alias_suggestion = {
    contact_id: subject.id,
    alias,
    note: `${subject.complete_name} has no nickname. Call again with remember_alias to save "${alias}", so it resolves without asking next time.`,
  };
}

const named = (c: Contact): { id: number; name: string } => ({ id: c.id, name: c.complete_name });
