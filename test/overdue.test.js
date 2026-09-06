import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOverdue } from '../dist/overdue.js';

const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

const c = (id, name, freq, lastActivity = null, lastCall = null) => ({
  id, first_name: name, last_name: '', nickname: null, complete_name: name,
  stay_in_touch_frequency: freq, last_activity_together: lastActivity, last_called: lastCall,
});

const fakeClient = (contacts) => ({
  request: async (_m, path) => {
    const page = Number(new URL(`http://x${path}`).searchParams.get('page') ?? 1);
    const size = 100;
    const slice = contacts.slice((page - 1) * size, page * size);
    return { data: slice, meta: { current_page: page, last_page: Math.max(1, Math.ceil(contacts.length / size)) } };
  },
});

test('surfaces a genuinely stale contact', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Mildred', 30, ago(400))]), {});
  assert.equal(r.status, 'ok');
  assert.equal(r.overdue.length, 1);
  assert.equal(r.overdue[0].days_overdue, 370);
});

test('a contact seen within their cadence is not overdue', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Bridgetroll', 365, ago(4))]), {});
  assert.deepEqual(r.overdue, []);
});

test('a contact with no cadence never appears, however long it has been', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Toadwart', null, ago(9999))]), {});
  assert.deepEqual(r.overdue, []);
  assert.equal(r.with_cadence, 0);
});

test('cadence set but nothing logged counts as overdue', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Stonefist', 7, null)]), {});
  assert.equal(r.overdue.length, 1);
  assert.equal(r.overdue[0].days_since, null);
});

test('never-contacted can be excluded', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Stonefist', 7, null)]), {
    include_never_contacted: false,
  });
  assert.deepEqual(r.overdue, []);
});

test('a recent call counts as an interaction, not just an activity', async () => {
  const r = await findOverdue(fakeClient([c(1, 'Ironjaw', 7, ago(400), ago(1))]), {});
  assert.deepEqual(r.overdue, [], 'the more recent of the two wins');
});

test('sorted most overdue first, never-contacted at the top', async () => {
  const r = await findOverdue(fakeClient([
    c(1, 'Slightly', 30, ago(40)),
    c(2, 'Very', 30, ago(400)),
    c(3, 'Never', 30, null),
  ]), {});
  assert.deepEqual(r.overdue.map((x) => x.name), ['Never', 'Very', 'Slightly']);
});

test('limit truncates after sorting, not before', async () => {
  const r = await findOverdue(fakeClient([
    c(1, 'Slightly', 30, ago(40)),
    c(2, 'Very', 30, ago(400)),
  ]), { limit: 1 });
  assert.deepEqual(r.overdue.map((x) => x.name), ['Very']);
});

test('pages past the first hundred contacts', async () => {
  const many = Array.from({ length: 250 }, (_, i) => c(i, `C${i}`, null, null));
  many.push(c(999, 'Hidden', 10, ago(100)));
  const r = await findOverdue(fakeClient(many), {});
  assert.equal(r.contacts_scanned, 251);
  assert.equal(r.overdue[0].name, 'Hidden');
});
