/** Tests for server-side premium tutor access enforcement across HTTP and Live endpoints. */
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

vi.mock('../src/data/personaPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/personaPrompts')>();
  const testPremiumId = 'test-premium';
  const testPremiumIds: readonly string[] = [testPremiumId];
  return {
    ...actual,
    PERSONA_PROMPTS: {
      ...actual.PERSONA_PROMPTS,
      [testPremiumId]: 'Test premium tutor prompt.'
    },
    PERSONA_VOICES: {
      ...actual.PERSONA_VOICES,
      [testPremiumId]: 'Kore'
    },
    PREMIUM_PERSONA_IDS: testPremiumIds,
    isPremiumPersona: (id: string, premiumIds: readonly string[] = testPremiumIds) =>
      actual.isPremiumPersona(id, premiumIds)
  };
});

import { app } from '../server';
import { primaryAi } from '../src/server/genAi';
import { invalidateAccountCache } from '../src/server/accountMiddleware';
import { InMemoryAccountStore, type Subscription } from '../src/server/accountStore';
import { defaultAccountStore } from '../src/server/defaultAccountStore';
import { defaultUsageStore } from '../src/server/defaultUsageStore';
import { canUsePersona, PREMIUM_REQUIRED_BODY, requirePersonaAccess } from '../src/server/personaAccess';
import { requireQuota } from '../src/server/quota';
import { InMemoryUsageStore, usageDay } from '../src/server/usageStore';
import { fakeGemini, openCall, startBridgeServer, type TestCall } from './helpers/fakeGemini';

const TEST_PREMIUM_ID = 'test-premium';

const ACTIVE_SUB: Subscription = {
  status: 'active',
  productId: 'allora_pro_annual',
  store: 'web',
  periodType: 'normal',
  expiresAt: '2099-01-01T00:00:00.000Z',
  willRenew: true,
  updatedAt: '2026-11-19T00:00:00.000Z'
};

async function seedPremiumAccount(userId: string): Promise<void> {
  await defaultAccountStore.upsertFromAuth({ userId, email: `${userId}@example.com`, isAnonymous: false });
  await defaultAccountStore.setSubscription(userId, ACTIVE_SUB);
  invalidateAccountCache(userId);
}

describe('canUsePersona', () => {
  const injectedPremiumIds = ['injected-premium'];

  it('denies guest and free tiers for a premium tutor', () => {
    expect(canUsePersona('guest', 'injected-premium', injectedPremiumIds)).toBe(false);
    expect(canUsePersona('free', 'injected-premium', injectedPremiumIds)).toBe(false);
  });

  it('allows premium tier for a premium tutor', () => {
    expect(canUsePersona('premium', 'injected-premium', injectedPremiumIds)).toBe(true);
  });

  it('always allows a free tutor across every tier', () => {
    expect(canUsePersona('guest', 'emmanuele', injectedPremiumIds)).toBe(true);
    expect(canUsePersona('free', 'emmanuele', injectedPremiumIds)).toBe(true);
    expect(canUsePersona('premium', 'emmanuele', injectedPremiumIds)).toBe(true);
  });
});

describe('requirePersonaAccess middleware ordering', () => {
  it('blocks a free user before requireQuota consumes a chat message', async () => {
    const usageStore = new InMemoryUsageStore();
    const clock = Date.parse('2026-11-19T12:00:00.000Z');
    const miniApp = express();
    miniApp.use(express.json());
    miniApp.use((req, _res, next) => {
      req.user = { userId: 'u-free', isAnonymous: false, authProvider: 'dev' };
      req.account = {
        account: {
          userId: 'u-free',
          email: null,
          isAnonymous: false,
          subscription: null,
          consent: null,
          createdAt: '2026-11-19T12:00:00.000Z',
          lastSeenAt: '2026-11-19T12:00:00.000Z'
        },
        tier: 'free',
        limits: { chatMessages: 1, voiceSeconds: 300, helperRequests: 100 }
      };
      next();
    });
    miniApp.post(
      '/chat',
      requirePersonaAccess([TEST_PREMIUM_ID]),
      requireQuota('chatMessages', { store: usageStore, mode: 'enforce', now: () => clock }),
      (_req, res) => {
        res.json({ ok: true });
      }
    );

    const denied = await request(miniApp).post('/chat').send({ personaId: TEST_PREMIUM_ID });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual(PREMIUM_REQUIRED_BODY);

    const usage = await usageStore.getUsage('u-free', usageDay(clock));
    expect(usage.chatMessages).toBe(0);
  });
});

