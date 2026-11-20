/** Tests for model safety settings, prompt safety instructions, and blocked chat replies. */
import { BlockedReason, FinishReason, HarmBlockThreshold, HarmCategory } from '@google/genai';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server';
import { primaryAi } from '../src/server/genAi';
import {
  buildSystemInstruction,
  buildVoiceCallInstruction,
  SAFETY_INSTRUCTION
} from '../src/data/personaPrompts';
import { BLOCKED_REPLY_TEXT } from '../src/server/chatRoutes';
import { isBlockedGeminiResponse, MODEL_SAFETY_SETTINGS } from '../src/server/modelSafety';
import { fakeGemini, openCall, startBridgeServer } from './helpers/fakeGemini';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('MODEL_SAFETY_SETTINGS and prompt instructions', () => {
  it('configures BLOCK_MEDIUM_AND_ABOVE for all four required harm categories', () => {
    expect(MODEL_SAFETY_SETTINGS).toEqual([
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      }
    ]);
  });

  it('appends the safety paragraph to both chat and voice system instructions', () => {
    const chatPrompt = buildSystemInstruction({ personaId: 'emmanuele', level: 'A2' });
    const voicePrompt = buildVoiceCallInstruction({ personaId: 'emmanuele', level: 'A2' });

    expect(chatPrompt).toContain(SAFETY_INSTRUCTION);
    expect(voicePrompt).toContain(SAFETY_INSTRUCTION);
  });

  it('detects blocked responses across blockReason, finishReason, and missing text', () => {
    expect(isBlockedGeminiResponse({ text: '{"text":"Ciao"}' })).toBe(false);
    expect(isBlockedGeminiResponse({ text: '' })).toBe(true);
    expect(isBlockedGeminiResponse({ text: undefined })).toBe(true);
    expect(
      isBlockedGeminiResponse({
        text: '{"text":"partial"}',
        promptFeedback: { blockReason: BlockedReason.SAFETY }
      })
    ).toBe(true);
    expect(
      isBlockedGeminiResponse({
        text: '{"text":"partial"}',
        candidates: [{ finishReason: FinishReason.SAFETY }]
      })
    ).toBe(true);
    expect(
      isBlockedGeminiResponse({
        candidates: [{ finishReason: FinishReason.PROHIBITED_CONTENT }]
      })
    ).toBe(true);
  });
});

describe('POST /api/chat safety handling', () => {
  const payload = { personaId: 'emmanuele', userMessage: 'Ciao!' };

  it('passes MODEL_SAFETY_SETTINGS to Gemini on chat requests', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    const spy = vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ text: 'Ciao!', translation: 'Hi!', grammarNotes: [] })
    } as any);

    const res = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', 'u-safety-ok')
      .send(payload);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          safetySettings: MODEL_SAFETY_SETTINGS
        })
      })
    );
  });

  it.each([
    ['no text', { text: undefined }],
    ['empty text', { text: '   ' }],
    ['promptFeedback.blockReason SAFETY', { promptFeedback: { blockReason: BlockedReason.SAFETY } }],
    [
      'candidate finishReason SAFETY',
      { text: '{"text":"unsafe"}', candidates: [{ finishReason: FinishReason.SAFETY }] }
    ],
    [
      'candidate finishReason PROHIBITED_CONTENT',
      { candidates: [{ finishReason: FinishReason.PROHIBITED_CONTENT }] }
    ]
  ])('returns 200 with fixed Italian decline and empty translation when blocked (%s)', async (_label, response) => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue(response as any);

    const res = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', 'u-safety-block')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.text).toBe(BLOCKED_REPLY_TEXT);
    expect(res.body.translation).toBe('');
    expect(res.body.grammarNotes).toEqual([]);
  });

  it('still returns 500 when Gemini throws a real error', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(primaryAi.models, 'generateContent').mockRejectedValue(new Error('Upstream timeout'));

    const res = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', 'u-safety-err')
      .send(payload);

    expect(res.status).toBe(500);
    expect(res.body.fallbackNeeded).toBe(true);
  });
});

describe('Live bridge safety settings', () => {
  it('passes MODEL_SAFETY_SETTINGS and safety instruction in LiveConnectConfig', async () => {
    const { ai, sessions } = fakeGemini();
    const { server, port } = await startBridgeServer({ clients: [ai] });
    const call = openCall(port, '/api/live?personaId=emmanuele&sampleRate=16000');

    try {
      await call.waitForEvent('ready');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].config.safetySettings).toEqual(MODEL_SAFETY_SETTINGS);
      expect(String(sessions[0].config.systemInstruction)).toContain(SAFETY_INSTRUCTION);
    } finally {
      call.ws.close();
      await call.closed;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
