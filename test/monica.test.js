import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonicaClient, RateLimitError, MonicaError } from '../dist/monica.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

test('sends Accept: application/json — without it Laravel 302s instead of 401ing', async () => {
  let seen;
  const client = new MonicaClient('https://m.test', 'tok', async (_url, init) => {
    seen = init.headers;
    return json({ data: [] });
  });
  await client.request('GET', '/api/contacts');
  assert.equal(seen.Accept, 'application/json');
  assert.equal(seen.Authorization, 'Bearer tok');
});

test('records rate limit headers from every response', async () => {
  const client = new MonicaClient('https://m.test', 'tok', async () =>
    json({ data: [] }, { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '57' } }),
  );
  await client.request('GET', '/api/contacts');
  assert.deepEqual(client.rateLimit, { limit: 60, remaining: 57 });
});

test('retries a 429 exactly once, then succeeds', async () => {
  let calls = 0;
  const client = new MonicaClient('https://m.test', 'tok', async () => {
    calls += 1;
    return calls === 1
      ? json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '0' } })
      : json({ data: 'through' });
  });
  assert.deepEqual(await client.request('GET', '/api/contacts'), { data: 'through' });
  assert.equal(calls, 2);
});

test('fails loudly when the retry is also rate limited — never queues', async () => {
  let calls = 0;
  const client = new MonicaClient('https://m.test', 'tok', async () => {
    calls += 1;
    return json({}, { status: 429, headers: { 'Retry-After': '0' } });
  });
  await assert.rejects(() => client.request('GET', '/api/contacts'), RateLimitError);
  assert.equal(calls, 2);
});

test('does not wait out an absurd Retry-After', async () => {
  let calls = 0;
  const client = new MonicaClient('https://m.test', 'tok', async () => {
    calls += 1;
    return json({}, { status: 429, headers: { 'Retry-After': '3600' } });
  });
  await assert.rejects(() => client.request('GET', '/api/contacts'), RateLimitError);
  assert.equal(calls, 1, 'should give up rather than sleep an hour');
});

test('surfaces non-429 failures as MonicaError with the status', async () => {
  const client = new MonicaClient('https://m.test', 'tok', async () =>
    json({ error: 'nope' }, { status: 401 }),
  );
  await assert.rejects(() => client.request('GET', '/api/me'), (e) => {
    assert.ok(e instanceof MonicaError);
    assert.equal(e.httpStatus, 401);
    return true;
  });
});
