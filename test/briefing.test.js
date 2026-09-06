import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefContact } from '../dist/briefing.js';

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const base = {
  id: 6, first_name: 'Mildred', last_name: 'Bogwitch', nickname: null,
  complete_name: 'Mildred Bogwitch', stay_in_touch_frequency: 30,
  last_activity_together: ago(400), last_called: null,
};

function fakeClient(contact = base, over = {}) {
  return {
    request: async (_m, path) => {
      if (/^\/api\/contacts\/\d+$/.test(path)) return { data: contact };
      if (path.includes('/activities')) return over.activities ?? {
        data: [{ id: 1, summary: 'Cauldron advice', happened_at: ago(400) }], meta: { total: 25 } };
      if (path.includes('/calls')) return over.calls ?? { data: [], meta: { total: 0 } };
      if (path.includes('/reminders')) return over.reminders ?? { data: [], meta: { total: 0 } };
      if (path.includes('/tasks')) return over.tasks ?? { data: [], meta: { total: 0 } };
      return { data: [] };
    },
  };
}

test('reports how overdue in words a human can act on', async () => {
  const r = await briefContact(fakeClient(), { contact_id: 6 });
  assert.equal(r.status, 'ok');
  assert.match(r.cadence, /every 30 days/);
  assert.match(r.cadence, /overdue/);
});

test('says so plainly when no cadence is set', async () => {
  const r = await briefContact(fakeClient({ ...base, stay_in_touch_frequency: null }), { contact_id: 6 });
  assert.match(r.cadence, /no cadence set/);
});

test('a contact with nothing logged still briefs, rather than erroring', async () => {
  const client = fakeClient(
    { ...base, last_activity_together: null },
    { activities: { data: [], meta: { total: 0 } } },
  );
  const r = await briefContact(client, { contact_id: 6 });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.interactions, []);
  assert.match(r.cadence, /nothing logged yet/);
});

test('history caps the list without paging the whole history', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: i, summary: `Encounter ${i}`, happened_at: ago(i * 7),
  }));
  const client = fakeClient(base, { activities: { data: many, meta: { total: 25 } } });
  const r = await briefContact(client, { contact_id: 6, history: 3 });
  assert.equal(r.interactions.length, 3);
  assert.equal(r.interactions_total, 25, 'total still reported');
});

test('activities and calls interleave, newest first', async () => {
  const client = fakeClient(base, {
    activities: { data: [{ id: 1, summary: 'older activity', happened_at: ago(10) }], meta: { total: 1 } },
    calls: { data: [{ id: 2, content: 'newer call\nsecond line', called_at: ago(2) }], meta: { total: 1 } },
  });
  const r = await briefContact(client, { contact_id: 6 });
  assert.equal(r.interactions[0].kind, 'call');
  assert.equal(r.interactions[0].summary, 'newer call', 'only the first line of call content');
  assert.equal(r.interactions[1].kind, 'activity');
});

test('a relationship pointing at a deleted contact does not break the briefing', async () => {
  const broken = {
    ...base,
    information: {
      relationships: {
        love: { total: 2, contacts: [
          { relationship: { name: 'partner' }, contact: { complete_name: 'Grimlock Stonefist' } },
          { relationship: { name: 'ex' }, contact: null },
        ] },
      },
    },
  };
  const r = await briefContact(fakeClient(broken), { contact_id: 6 });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.relationships, [{ relation: 'partner', name: 'Grimlock Stonefist' }]);
});

test('completed tasks are left out', async () => {
  const client = fakeClient(base, {
    tasks: { data: [{ title: 'return cauldron', completed: false },
                    { title: 'already done', completed: true }], meta: { total: 2 } },
  });
  const r = await briefContact(client, { contact_id: 6 });
  assert.deepEqual(r.tasks.map((t) => t.title), ['return cauldron']);
});

test('no contact given is an error, not a guess', async () => {
  const r = await briefContact(fakeClient(), {});
  assert.equal(r.status, 'error');
});

test('refetches by id — a search result lies about cadence', async () => {
  // Mirrors live behaviour: ?query= returns the key with a null value.
  const fromSearch = { ...base, stay_in_touch_frequency: null };
  const fromId = { ...base, stay_in_touch_frequency: 30 };
  let refetched = false;
  const client = {
    request: async (_m, path) => {
      if (/^\/api\/contacts\/\d+$/.test(path)) { refetched = true; return { data: fromId }; }
      if (path.includes('query=')) return { data: [fromSearch] };
      return { data: [], meta: { total: 0 } };
    },
  };
  const r = await briefContact(client, { contact: 'Mildred' });
  assert.ok(refetched, 'must not trust the search result');
  assert.match(r.cadence, /every 30 days/);
});
