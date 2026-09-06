import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../dist/config.js';

const full = {
  MONICA_BASE_URL: 'https://example.com/',
  MONICA_API_TOKEN: 'tok',
  MCP_BEARER_TOKEN: 'bearer',
  MONICA_EXPECTED_ACCOUNT: '2',
};

test('names every missing variable, not just the first', () => {
  try {
    loadConfig({});
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.deepEqual(e.missing, [
      'MONICA_BASE_URL',
      'MONICA_API_TOKEN',
      'MCP_BEARER_TOKEN',
      'MONICA_EXPECTED_ACCOUNT',
    ]);
  }
});

test('treats whitespace-only as missing', () => {
  assert.throws(() => loadConfig({ ...full, MONICA_API_TOKEN: '   ' }), ConfigError);
});

test('strips trailing slashes from the base url', () => {
  assert.equal(loadConfig(full).monicaBaseUrl, 'https://example.com');
});

test('rejects a nonsense port', () => {
  assert.throws(() => loadConfig({ ...full, MCP_PORT: 'banana' }), /MCP_PORT/);
});
