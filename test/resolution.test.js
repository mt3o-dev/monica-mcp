import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContact, aliasSuggestion } from '../dist/resolution.js';

const contact = (id, first, last, nickname = null, extra = {}) => ({
  id,
  first_name: first,
  last_name: last,
  nickname,
  complete_name: nickname ? `${first} ${last} (${nickname})` : `${first} ${last}`,
  stay_in_touch_frequency: null,
  last_activity_together: null,
  last_called: null,
  ...extra,
});

const CAST = [
  contact(1, 'Grimlock', 'Bridgetroll'),
  contact(2, 'Grimlock', 'Stonefist'),
  contact(3, 'Grim', 'Toadwart'),
  contact(4, 'Grimlockson', 'Ironjaw'),
  contact(5, 'Sparklehoof', 'Silvermane', 'Sparky'),
];

/**
 * Stands in for Monica's ?query=. Verified against a live instance: it matches
 * first/last/nickname and tokenises multi-word queries, so "Grimlock
 * Bridgetroll" returns every Grimlock rather than just the exact one. Tier 1
 * narrows that down; the search does not.
 */
const fakeClient = (pool = CAST) => ({
  request: async (_method, path) => {
    const raw = decodeURIComponent(new URL(`http://x${path}`).searchParams.get('query') ?? '');
    const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
    return {
      data: pool.filter((c) =>
        [c.first_name, c.last_name, c.nickname]
          .filter(Boolean)
          .some((v) => tokens.some((t) => v.toLowerCase().includes(t))),
      ),
    };
  },
});

test('tier 1: exact full name wins outright', async () => {
  const r = await resolveContact(fakeClient(), 'Grimlock Bridgetroll');
  assert.equal(r.kind, 'resolved');
  assert.equal(r.contact.id, 1);
  assert.equal(r.tier, 1);
});

test('tier 1: an exact nickname resolves', async () => {
  const r = await resolveContact(fakeClient(), 'sparky');
  assert.equal(r.kind, 'resolved');
  assert.equal(r.contact.id, 5);
  assert.equal(r.tier, 1);
});

test('tier 3: two Grimlocks are ambiguous, never guessed', async () => {
  const r = await resolveContact(fakeClient(), 'Grimlock');
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), [1, 2]);
});

test('exact first name beats the substring match', async () => {
  const r = await resolveContact(fakeClient(), 'Grim');
  assert.equal(r.kind, 'resolved', 'Grim Toadwart is an exact first name');
  assert.equal(r.contact.id, 3);
});

test('a longer unique name is not swallowed by shorter ones', async () => {
  const r = await resolveContact(fakeClient(), 'Grimlockson');
  assert.equal(r.kind, 'resolved');
  assert.equal(r.contact.id, 4);
});

test('recency never breaks a tie', async () => {
  const recent = [
    contact(1, 'Grimlock', 'Bridgetroll', null, { last_activity_together: '2026-09-01T00:00:00Z' }),
    contact(2, 'Grimlock', 'Stonefist', null, { last_activity_together: '2020-01-01T00:00:00Z' }),
  ];
  const r = await resolveContact(fakeClient(recent), 'Grimlock');
  assert.equal(r.kind, 'ambiguous', 'the recent one must not win');
  assert.match(r.candidates.find((c) => c.id === 1).last_activity_together, /2026/);
});

test('no match is not_found, and never creates anything', async () => {
  const r = await resolveContact(fakeClient(), 'Gandalf');
  assert.equal(r.kind, 'not_found');
});

test('empty query resolves to nothing without calling the API', async () => {
  const r = await resolveContact(
    { request: async () => assert.fail('should not have called Monica') },
    '   ',
  );
  assert.equal(r.kind, 'not_found');
});

test('alias suggested when nickname is empty and the name is unfamiliar', () => {
  assert.equal(aliasSuggestion('Bridgy', CAST[0]), 'Bridgy');
});

test('alias never suggested when a nickname already exists', () => {
  assert.equal(aliasSuggestion('Hoofy', CAST[4]), null, 'would destroy a hand-typed nickname');
});

test('alias not suggested for a name Monica already knows', () => {
  assert.equal(aliasSuggestion('grimlock', CAST[0]), null);
  assert.equal(aliasSuggestion('Grimlock Bridgetroll', CAST[0]), null);
});
