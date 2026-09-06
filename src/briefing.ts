import type { MonicaClient } from './monica.js';
import { resolveContactRef, toCandidate } from './resolution.js';
import { getContact, lastInteractionAt, type Contact } from './contacts.js';
import { ok, ambiguous, notFound, failed, type ToolResult } from './results.js';

export interface BriefContactInput {
  contact?: string | undefined;
  contact_id?: number | undefined;
  history?: number | undefined;
}

export interface Interaction {
  kind: 'activity' | 'call';
  date: string;
  summary: string;
}

export interface BriefContactOk {
  contact: { id: number; name: string; nickname: string | null };
  cadence: string;
  interactions: Interaction[];
  interactions_total: number;
  relationships: { relation: string; name: string }[];
  reminders: { title: string; next: string | null }[];
  tasks: { title: string; completed: boolean }[];
  how_you_met?: string;
}

/** Detail fields present on a single-contact GET but not in the list response. */
interface ContactDetail extends Contact {
  information?: {
    relationships?: Record<string, { total?: number; contacts?: RelationshipEntry[] }>;
    how_you_met?: { general_information?: string | null } | null;
  };
}

interface RelationshipEntry {
  relationship?: { name?: string } | null;
  contact?: { complete_name?: string; first_name?: string } | null;
}

const DEFAULT_HISTORY = 5;
const LIST_CAP = 25;

/**
 * The pre-meeting lookup: one call instead of the model stitching four.
 * Read-only, so it cannot corrupt anything.
 */
export async function briefContact(
  client: MonicaClient,
  input: BriefContactInput,
): Promise<ToolResult<BriefContactOk>> {
  const resolution = await resolveContactRef(client, input);
  if (resolution.kind === 'ambiguous') {
    return ambiguous(input.contact ?? '', resolution.candidates.map(toCandidate));
  }
  if (resolution.kind === 'not_found') {
    if (input.contact === undefined && input.contact_id === undefined) {
      return failed('No contact given. Pass contact (a name) or contact_id.');
    }
    return notFound(input.contact ?? String(input.contact_id), resolution.nearMisses.map(toCandidate));
  }

  // Always refetch by id. A contact resolved from `?query=` carries a null
  // stay_in_touch_frequency regardless of the real value, which would silently
  // brief every contact as having no cadence. This also gets the relationship
  // and how-you-met detail, which the list responses omit entirely.
  const contact = (await getContact(client, resolution.contact.id)) as ContactDetail;
  const history = clamp(input.history ?? DEFAULT_HISTORY, 1, LIST_CAP);

  const [activities, calls, reminders, tasks] = await Promise.all([
    list<{ id: number; summary: string | null; happened_at: string }>(
      client, `/api/contacts/${contact.id}/activities?limit=${history}`),
    list<{ id: number; content: string | null; called_at: string }>(
      client, `/api/contacts/${contact.id}/calls?limit=${history}`),
    list<{ title: string | null; next_expected_date: string | null }>(
      client, `/api/contacts/${contact.id}/reminders?limit=10`),
    list<{ title: string | null; completed: boolean }>(
      client, `/api/contacts/${contact.id}/tasks?limit=10`),
  ]);

  const interactions: Interaction[] = [
    ...activities.data.map((a) => ({
      kind: 'activity' as const,
      date: (a.happened_at ?? '').slice(0, 10),
      summary: a.summary ?? '(no summary)',
    })),
    ...calls.data.map((c) => ({
      kind: 'call' as const,
      date: (c.called_at ?? '').slice(0, 10),
      summary: firstLine(c.content) ?? '(no content)',
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, history);

  return ok<BriefContactOk>({
    contact: { id: contact.id, name: contact.complete_name, nickname: contact.nickname },
    cadence: describeCadence(contact),
    interactions,
    interactions_total: (activities.total ?? 0) + (calls.total ?? 0),
    relationships: readRelationships(contact),
    reminders: reminders.data.map((r) => ({
      title: r.title ?? '(untitled)',
      next: r.next_expected_date?.slice(0, 10) ?? null,
    })),
    tasks: tasks.data
      .filter((t) => t.completed !== true)
      .map((t) => ({ title: t.title ?? '(untitled)', completed: t.completed === true })),
    ...howYouMet(contact),
  });
}

/**
 * Phrased for a human reading it seconds before a conversation — "every 30 days,
 * 370 days overdue" rather than a pair of raw timestamps.
 */
function describeCadence(contact: Contact): string {
  const frequency = contact.stay_in_touch_frequency;
  const last = lastInteractionAt(contact);
  const sinceLast = last === null ? null : daysBetween(last, new Date());

  if (frequency === null || frequency === 0) {
    return last === null
      ? 'no cadence set; nothing logged yet'
      : `no cadence set; last interaction ${sinceLast} days ago`;
  }
  if (last === null) return `every ${frequency} days; nothing logged yet`;

  const overdueBy = sinceLast! - frequency;
  return overdueBy > 0
    ? `every ${frequency} days; last interaction ${sinceLast} days ago (${overdueBy} days overdue)`
    : `every ${frequency} days; last interaction ${sinceLast} days ago (due in ${-overdueBy} days)`;
}

/**
 * Relationship entries can point at contacts that no longer exist, so every
 * field here is treated as optional. A broken relationship must not cost the
 * whole briefing.
 */
function readRelationships(contact: ContactDetail): { relation: string; name: string }[] {
  const groups = contact.information?.relationships ?? {};
  const out: { relation: string; name: string }[] = [];
  for (const group of Object.values(groups)) {
    for (const entry of group?.contacts ?? []) {
      const name = entry?.contact?.complete_name ?? entry?.contact?.first_name;
      if (typeof name !== 'string' || name.trim() === '') continue;
      out.push({ relation: entry?.relationship?.name ?? 'related', name });
    }
  }
  return out;
}

function howYouMet(contact: ContactDetail): { how_you_met?: string } {
  const note = contact.information?.how_you_met?.general_information;
  return typeof note === 'string' && note.trim() !== '' ? { how_you_met: note } : {};
}

async function list<T>(
  client: MonicaClient,
  path: string,
): Promise<{ data: T[]; total?: number }> {
  const res = await client.request<{ data: T[]; meta?: { total?: number } }>('GET', path);
  return { data: res.data ?? [], ...(res.meta?.total === undefined ? {} : { total: res.meta.total }) };
}

const firstLine = (s: string | null): string | null =>
  s === null ? null : (s.split('\n').find((l) => l.trim() !== '') ?? null);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((b.getTime() - a.getTime()) / 86_400_000);
