import type { MonicaClient } from './monica.js';
import { resolveContactRef, toCandidate } from './resolution.js';
import { ok, ambiguous, notFound, failed, type ToolResult } from './results.js';

export const FREQUENCIES = ['one_time', 'week', 'month', 'year'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface CreateReminderInput {
  contact?: string | undefined;
  contact_id?: number | undefined;
  title: string;
  initial_date: string;
  frequency?: Frequency | undefined;
  frequency_number?: number | undefined;
  description?: string | undefined;
}

export interface CreateReminderOk {
  reminder_id: number;
  contact: { id: number; name: string };
  title: string;
  initial_date: string;
  frequency: Frequency;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A fourth tool, and it earns its place because you would say "remind me to ask
 * Bob how Berlin went in April" whether or not the drain existed.
 *
 * The server does no date parsing. "April" to an ISO date is language work, and
 * the caller already holds the context needed to do it; a server-side parser
 * would be a second, worse interpreter of the same sentence.
 */
export async function createReminder(
  client: MonicaClient,
  input: CreateReminderInput,
): Promise<ToolResult<CreateReminderOk>> {
  if (input.contact === undefined && input.contact_id === undefined) {
    return failed('No contact given. Pass contact (a name) or contact_id.');
  }
  if (!ISO_DATE.test(input.initial_date)) {
    return failed(
      `initial_date must be an ISO date (YYYY-MM-DD), got "${input.initial_date}". ` +
        `Resolve phrases like "April" to a date before calling.`,
    );
  }
  if (isPast(input.initial_date)) {
    // Monica accepts it and the reminder simply never fires, which looks like
    // success and is not.
    return failed(
      `initial_date ${input.initial_date} is in the past, so the reminder would never fire.`,
    );
  }

  const frequency = input.frequency ?? 'one_time';
  const frequencyNumber = input.frequency_number ?? 1;
  if (!Number.isInteger(frequencyNumber) || frequencyNumber < 1) {
    return failed(`frequency_number must be a positive integer, got ${input.frequency_number}.`);
  }

  const resolution = await resolveContactRef(client, input);
  if (resolution.kind === 'ambiguous') {
    return ambiguous(input.contact ?? '', resolution.candidates.map(toCandidate));
  }
  if (resolution.kind === 'not_found') {
    return notFound(input.contact ?? String(input.contact_id), resolution.nearMisses.map(toCandidate));
  }
  const contact = resolution.contact;

  const { data } = await client.request<{ data: { id: number } }>('POST', '/api/reminders', {
    contact_id: contact.id,
    title: input.title,
    initial_date: input.initial_date,
    frequency_type: frequency,
    // Required by Monica even for a one-off.
    frequency_number: frequencyNumber,
    ...(input.description === undefined ? {} : { description: input.description }),
  });

  return ok<CreateReminderOk>({
    reminder_id: data.id,
    contact: { id: contact.id, name: contact.complete_name },
    title: input.title,
    initial_date: input.initial_date,
    frequency,
  });
}

function isPast(isoDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return isoDate < today;
}
