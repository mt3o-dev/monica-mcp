import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStartupChecks, StartupError } from '../dist/startup.js';

const config = {
  monicaBaseUrl: 'https://m.test',
  monicaApiToken: 'tok',
  mcpBearerToken: 'bearer',
  expectedAccount: '2',
  port: 8765,
};

const user = { id: 2, email: 'monica-dev@example.com', name: 'Dev', account: { id: 2 } };

const fakeClient = (overrides = {}) => ({
  me: async () => user,
  activityTypes: async () => [{ id: 1, name: 'just hung out' }],
  ...overrides,
});

test('accepts a matching account id', async () => {
  const result = await runStartupChecks(config, fakeClient());
  assert.equal(result.user.account.id, 2);
  assert.equal(result.activityTypes.length, 1);
});

test('accepts a matching email, case-insensitively', async () => {
  const result = await runStartupChecks(
    { ...config, expectedAccount: 'MONICA-DEV@example.com' },
    fakeClient(),
  );
  assert.equal(result.user.email, 'monica-dev@example.com');
});

test('refuses to start when the token belongs to another account', async () => {
  await assert.rejects(
    () => runStartupChecks({ ...config, expectedAccount: '1' }, fakeClient()),
    (e) => {
      assert.ok(e instanceof StartupError);
      assert.match(e.message, /Refusing to start/);
      return true;
    },
  );
});

test('refuses to start when Monica is unreachable', async () => {
  await assert.rejects(
    () =>
      runStartupChecks(config, fakeClient({ me: async () => { throw new Error('ECONNREFUSED'); } })),
    (e) => {
      assert.match(e.message, /Could not reach Monica/);
      return true;
    },
  );
});

test('refuses to start with no activity types — the enum would be empty', async () => {
  await assert.rejects(
    () => runStartupChecks(config, fakeClient({ activityTypes: async () => [] })),
    (e) => {
      assert.match(e.message, /no activity types/);
      return true;
    },
  );
});
