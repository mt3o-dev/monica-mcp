import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logInteraction } from '../dist/interactions.js';

const TYPES = [{ id: 17, name: 'just hung out' }, { id: 18, name: 'went to a bar' }];

const contact = (id, first, last, nickname = null) => ({
  id, first_name: first, last_name: last, nickname,
  complete_name: nickname ? `${first} ${last} (${nickname})` : `${first} ${last}`,
  stay_in_touch_frequency: null, last_activity_together: null, last_called: null,
});

const CAST = [
  contact(1, 'Grimlock', 'Bridgetroll'),
  contact(2, 'Grimlock', 'Stonefist'),
  contact(5, 'Sparklehoof', 'Silvermane', 'Sparky'),
];

/** Records every write so tests can assert on what actually went to Monica. */
function fakeClient({ existingRecords = [] } = {}) {
  const writes = [];
  return {
    writes,
    rateLimit: { limit: 60, remaining: 59 },
    request: async (method, path, body) => {
      if (method === 'POST') {
        writes.push({ path, body });
        return { data: { id: 99 } };
      }
      if (path.includes('/activities') || path.includes('/calls')) {
        return { data: existingRecords };
      }
      const idMatch = /^\/api\/contacts\/(\d+)$/.exec(path);
      if (idMatch) return { data: CAST.find((c) => c.id === Number(idMatch[1])) };
      const q = decodeURIComponent(new URL(`http://x${path}`).searchParams.get('query') ?? '');
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      return {
        data: CAST.filter((c) =>
          [c.first_name, c.last_name, c.nickname].filter(Boolean)
            .some((v) => tokens.some((t) => v.toLowerCase().includes(t)))),
      };
    },
  };
}

test('one call writes one Activity', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'coffee', raw_text: 'had coffee with sparky',
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.shape, 'activity');
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0].path, '/api/activities');
  assert.deepEqual(client.writes[0].body.contacts, [5]);
});

test('raw text is stored verbatim, summary separately (ADR 0004)', async () => {
  const client = fakeClient();
  await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'coffee', raw_text: 'ummm had coffee wiv sparky innit',
  });
  const body = client.writes[0].body;
  assert.equal(body.summary, 'coffee');
  assert.equal(body.description, 'ummm had coffee wiv sparky innit');
});

test('phone with one contact becomes a Call', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'rang about the bridge', medium: 'phone',
  });
  assert.equal(r.shape, 'call');
  assert.equal(client.writes[0].path, '/api/calls');
  assert.equal(client.writes[0].body.contact_id, 5);
});

test('phone with several contacts stays an Activity — Call holds only one', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contact_ids: [1, 5], summary: 'conference call', medium: 'phone',
  });
  assert.equal(r.shape, 'activity');
});

test('ambiguity writes nothing at all', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, { contacts: ['Grimlock'], summary: 'x' });
  assert.equal(r.status, 'ambiguous');
  assert.equal(client.writes.length, 0, 'must not write a partial interaction');
});

test('one ambiguous participant aborts the whole write', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky', 'Grimlock'], summary: 'group thing',
  });
  assert.equal(r.status, 'ambiguous');
  assert.equal(client.writes.length, 0);
});

test('unknown name is not_found and creates no contact', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, { contacts: ['Gandalf'], summary: 'x' });
  assert.equal(r.status, 'not_found');
  assert.equal(client.writes.length, 0);
});

test('an invalid activity_type is refused with the valid list', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'x', activity_type: 'went spelunking',
  });
  assert.equal(r.status, 'error');
  assert.match(r.message, /just hung out/);
  assert.equal(client.writes.length, 0);
});

test('a repeated capture_id does not write twice', async () => {
  const client = fakeClient({
    existingRecords: [{ id: 42, description: 'old text\n\n[capture:abc123]' }],
  });
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'x', capture_id: 'abc123',
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.already_logged, true);
  assert.equal(r.record_id, 42);
  assert.equal(client.writes.length, 0);
});

test('a fresh capture_id does write, and carries the marker', async () => {
  const client = fakeClient({ existingRecords: [] });
  const r = await logInteraction(client, TYPES, {
    contacts: ['Sparky'], summary: 'x', raw_text: 'raw', capture_id: 'new999',
  });
  assert.equal(r.already_logged, undefined);
  assert.match(client.writes[0].body.description, /raw\n\n\[capture:new999\]/);
});

test('alias is suggested after a disambiguation, not applied', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contact_ids: [1], resolved_from: 'Bridgy', summary: 'x',
  });
  assert.equal(r.alias_suggestion.alias, 'Bridgy');
  assert.equal(r.alias_remembered, undefined);
  assert.equal(client.writes.length, 1, 'only the interaction, no nickname write');
});

test('alias is written only with remember_alias', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contact_ids: [1], resolved_from: 'Bridgy', summary: 'x', remember_alias: true,
  });
  assert.equal(r.alias_remembered, 'Bridgy');
  const nicknameWrite = client.writes.find((w) => w.path === '/api/contacts/1');
  assert.equal(nicknameWrite, undefined, 'nickname goes via PUT, not POST');
});

test('no alias offered when the contact already has a nickname', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, {
    contact_ids: [5], resolved_from: 'Hoofy', summary: 'x',
  });
  assert.equal(r.alias_suggestion, undefined);
});

test('no contact given is an error, not a guess', async () => {
  const client = fakeClient();
  const r = await logInteraction(client, TYPES, { summary: 'x' });
  assert.equal(r.status, 'error');
  assert.equal(client.writes.length, 0);
});

test('omitted activity_type falls back to the generic one, not an arbitrary one', async () => {
  const client = fakeClient();
  const types = [{ id: 9, name: 'played a sport together' }, { id: 17, name: 'just hung out' }];
  const r = await logInteraction(client, types, { contacts: ['Sparky'], summary: 'coffee' });
  assert.equal(r.activity_type, 'just hung out');
  assert.equal(client.writes[0].body.activity_type_id, 17);
});
