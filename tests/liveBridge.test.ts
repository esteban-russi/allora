import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { LiveServerMessage } from '@google/genai';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachLiveBridge, parseLiveCallParams, toClientFrames } from '../liveBridge';

const VALID_URL = '/api/live?personaId=emmanuele&learnerLevel=B1&grammarStrictness=strict&learnerName=Giulia&sampleRate=48000';

describe('parseLiveCallParams', () => {
  it('parses a valid call query', () => {
    expect(parseLiveCallParams(VALID_URL)).toEqual({
      params: {
        personaId: 'emmanuele',
        learnerLevel: 'B1',
        grammarStrictness: 'strict',
        learnerName: 'Giulia',
        sampleRate: 48000
      }
    });
  });

  it('defaults level and strictness when they are omitted', () => {
    const parsed = parseLiveCallParams('/api/live?personaId=emmanuele&sampleRate=16000');
    expect(parsed).toMatchObject({ params: { learnerLevel: 'A2', grammarStrictness: 'tutor', learnerName: '' } });
  });

  it.each([
    ['/api/live?personaId=nobody&sampleRate=16000', /Unknown personaId/],
    ['/api/live?personaId=__proto__&sampleRate=16000', /Unknown personaId/],
    ['/api/live?personaId=emmanuele&learnerLevel=Z9&sampleRate=16000', /learnerLevel/],
    ['/api/live?personaId=emmanuele&grammarStrictness=lax&sampleRate=16000', /grammarStrictness/],
    ['/api/live?personaId=emmanuele', /sampleRate/],
    ['/api/live?personaId=emmanuele&sampleRate=96000', /sampleRate/]
  ])('rejects %s', (url, message) => {
    const parsed = parseLiveCallParams(url);
    expect(parsed).toHaveProperty('error');
    expect((parsed as { error: string }).error).toMatch(message);
  });
});

describe('toClientFrames', () => {
  it('forwards audio as binary and transcripts and turn markers as events', () => {
    const message = {
      serverContent: {
        inputTranscription: { text: 'Ciao' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([1, 2]).toString('base64') } }] },
        outputTranscription: { text: 'Salve!' },
        turnComplete: true
      }
    } as LiveServerMessage;

    expect(toClientFrames(message)).toEqual([
      { type: 'input_transcript', text: 'Ciao' },
      Buffer.from([1, 2]),
      { type: 'output_transcript', text: 'Salve!' },
      { type: 'turn_complete' }
    ]);
  });

  it('emits an interrupted event when the learner talks over the model', () => {
    const message = { serverContent: { interrupted: true } } as LiveServerMessage;
    expect(toClientFrames(message)).toEqual([{ type: 'interrupted' }]);
  });

  it('returns nothing for messages without server content', () => {
    expect(toClientFrames({ setupComplete: {} } as LiveServerMessage)).toEqual([]);
  });
});

describe('attachLiveBridge upgrade handling', () => {
  let server: Server;

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** Start a bare HTTP server with the bridge and resolve the status a WebSocket handshake gets. */
  async function handshakeStatus(path: string, headers: Record<string, string> = {}): Promise<number> {
    server = createServer();
    attachLiveBridge(server, { clients: [], model: 'test-model', trustProxyHops: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}${path}`, { headers });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('handshake unexpectedly succeeded')));
      ws.on('error', () => undefined);
    });
  }

  it('rejects invalid call parameters with 400', async () => {
    expect(await handshakeStatus('/api/live?personaId=nobody&sampleRate=16000')).toBe(400);
  });

  it('rejects cross-origin connections with 403', async () => {
    expect(await handshakeStatus(VALID_URL, { Origin: 'https://evil.example' })).toBe(403);
  });

  it('returns 503 when no Gemini credentials are configured', async () => {
    expect(await handshakeStatus(VALID_URL)).toBe(503);
  });
});
