import { describe, expect, it } from 'vitest';
import { VertexCooldown, isPersistentVertexError, summarizeError } from '../src/server/vertexCooldown';

describe('VertexCooldown', () => {
  it('skips a tripped model until the cooldown elapses', () => {
    let now = 1_000;
    const cooldown = new VertexCooldown(60_000, () => now);

    expect(cooldown.isCoolingDown('gemini-3.8-flash')).toBe(false);
    cooldown.trip('gemini-3.8-flash');
    expect(cooldown.isCoolingDown('gemini-3.8-flash')).toBe(true);

    now += 59_999;
    expect(cooldown.isCoolingDown('gemini-3.8-flash')).toBe(true);
    now += 1;
    expect(cooldown.isCoolingDown('gemini-3.8-flash')).toBe(false);
  });

  it('tracks each model separately', () => {
    const cooldown = new VertexCooldown(60_000, () => 0);
    cooldown.trip('gemini-3.8-flash-lite-tts');

    expect(cooldown.isCoolingDown('gemini-3.8-flash-lite-tts')).toBe(true);
    expect(cooldown.isCoolingDown('gemini-3.8-flash')).toBe(false);
  });
});

describe('isPersistentVertexError', () => {
  it.each([400, 401, 403, 404])('treats HTTP %i as persistent', (status) => {
    expect(isPersistentVertexError({ status })).toBe(true);
  });

  it.each([429, 500, 503, undefined])('retries Vertex AI after HTTP %s', (status) => {
    expect(isPersistentVertexError({ status })).toBe(false);
  });

  it('handles non-object errors', () => {
    expect(isPersistentVertexError('boom')).toBe(false);
    expect(isPersistentVertexError(null)).toBe(false);
  });
});

describe('summarizeError', () => {
  it('extracts the inner message from an SDK JSON error', () => {
    const err = new Error(JSON.stringify({ error: { code: 403, message: "Permission 'aiplatform.endpoints.predict' denied" } }));
    expect(summarizeError(err)).toBe("Permission 'aiplatform.endpoints.predict' denied");
  });

  it('truncates long messages to 200 characters', () => {
    const summary = summarizeError(new Error('x'.repeat(500)));
    expect(summary).toHaveLength(200);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('falls back to the raw message for plain errors and values', () => {
    expect(summarizeError(new Error('socket hang up'))).toBe('socket hang up');
    expect(summarizeError('timeout')).toBe('timeout');
  });
});