describe('HTTP endpoint enforcement (/api/session, /api/chat, /api/tts)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects free user creating or updating a session with a premium tutor', async () => {
    const userId = 'pa-session-free';
    const createDenied = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', userId)
      .send({ personaId: TEST_PREMIUM_ID, learnerName: 'Luca', learnerLevel: 'A2' });

    expect(createDenied.status).toBe(403);
    expect(createDenied.body).toEqual(PREMIUM_REQUIRED_BODY);

    const createdFree = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', userId)
      .send({ personaId: 'emmanuele', learnerName: 'Luca', learnerLevel: 'A2' });
    expect(createdFree.status).toBe(200);

    const updateDenied = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', userId)
      .send({
        sessionId: createdFree.body.sessionId,
        personaId: TEST_PREMIUM_ID,
        learnerName: 'Luca',
        learnerLevel: 'A2'
      });
    expect(updateDenied.status).toBe(403);
    expect(updateDenied.body).toEqual(PREMIUM_REQUIRED_BODY);
  });

  it('allows premium user creating and updating a session with a premium tutor', async () => {
    const userId = 'pa-session-premium';
    await seedPremiumAccount(userId);

    const created = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', userId)
      .send({ personaId: TEST_PREMIUM_ID, learnerName: 'Sofia', learnerLevel: 'B1' });
    expect(created.status).toBe(200);
    expect(created.body.personaId).toBe(TEST_PREMIUM_ID);

    const updated = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', userId)
      .send({
        sessionId: created.body.sessionId,
        personaId: TEST_PREMIUM_ID,
        learnerName: 'Sofia',
        learnerLevel: 'B2'
      });
    expect(updated.status).toBe(200);
    expect(updated.body.learnerLevel).toBe('B2');
  });

  it('rejects free user on POST /api/chat with a premium tutor without consuming quota', async () => {
    vi.stubEnv('QUOTAS_MODE', 'enforce');
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    const spy = vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ text: 'Ciao!', translation: 'Hi!', grammarNotes: [] })
    } as any);

    const userId = 'pa-chat-free';
    const day = usageDay(Date.now());

    const res = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', userId)
      .send({ personaId: TEST_PREMIUM_ID, userMessage: 'Ciao!' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PREMIUM_REQUIRED_BODY);
    expect(spy).not.toHaveBeenCalled();

    const usage = await defaultUsageStore.getUsage(userId, day);
    expect(usage.chatMessages).toBe(0);
  });

  it('allows premium user with a premium tutor and free user with Emmanuele on POST /api/chat', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ text: 'Ciao!', translation: 'Hi!', grammarNotes: [] })
    } as any);

    const proUserId = 'pa-chat-premium';
    await seedPremiumAccount(proUserId);

    const proRes = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', proUserId)
      .send({ personaId: TEST_PREMIUM_ID, userMessage: 'Ciao!' });
    expect(proRes.status).toBe(200);

    const freeRes = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', 'pa-chat-free-emmanuele')
      .send({ personaId: 'emmanuele', userMessage: 'Ciao!' });
    expect(freeRes.status).toBe(200);
  });

  it('does not restrict /api/tts for free users (voice samples remain accessible)', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: 'UklGRg==' } }] } }]
    } as any);

    const res = await request(app)
      .post('/api/tts')
      .set('x-dev-user-id', 'pa-tts-free')
      .send({ text: 'Ciao a tutti!', voiceName: 'Kore', gender: 'female' });

    expect(res.status).toBe(200);
    expect(res.body.audioBase64).toBe('UklGRg==');
  });
});

describe('Live bridge upgrade enforcement (/api/live)', () => {
  let server: Server | null = null;
  let calls: TestCall[] = [];

  beforeEach(() => {
    calls = [];
  });

  afterEach(async () => {
    for (const c of calls) {
      if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) {
        c.ws.close();
      }
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  function rejectUpgradeRequest(port: number, query: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}${query}`);
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      ws.on('error', () => undefined);
    });
  }

  it.each(['off', 'enforce'] as const)(
    'rejects free user on /api/live with 403 PREMIUM_REQUIRED for a premium tutor (quotasMode=%s)',
    async (mode) => {
      const gemini = fakeGemini();
      const accountStore = new InMemoryAccountStore();
      await accountStore.upsertFromAuth({ userId: 'live-free-user', isAnonymous: false });

      ({ server } = await startBridgeServer({
        clients: [gemini.ai],
        accountStore,
        quotasMode: mode,
        premiumPersonaIds: [TEST_PREMIUM_ID]
      }));
      const port = (server.address() as AddressInfo).port;

      const rejected = await rejectUpgradeRequest(
        port,
        `/api/live?personaId=${TEST_PREMIUM_ID}&sampleRate=16000&devUserId=live-free-user`
      );
      expect(rejected.status).toBe(403);
      expect(JSON.parse(rejected.body)).toEqual({ error: 'PREMIUM_REQUIRED' });
      expect(gemini.sessions).toHaveLength(0);
    }
  );

  it('allows premium user on /api/live for a premium tutor and free user for Emmanuele', async () => {
    const gemini = fakeGemini();
    const accountStore = new InMemoryAccountStore();
    await accountStore.upsertFromAuth({ userId: 'live-pro-user', isAnonymous: false });
    await accountStore.setSubscription('live-pro-user', ACTIVE_SUB);
    await accountStore.upsertFromAuth({ userId: 'live-free-emm', isAnonymous: false });

    ({ server } = await startBridgeServer({
      clients: [gemini.ai],
      accountStore,
      quotasMode: 'enforce',
      premiumPersonaIds: [TEST_PREMIUM_ID]
    }));
    const port = (server.address() as AddressInfo).port;

    const proCall = openCall(
      port,
      `/api/live?personaId=${TEST_PREMIUM_ID}&sampleRate=16000&devUserId=live-pro-user`
    );
    calls.push(proCall);
    await proCall.waitForEvent('ready');

    const freeCall = openCall(
      port,
      '/api/live?personaId=emmanuele&sampleRate=16000&devUserId=live-free-emm'
    );
    calls.push(freeCall);
    await freeCall.waitForEvent('ready');

    expect(gemini.sessions).toHaveLength(2);
  });
});
