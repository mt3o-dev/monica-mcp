import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReminder } from '../dist/reminders.js';

const future = () => {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const c = (id, first, last, nickname = null) => ({
  id, first_name: first, last_name: last, nickname,
  complete_name: `${first} ${last}`, stay_in_touch_frequency: null,
  last_activity_together: null, last_called: null,
});
const CAST = [c(1, 'Grimlock', 'Bridgetroll'), c(2, 'Grimlock', 'Stonefist'), c(5, 'Sparklehoof', 'Silvermane', 'Sparky')];

function fakeClient() {
  const writes = [];
  return {
    writes,
    request: async (method, path, body) => {
      if (method === 'POST') { writes.push({ path, body }); return { data: { id: 77 } }; }
      const byId = /^\/api\/contacts\/(\d+)$/.exec(path);
      if (byId) return { data: CAST.find((x) => x.id === Number(byId[1])) };
      const q = decodeURIComponent(new URL(`http://x${path}`).searchParams.get('query') ?? '').toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      return { data: CAST.filter((x) => [x.first_name, x.last_name, x.nickname].filter(Boolean)
        .some((v) => tokens.some((t) => v.toLowerCase().includes(t)))) };
    },
  };
}

test('creates a one-off reminder', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { contacts: undefined, contact: 'Sparky', title: 'ask about the glade', initial_date: future() });
  assert.equal(r.status, 'ok');
  assert.equal(client.writes[0].path, '/api/reminders');
  assert.equal(client.writes[0].body.frequency_type, 'one_time');
});

test('always sends frequency_number — Monica requires it even for one_time', async () => {
  const client = fakeClient();
  await createReminder(client, { contact: 'Sparky', title: 'x', initial_date: future() });
  assert.equal(client.writes[0].body.frequency_number, 1);
});

test('recurring reminders carry their frequency', async () => {
  const client = fakeClient();
  await createReminder(client, {
    contact: 'Sparky', title: 'x', initial_date: future(), frequency: 'month', frequency_number: 3,
  });
  assert.equal(client.writes[0].body.frequency_type, 'month');
  assert.equal(client.writes[0].body.frequency_number, 3);
});

test('a past date is refused, not silently accepted', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { contact: 'Sparky', title: 'x', initial_date: '2020-01-01' });
  assert.equal(r.status, 'error');
  assert.match(r.message, /never fire/);
  assert.equal(client.writes.length, 0);
});

test('a non-ISO date is refused with instructions, not parsed', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { contact: 'Sparky', title: 'x', initial_date: 'April' });
  assert.equal(r.status, 'error');
  assert.match(r.message, /ISO date/);
  assert.equal(client.writes.length, 0);
});

test('frequency_number zero is refused', async () => {
  const client = fakeClient();
  const r = await createReminder(client, {
    contact: 'Sparky', title: 'x', initial_date: future(), frequency: 'week', frequency_number: 0,
  });
  assert.equal(r.status, 'error');
  assert.equal(client.writes.length, 0);
});

test('an ambiguous name writes nothing', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { contact: 'Grimlock', title: 'x', initial_date: future() });
  assert.equal(r.status, 'ambiguous');
  assert.equal(client.writes.length, 0);
});

test('an alias-resolved contact gets the reminder', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { contact: 'Sparky', title: 'x', initial_date: future() });
  assert.equal(r.contact.id, 5);
  assert.equal(client.writes[0].body.contact_id, 5);
});

test('no contact given is an error', async () => {
  const client = fakeClient();
  const r = await createReminder(client, { title: 'x', initial_date: future() });
  assert.equal(r.status, 'error');
  assert.equal(client.writes.length, 0);
});
