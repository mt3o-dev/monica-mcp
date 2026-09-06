import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MonicaClient, ActivityType } from './monica.js';
import { logInteraction } from './interactions.js';
import { briefContact } from './briefing.js';
import { findOverdue } from './overdue.js';
import { RateLimitError } from './monica.js';
import { rateLimited, failed } from './results.js';

export interface ToolDeps {
  client: MonicaClient;
  activityTypes: ActivityType[];
}

/**
 * Reference data belongs in the schema; only user data belongs behind a call.
 * The activity types were read at startup, so the model picks a valid one in
 * the call it was already making — and cannot pick an invalid one.
 */
export function registerTools(server: McpServer, deps: ToolDeps): void {
  const typeNames = deps.activityTypes.map((t) => t.name);

  server.registerTool(
    'log_interaction',
    {
      title: 'Log an interaction',
      description:
        'Record that you spoke with someone. Resolves the contact by name, chooses where ' +
        'Monica stores it, and writes in one call. If the name is ambiguous nothing is ' +
        'written and the candidates are returned — ask the human, then call again with ' +
        'contact_ids and resolved_from.',
      inputSchema: {
        contacts: z
          .array(z.string())
          .optional()
          .describe('Names as the human said them, e.g. ["Mike"]. Resolved server-side.'),
        contact_ids: z
          .array(z.number().int())
          .optional()
          .describe('Exact Monica contact ids. Use after a disambiguation.'),
        resolved_from: z
          .string()
          .optional()
          .describe('The name originally typed, when re-calling with contact_ids.'),
        summary: z.string().min(1).describe('One line, in your words. Shown in Monica.'),
        raw_text: z
          .string()
          .optional()
          .describe('The original capture or transcript, unedited. Stored verbatim.'),
        activity_type: z
          .string()
          .optional()
          .describe(`One of: ${typeNames.join(', ')}`),
        happened_at: z.string().optional().describe('ISO date. Defaults to today.'),
        medium: z
          .enum(['phone', 'in_person', 'message'])
          .optional()
          .describe('phone with a single contact is stored as a Call.'),
        capture_id: z
          .string()
          .optional()
          .describe('Stable id of the source capture, so a retry does not double-write.'),
        remember_alias: z
          .boolean()
          .optional()
          .describe('Save the name in resolved_from as the contact nickname. Ask first.'),
      },
    },
    async (input) => wrap(() => logInteraction(deps.client, deps.activityTypes, input)),
  );

  server.registerTool(
    'brief_contact',
    {
      title: 'Brief me on a contact',
      description:
        'Everything worth knowing before speaking to someone: who they are, recent ' +
        'interactions, relationships, open reminders and tasks, and how overdue they are. ' +
        'Read-only. An ambiguous name returns candidates rather than a guess.',
      inputSchema: {
        contact: z.string().optional().describe('Name as the human said it, e.g. "Mike".'),
        contact_id: z.number().int().optional().describe('Exact Monica contact id.'),
        history: z
          .number()
          .int()
          .optional()
          .describe('How many recent interactions to include. Default 5, max 25.'),
      },
    },
    async (input) => wrap(() => briefContact(deps.client, input)),
  );

  server.registerTool(
    'find_overdue',
    {
      title: 'Who have I not spoken to?',
      description:
        'Contacts you meant to stay in touch with and have not, most overdue first. ' +
        'Only contacts with a stay-in-touch cadence set in Monica are considered — an ' +
        'unset cadence means no intention was ever expressed. Read-only.',
      inputSchema: {
        limit: z.number().int().optional().describe('How many to return. Default 10.'),
        include_never_contacted: z
          .boolean()
          .optional()
          .describe('Include contacts with a cadence but nothing logged. Default true.'),
      },
    },
    async (input) => wrap(() => findOverdue(deps.client, input)),
  );
}

/** Tools never throw a raw API error at the model. */
async function wrap(run: () => Promise<unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  try {
    return asContent(await run());
  } catch (cause) {
    if (cause instanceof RateLimitError) {
      return asContent(rateLimited(cause.retryAfterSeconds));
    }
    return asContent(failed(cause instanceof Error ? cause.message : String(cause)));
  }
}

const asContent = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
