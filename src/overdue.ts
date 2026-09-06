import type { MonicaClient } from './monica.js';
import { lastInteractionAt, type Contact } from './contacts.js';
import { ok, type ToolResult } from './results.js';

export interface FindOverdueInput {
  limit?: number | undefined;
  include_never_contacted?: boolean | undefined;
}

export interface OverdueContact {
  id: number;
  name: string;
  cadence_days: number;
  days_since: number | null;
  days_overdue: number | null;
  last_interaction: string | null;
}

export interface FindOverdueOk {
  overdue: OverdueContact[];
  contacts_scanned: number;
  with_cadence: number;
}

const DEFAULT_LIMIT = 10;
const PAGE_SIZE = 100;
/** Guard against paging a very large account forever on a 60/min budget. */
const MAX_PAGES = 20;

/**
 * What a personal CRM is actually for. Monica has no server-side overdue
 * filter, so this pages the address book and decides here — cheap because the
 * timestamps it needs are already in the list response (ADR 0005), so there is
 * no per-contact fetch and no write anywhere in this path.
 */
export async function findOverdue(
  client: MonicaClient,
  input: FindOverdueInput,
): Promise<ToolResult<FindOverdueOk>> {
  const limit = Math.max(1, input.limit ?? DEFAULT_LIMIT);
  const includeNever = input.include_never_contacted ?? true;

  const contacts = await allContacts(client);
  const withCadence = contacts.filter(
    (c) => c.stay_in_touch_frequency !== null && c.stay_in_touch_frequency > 0,
  );

  const now = new Date();
  const rows: OverdueContact[] = [];

  for (const contact of withCadence) {
    const cadence = contact.stay_in_touch_frequency!;
    const last = lastInteractionAt(contact);

    if (last === null) {
      // Never logged. Overdue by definition — you said you wanted to be in
      // touch and there is no evidence you ever were.
      if (!includeNever) continue;
      rows.push({
        id: contact.id,
        name: contact.complete_name,
        cadence_days: cadence,
        days_since: null,
        days_overdue: null,
        last_interaction: null,
      });
      continue;
    }

    const daysSince = daysBetween(last, now);
    if (daysSince <= cadence) continue;
    rows.push({
      id: contact.id,
      name: contact.complete_name,
      cadence_days: cadence,
      days_since: daysSince,
      days_overdue: daysSince - cadence,
      last_interaction: last.toISOString().slice(0, 10),
    });
  }

  // Never-contacted first, then by how far past the cadence.
  rows.sort((a, b) => {
    if (a.days_overdue === null && b.days_overdue === null) return b.cadence_days - a.cadence_days;
    if (a.days_overdue === null) return -1;
    if (b.days_overdue === null) return 1;
    return b.days_overdue - a.days_overdue;
  });

  return ok<FindOverdueOk>({
    overdue: rows.slice(0, limit),
    contacts_scanned: contacts.length,
    with_cadence: withCadence.length,
  });
}

/**
 * Contacts with no Cadence are not filtered out here — they are simply never
 * selected above. An unset cadence means the user never expressed an intention,
 * and including them would return the whole address book sorted by neglect.
 */
async function allContacts(client: MonicaClient): Promise<Contact[]> {
  const out: Contact[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await client.request<{
      data: Contact[];
      meta?: { current_page?: number; last_page?: number };
    }>('GET', `/api/contacts?limit=${PAGE_SIZE}&page=${page}`);
    out.push(...(res.data ?? []));
    const lastPage = res.meta?.last_page ?? page;
    if (page >= lastPage) break;
  }
  return out;
}

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((b.getTime() - a.getTime()) / 86_400_000);
