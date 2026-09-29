import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePreferenceState } from '../server/runtime/preferences.js';

test('accepts large internal state and rejects more than 2 MiB', () => {
  const actualScale = { cache: 'x'.repeat(210_000) };
  assert.doesNotThrow(() => validatePreferenceState(actualScale));
  assert.throws(() => validatePreferenceState({ cache: 'x'.repeat(2 * 1024 * 1024) }), /source_storage_limit/);
});

test('rejects unsafe keys and nested objects', () => {
  assert.throws(() => validatePreferenceState(JSON.parse('{"__proto__":"x"}')), /compatibility_preferences_invalid/);
  assert.throws(() => validatePreferenceState({ nested: { secret: true } }), /compatibility_preferences_invalid/);
});
