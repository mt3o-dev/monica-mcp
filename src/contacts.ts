import type { MonicaClient } from './monica.js';

/** The subset of Monica's contact resource this server reads. */
export interface Contact {
  id: number;
  first_name: string;
  last_name: string | null;
  nickname: string | null;
  complete_name: string;
  stay_in_touch_frequency: number | null;
  /** Maintained by Monica when an Activity is created. See ADR 0005. */
  last_activity_together: string | null;
  /** Maintained by Monica when a Call is created. */
  last_called: string | null;
}

interface Paginated<T> {
  data: T[];
  meta?: { total?: number; current_page?: number; last_page?: number };
}

/**
 * Monica's own search. It matches first name, last name and nickname, which is
 * why tier 1 can rely on it — verified against a live instance.
 */
export async function searchContacts(client: MonicaClient, query: string): Promise<Contact[]> {
  const { data } = await client.request<Paginated<Contact>>(
    'GET',
    `/api/contacts?limit=100&query=${encodeURIComponent(query)}`,
  );
  return data;
}

export async function getContact(client: MonicaClient, id: number): Promise<Contact> {
  const { data } = await client.request<{ data: Contact }>('GET', `/api/contacts/${id}`);
  return data;
}

/**
 * Monica's PUT rejects partial payloads — first_name, is_birthdate_known and
 * is_deceased_date_known are all required — so an update is read-modify-write.
 *
 * Only fields this server actually owns are changed. Birthdate and deceased
 * data are *not* echoed back: sending `is_birthdate_known` as false is the
 * documented shape for "no birthdate information in this request", and Monica
 * keeps what it has rather than clearing it. Anything beyond nickname needs
 * this revisited.
 */
export async function setNickname(
  client: MonicaClient,
  contact: Contact,
  nickname: string,
): Promise<Contact> {
  const { data } = await client.request<{ data: Contact }>('PUT', `/api/contacts/${contact.id}`, {
    first_name: contact.first_name,
    last_name: contact.last_name,
    nickname,
    is_birthdate_known: false,
    is_deceased: false,
    is_deceased_date_known: false,
  });
  return data;
}

/** The more recent of the two interaction timestamps Monica maintains. */
export function lastInteractionAt(contact: Contact): Date | null {
  const stamps = [contact.last_activity_together, contact.last_called]
    .filter((s): s is string => s !== null)
    .map((s) => new Date(s))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (a > b ? a : b));
}
