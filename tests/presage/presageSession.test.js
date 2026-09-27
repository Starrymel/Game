import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESAGE_SESSION_ID, withSession } from '../../src/presageSession.js';

test('withSession appends ?session= (or &session= if a query already exists), stable within this page load', () => {
  assert.equal(withSession('wss://example.com/presage'), `wss://example.com/presage?session=${PRESAGE_SESSION_ID}`);
  assert.equal(withSession('wss://example.com/presage?room=x'), `wss://example.com/presage?room=x&session=${PRESAGE_SESSION_ID}`);
  // Same id every call (so the sender and receiver connections from the same page load correlate).
  assert.equal(withSession('wss://a/x'), withSession('wss://a/x'));
});
