import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBearerValidator } from '../dist/auth.js';

const validate = makeBearerValidator('s3cret-token');

test('accepts the exact bearer token', () => {
  assert.equal(validate('Bearer s3cret-token'), true);
});

test('rejects a wrong token of the same length', () => {
  assert.equal(validate('Bearer s3cret-tokeX'), false);
});

test('rejects a missing header', () => {
  assert.equal(validate(undefined), false);
});

test('rejects a token without the Bearer prefix', () => {
  assert.equal(validate('s3cret-token'), false);
});

test('rejects a prefix of the real token', () => {
  assert.equal(validate('Bearer s3cret'), false);
});
