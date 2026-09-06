import type { MonicaClient } from './monica.js';
import { searchContacts, getContact, lastInteractionAt, type Contact } from './contacts.js';
import type { Candidate } from './results.js';

export type Resolution =
  | { kind: 'resolved'; contact: Contact; tier: 1 | 2 }
  | { kind: 'ambiguous'; candidates: Contact[] }
  | { kind: 'not_found'; nearMisses: Contact[] };

const normalise = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

const fullName = (c: Contact): string =>
  normalise(`${c.first_name} ${c.last_name ?? ''}`);

/**
 * Turning a name the user typed into exactly one contact.
 *
 * Tiers, never a similarity score: you cannot justify 0.8 over 0.75, and you
 * tune it forever. Doubt is a tie no tier breaks.
 *
 * Recency is deliberately NOT a tiebreaker — only a hint offered to the human.
 * Deciding by it would silently favour frequently-contacted people, who are
 * exactly the contacts whose records you would notice were wrong.
 */
export async function resolveContact(client: MonicaClient, query: string): Promise<Resolution> {
  const q = normalise(query);
  if (q === '') return { kind: 'not_found', nearMisses: [] };

  const pool = await searchContacts(client, query);
  if (pool.length === 0) return { kind: 'not_found', nearMisses: [] };

  // Tier 1: exact full name, or exact nickname.
  const tier1 = pool.filter(
    (c) =>
      fullName(c) === q ||
      normalise(c.complete_name) === q ||
      (c.nickname !== null && normalise(c.nickname) === q),
  );
  if (tier1.length === 1) return { kind: 'resolved', contact: tier1[0]!, tier: 1 };
  if (tier1.length > 1) return { kind: 'ambiguous', candidates: tier1 };

  // Tier 2a: exact first name. Checked before substring so that "Grimlock"
  // cannot be swallowed by "Grimlockson".
  const byFirstName = pool.filter((c) => normalise(c.first_name) === q);
  if (byFirstName.length === 1) return { kind: 'resolved', contact: byFirstName[0]!, tier: 2 };
  if (byFirstName.length > 1) return { kind: 'ambiguous', candidates: byFirstName };

  // Tier 2b: substring across the name fields.
  const bySubstring = pool.filter((c) =>
    [c.first_name, c.last_name, c.nickname, c.complete_name]
      .filter((v): v is string => typeof v === 'string')
      .some((v) => normalise(v).includes(q)),
  );
  if (bySubstring.length === 1) return { kind: 'resolved', contact: bySubstring[0]!, tier: 2 };
  if (bySubstring.length > 1) return { kind: 'ambiguous', candidates: bySubstring };

  return { kind: 'not_found', nearMisses: pool.slice(0, 5) };
}

/** Accepts either an exact id or a name, so a re-call after disambiguation is stateless. */
export async function resolveContactRef(
  client: MonicaClient,
  ref: { contact?: string | undefined; contact_id?: number | undefined },
): Promise<Resolution> {
  if (ref.contact_id !== undefined) {
    const contact = await getContact(client, ref.contact_id);
    return { kind: 'resolved', contact, tier: 1 };
  }
  if (ref.contact === undefined) return { kind: 'not_found', nearMisses: [] };
  return resolveContact(client, ref.contact);
}

export function toCandidate(contact: Contact): Candidate {
  return { id: contact.id, name: contact.complete_name, hint: hintFor(contact) };
}

function hintFor(contact: Contact): string {
  const last = lastInteractionAt(contact);
  if (last === null) return 'no interactions logged';
  return `last interaction ${last.toISOString().slice(0, 10)}`;
}

/**
 * The alias write-back, question 5's feedback loop. Every ambiguity resolved
 * once should be one you never see again — and Monica is the shared brain, so a
 * confirmed alias goes there rather than into local state this server does not
 * have.
 *
 * Returns the alias worth proposing, or null. Only when `nickname` is empty: an
 * existing nickname is something the user typed by hand, and we do not offer to
 * destroy it.
 */
export function aliasSuggestion(query: string, contact: Contact): string | null {
  const q = normalise(query);
  if (q === '') return null;
  if (contact.nickname !== null && contact.nickname.trim() !== '') return null;

  const known = [contact.first_name, contact.last_name, contact.complete_name, fullName(contact)]
    .filter((v): v is string => typeof v === 'string')
    .map(normalise);
  if (known.includes(q)) return null;

  return query.trim();
}
