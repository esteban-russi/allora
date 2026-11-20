import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { buildLiveClientOptions, parseModelJsonResponse } from '../src/platform/server/genAi';
import { VertexCooldown } from '../src/platform/server/vertexCooldown';

describe('parseModelJsonResponse', () => {
  it('parses pure JSON correctly', () => {
    const parsed = parseModelJsonResponse('{"text":"ciao"}', { text: 'fallback' });
    expect(parsed).toEqual({ text: 'ciao' });
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n{"text":"ciao","translation":"hello"}\n```';
    const parsed = parseModelJsonResponse(raw, { text: 'fallback', translation: '' });
    expect(parsed).toEqual({ text: 'ciao', translation: 'hello' });
  });

  it('returns fallback on invalid JSON syntax', () => {
    const parsed = parseModelJsonResponse('not-json', { fallback: true });
    expect(parsed).toEqual({ fallback: true });
  });

  it('returns fallback on empty or undefined input', () => {
    expect(parseModelJsonResponse('', 'default')).toBe('default');
    expect(parseModelJsonResponse(undefined, 'default')).toBe('default');
  });
});

describe('buildLiveClientOptions', () => {
  const vertex = { name: 'vertex' } as unknown as GoogleGenAI;
  const aiStudio = { name: 'ai-studio' } as unknown as GoogleGenAI;

  it('keeps Vertex usable after a failure when AI Studio fallback is not permitted', () => {
    const cooldown = new VertexCooldown();
    const live = buildLiveClientOptions(vertex, aiStudio, false, cooldown, 'live-model');

    expect(live.clients).toEqual([vertex]);
    live.onClientFailed?.(vertex);
    expect(cooldown.isCoolingDown('live-model')).toBe(false);
    expect(live.skipClient?.(vertex)).toBe(false);
  });

  it('skips Vertex during its cooldown when AI Studio fallback is permitted', () => {
    const cooldown = new VertexCooldown();
    const live = buildLiveClientOptions(vertex, aiStudio, true, cooldown, 'live-model');

    expect(live.clients).toEqual([vertex, aiStudio]);
    live.onClientFailed?.(vertex);
    expect(live.skipClient?.(vertex)).toBe(true);
    expect(live.skipClient?.(aiStudio)).toBe(false);
  });
});
