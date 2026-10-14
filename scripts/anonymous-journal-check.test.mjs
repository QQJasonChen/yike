import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAnonymousJournal } from './anonymous-journal-check.mjs';

test('a valid empty anonymous read is healthy', () => {
  assert.doesNotThrow(() => assertAnonymousJournal('  []\n'));
});

for (const [label, body] of [
  ['a disclosed user row', '[{"user_id":"private-user-id"}]'],
  ['an unexpected object', '{"message":"upstream error"}'],
  ['a JSON null', 'null'],
  ['an HTML error with HTTP 200', '<html>failure</html>'],
  ['an empty response', ''],
  ['malformed JSON', '[private-user-id'],
]) {
  test(`rejects ${label} without exposing its contents`, () => {
    let caught;
    try { assertAnonymousJournal(body); } catch (error) { caught = error; }
    assert.ok(caught instanceof Error);
    assert.doesNotMatch(caught.message, /private-user-id|upstream error|<html>/);
  });
}
