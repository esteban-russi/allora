import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { Type } from '@google/genai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { attachLiveBridge } from './src/server/liveBridge';
import { summarizeError } from './src/server/vertexCooldown';
import {
  CHAT_MODEL,
  GCP_PROJECT,
  GCP_REGION,
  LIVE_MODEL,
  TTS_MODEL,
  buildLiveClientOptions,
  fallbackAi,
  generateContentWithFallback,
  hasGenAiCredentials,
  parseModelJsonResponse,
  primaryAi,
  vertexCooldown
} from './src/server/genAi';
import { assertAuthConfig, authenticateHttpUser, isAuthEnforced } from './src/server/auth';
import { requireAppCheck } from './src/server/appCheck';
import { defaultSessionStore } from './src/server/defaultSessionStore';
import { attachAccount } from './src/server/accountMiddleware';
import { defaultAccountStore } from './src/server/defaultAccountStore';
import { defaultUsageStore } from './src/server/defaultUsageStore';
import { nextResetAt, usageDay } from './src/server/usageStore';
import { requireQuota } from './src/server/quota';
import { createUserRateLimitMiddleware, defaultUserLimiter } from './src/server/rateLimiter';
import {
  getPrivacyPolicyConfig,
  isAiStudioFallbackPermitted,
  logPrivacyAuditNotice
} from './src/server/privacyAndPolicy';
import { defaultMetrics } from './src/server/metrics';
import { scheduleMaintenance } from './src/server/maintenance';
import type { FirebaseClientConfig } from './src/utils/firebaseAuth';
import { createAccountRouter } from './src/server/accountRoutes';
import { createBillingRouter, createRevenueCatWebhookRouter } from './src/server/billingRoutes';
import { createReportRouter } from './src/server/reportRoutes';
import { createSessionRouter } from './src/server/sessionRoutes';
import { createChatRouter } from './src/server/chatRoutes';
import { BRAND } from './src/data/brand';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// Redirect browser page loads from secondary hosts (e.g. *.run.app) to APP_URL in production.
// API, WebSocket and .well-known requests are never redirected.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || req.method !== 'GET') return next();
  const rawAppUrl = process.env.APP_URL?.trim();
  if (!rawAppUrl) return next();

  let canonical: URL;
  try {
    canonical = new URL(rawAppUrl);
  } catch {
    return next();
  }
  if (canonical.protocol !== 'http:' && canonical.protocol !== 'https:') return next();

  if (
    req.path === '/api' ||
    req.path.startsWith('/api/') ||
    req.path === '/.well-known' ||
    req.path.startsWith('/.well-known/')
  ) {
    return next();
  }

  const requestHost = req.get('host')?.trim().toLowerCase();
  if (!requestHost || requestHost === canonical.host.toLowerCase()) return next();

  return res.redirect(308, `${canonical.origin}${req.originalUrl}`);
});
const PORT = process.env.PORT || 3000;

// Behind a load balancer (e.g. Cloud Run) set TRUST_PROXY_HOPS=1 so req.ip is
// the client's address rather than the proxy's, or every user shares one limit.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS) || 0;
app.set('trust proxy', TRUST_PROXY_HOPS);

// Outer perimeter rate limiting per IP. Webhooks are left out: RevenueCat can send
// bursts of events from a few IPs, and its secret is checked before any work is done.
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;
app.use(['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session', '/api/me', '/api/account', '/api/billing', '/api/report'], rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down', fallbackToBrowser: true },
}));

// Only STT uploads base64 audio; every other route gets a small body cap.
// Registered first so the global parser below skips already-parsed bodies.
app.use('/api/stt', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '1mb' }));

// Google Cloud Text-to-Speech and Speech-to-Text clients. Only created for an
// explicit GCP_PROJECT, so a missing setting never falls through to whatever
// project the local gcloud credentials default to.
let cloudTtsClient: TextToSpeechClient | null = null;
let cloudSpeechClient: SpeechClient | null = null;
if (GCP_PROJECT) {
  try {
    cloudTtsClient = new TextToSpeechClient({ projectId: GCP_PROJECT });
  } catch (err: any) {
    console.warn('[GCP TTS] Could not initialize TextToSpeechClient:', err.message);
  }
  try {
    cloudSpeechClient = new SpeechClient({ projectId: GCP_PROJECT });
  } catch (err: any) {
    console.warn('[GCP STT] Could not initialize SpeechClient:', err.message);
  }
}

// Public liveness check; operational details live on /api/metrics (operators only)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Build the public Firebase web config the client needs for anonymous sign-in.
 *
 * Args:
 *   env: Environment to read FIREBASE_API_KEY, FIREBASE_APP_ID, GCP_PROJECT and the
 *     optional FIREBASE_AUTH_DOMAIN from.
 *
 * Returns:
 *   The config, or null when sign-in is not configured (the client then sends no token).
 */
export function buildFirebaseClientConfig(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig | null {
  const apiKey = env.FIREBASE_API_KEY?.trim();
  const appId = env.FIREBASE_APP_ID?.trim();
  const projectId = env.GCP_PROJECT?.trim();
  if (!apiKey || !appId || !projectId) return null;
  const authDomain = env.FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com`;
  const appCheckSiteKey = env.FIREBASE_APPCHECK_SITE_KEY?.trim() || null;
  return { apiKey, authDomain, projectId, appId, appCheckSiteKey };
}

// Firebase web config is public by design; serving it at runtime keeps it out of the image build
app.get('/api/auth-config', (_req, res) => {
  const rcKey = process.env.REVENUECAT_WEB_PUBLIC_KEY?.trim() || null;
  res.json({
    firebase: buildFirebaseClientConfig(),
    billing: {
      revenueCatWebKey: rcKey
    }
  });
});

// Webhook endpoints (not behind user authentication)
app.use('/api/webhooks', createRevenueCatWebhookRouter());

// App Check, authentication, and per-user rate limit middleware stack for billed routes
app.use(
  ['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session', '/api/me', '/api/account', '/api/billing', '/api/report'],
  requireAppCheck(),
  authenticateHttpUser(),
  createUserRateLimitMiddleware(defaultUserLimiter),
  attachAccount(defaultAccountStore)
);

/**
 * Decide whether a user may read operational metrics.
 *
 * Args:
 *   userId: Authenticated user ID.
 *
 * Returns:
 *   True for IDs in METRICS_ADMIN_USER_IDS (comma separated), or anyone when auth is not enforced.
 */
export function canReadMetrics(userId: string): boolean {
  if (!isAuthEnforced()) return true;
  const admins = (process.env.METRICS_ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return admins.includes(userId);
}

// Operational metrics, runtime configuration, and privacy mode: operators only, unlike /api/health
app.get('/api/metrics', authenticateHttpUser(), (req, res) => {
  if (!canReadMetrics(req.user!.userId)) {
    return res.status(403).json({ error: 'Metrics are restricted to operators' });
  }
  res.json({
    billing: Boolean(process.env.REVENUECAT_SECRET_KEY),
    models: {
      chat: CHAT_MODEL,
      tts: TTS_MODEL,
      live: LIVE_MODEL,
    },
    gcp: {
      region: GCP_REGION,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasGcpProject: Boolean(GCP_PROJECT),
      clients: {
        vertexAi: Boolean(GCP_PROJECT),
        aiStudio: Boolean(process.env.GEMINI_API_KEY),
        cloudTts: Boolean(cloudTtsClient),
        cloudSpeech: Boolean(cloudSpeechClient),
      }
    },
    privacy: getPrivacyPolicyConfig(),
    metrics: defaultMetrics.getSummary()
  });
});

// Learner profile and account metadata
app.get('/api/me', async (req, res) => {
  try {
    const { account, tier, limits } = req.account!;
    const nowMs = Date.now();
    const usage = await defaultUsageStore.getUsage(account.userId, usageDay(nowMs));
    const resetsAt = nextResetAt(nowMs);
    res.json({
      userId: account.userId,
      email: account.email,
      isAnonymous: account.isAnonymous,
      tier,
      limits,
      usage,
      resetsAt,
      consent: account.consent,
      subscription: account.subscription && {
        status: account.subscription.status,
        productId: account.subscription.productId,
        store: account.subscription.store,
        periodType: account.subscription.periodType,
        expiresAt: account.subscription.expiresAt,
        willRenew: account.subscription.willRenew,
        managementUrl: account.subscription.managementUrl ?? null
      }
    });
  } catch (err: unknown) {
    console.error('[Account] Error fetching usage for /api/me:', summarizeError(err));
    res.status(500).json({ error: 'Error fetching account details' });
  }
});

// Account lifecycle routes (guest merge and account deletion)
app.use('/api/account', createAccountRouter());

// Billing routes (subscription sync)
app.use('/api/billing', createBillingRouter());

// Content reporting route
app.use('/api/report', createReportRouter());

// Learner session routes (continuity, checkpoints and GDPR deletion)
app.use('/api/session', createSessionRouter());

// Tutor chat: one turn with grammar notes, checkpointed to the learner session
app.use('/api/chat', createChatRouter());


// English translation of one spoken line
app.post('/api/translate', requireQuota('helperRequests'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required for translation' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 2000 characters for translation' });
    }
    if (!hasGenAiCredentials()) {
      return res.status(503).json({ error: 'Neither GCP_PROJECT nor GEMINI_API_KEY is configured' });
    }

    const response = await generateContentWithFallback({
      model: CHAT_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        systemInstruction: 'Translate the Italian text the user sends into natural English. Reply with the translation only.',
        temperature: 0.2,
      }
    });

    res.json({ translation: response.text?.trim() ?? '' });
  } catch (error: any) {
    console.error('Translation error:', error);
    res.status(500).json({ error: error.message || 'Translation failed' });
  }
});

// Text-to-Speech (TTS) Endpoint supporting both Google Cloud TTS & Gemini Native Audio
app.post('/api/tts', requireQuota('helperRequests'), async (req, res) => {
  try {
    const { 
      text, 
      voiceName = 'Fenrir', 
      provider = 'gemini_live',
      rate = 1.0, 
      pitch = 0.0,
      gender = 'male' 
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 2000 characters for TTS' });
    }

    // 1. Google Cloud Text-to-Speech (Neural2 / Journey voices)
    const isCloudTtsRequested = provider === 'gcp_cloud_tts' || (typeof voiceName === 'string' && voiceName.startsWith('it-IT-'));
    if (isCloudTtsRequested && cloudTtsClient) {
      try {
        const isFemale = gender === 'female' || voiceName.includes('Neural2-A') || voiceName.includes('Journey-F');
        const targetVoice = voiceName && voiceName.startsWith('it-IT-') 
          ? voiceName 
          : (isFemale ? 'it-IT-Neural2-A' : 'it-IT-Neural2-C');

        const [gcpResponse] = await cloudTtsClient.synthesizeSpeech({
          input: { text },
          voice: {
            languageCode: 'it-IT',
            name: targetVoice,
            ssmlGender: (isFemale ? 'FEMALE' : 'MALE') as any,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: Math.min(Math.max(Number(rate) || 1.0, 0.25), 4.0),
            pitch: Math.min(Math.max(Number(pitch) || 0.0, -20.0), 20.0),
          },
        });

        if (gcpResponse.audioContent) {
          const audioBase64 = Buffer.from(gcpResponse.audioContent as Uint8Array).toString('base64');
          return res.json({
            audioBase64,
            mimeType: 'audio/mp3',
            voiceUsed: targetVoice,
            provider: 'gcp_cloud_tts'
          });
        }
      } catch (cloudErr: any) {
        console.warn('[GCP TTS] Google Cloud Text-to-Speech failed, falling back to Gemini TTS:', cloudErr.message);
      }
    }

    // 2. Gemini Native Multimodal Audio Generation
    if (!hasGenAiCredentials()) {
      return res.status(503).json({
        error: 'No AI credentials configured for Gemini TTS',
        fallbackToBrowser: true
      });
    }

    const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    let selectedVoice = voiceName;
    if (!allowedVoices.includes(selectedVoice)) {
      selectedVoice = voiceName.includes('Kore') ? 'Kore' :
                      voiceName.includes('Puck') ? 'Puck' :
                      voiceName.includes('Charon') ? 'Charon' :
                      voiceName.includes('Zephyr') ? 'Zephyr' : 'Fenrir';
    }

    const response = await generateContentWithFallback({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text,
              speechMetadata: {
                style: 'Natural and expressive native Italian conversational speaker'
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }
          }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      return res.status(500).json({
        error: 'No audio generated by Gemini',
        fallbackToBrowser: true
      });
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      voiceUsed: selectedVoice,
      provider: 'gemini_live'
    });
  } catch (error: any) {
    console.error('TTS generation error:', error);
    res.status(500).json({
      error: error.message || 'TTS generation failed',
      fallbackToBrowser: true
    });
  }
});

/** Strip any `data:...;base64,` prefix from an incoming base64 payload. */
export function stripBase64DataUrlPrefix(payload: string): string {
  return payload.includes(',') ? payload.split(',')[1] : payload;
}

/** Map a browser recording MIME type to a Cloud Speech-to-Text encoding, or null if unsupported. */
export function cloudSttEncodingFor(mimeType: string): 'WEBM_OPUS' | 'OGG_OPUS' | 'LINEAR16' | null {
  if (mimeType.includes('webm')) return 'WEBM_OPUS';
  if (mimeType.includes('ogg')) return 'OGG_OPUS';
  if (mimeType.includes('wav')) return 'LINEAR16';
  return null;
}

// Production-Grade Speech-to-Text (STT) Endpoint
app.post('/api/stt', requireQuota('helperRequests'), async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', languageCode = 'it-IT' } = req.body;

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing audioBase64 in request body' });
    }

    const cleanBase64 = stripBase64DataUrlPrefix(audioBase64);

    const cloudEncoding = cloudSttEncodingFor(mimeType);
    if (cloudSpeechClient && cloudEncoding) {
      try {
        const [gcpSpeechResponse] = await cloudSpeechClient.recognize({
          audio: { content: cleanBase64 },
          config: {
            languageCode,
            alternativeLanguageCodes: ['en-US'],
            enableAutomaticPunctuation: true,
            encoding: cloudEncoding,
            ...(cloudEncoding === 'LINEAR16' ? {} : { sampleRateHertz: 48000 }),
          }
        });

        const transcript = gcpSpeechResponse.results
          ?.map((r: any) => r.alternatives?.[0]?.transcript)
          .filter(Boolean)
          .join(' ')
          .trim();

        if (transcript) {
          return res.json({
            transcript,
            provider: 'gcp_cloud_speech'
          });
        }
      } catch (cloudSttErr: any) {
        console.warn('[GCP STT] Cloud Speech-to-Text failed, falling back to Gemini Multimodal STT:', cloudSttErr.message);
      }
    }

    // 2. Multimodal Audio Transcription via Gemini
    if (hasGenAiCredentials()) {
      const cleanMimeType = mimeType.split(';')[0] || 'audio/webm';
      const geminiResponse = await generateContentWithFallback({
        model: CHAT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: cleanMimeType,
                  data: cleanBase64
                }
              },
              {
                text: `You are an accurate speech-to-text transcriber for a conversational Italian learning platform ("${BRAND.name}").
Transcribe the speaker's audio verbatim. 
The student is speaking Italian (or attempting to speak Italian, with possible learner accents or brief English words).
Do NOT reply with conversation, commentary, or corrections.
Return ONLY a valid JSON object matching this schema:
{
  "transcript": "Exact transcribed speech"
}`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: { type: Type.STRING, description: 'Verbatim transcribed speech' }
            },
            required: ['transcript']
          }
        }
      });

      const parsed = parseModelJsonResponse(geminiResponse.text, { transcript: '' });

      return res.json({
        transcript: parsed.transcript || '',
        provider: 'gemini_multimodal_stt'
      });
    }

    res.status(503).json({ error: 'No STT backend providers available' });
  } catch (error: any) {
    console.error('STT processing error:', error);
    res.status(500).json({
      error: error.message || 'Speech-to-text transcription failed'
    });
  }
});

// 404 handler for unknown API routes (registered before the SPA fallback)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/** Mount production static asset and SPA routes with immutable caching for /assets and no-cache for index.html. */
export function registerStaticRoutes(targetApp: express.Express, distDir: string): void {
  targetApp.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), { maxAge: '1y', immutable: true })
  );
  targetApp.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  targetApp.get(['/privacy', '/terms', '/delete-account'], (req, res) => {
    const page = req.path.replace(/^\/+|\/+$/g, '').toLowerCase();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, `${page}.html`));
  });
  targetApp.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  assertAuthConfig();
  logPrivacyAuditNotice();
  scheduleMaintenance(defaultSessionStore, defaultUserLimiter);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    registerStaticRoutes(app, path.join(__dirname, 'dist'));
  }

  const server = app.listen(PORT, () => {
    console.log(`${BRAND.name} server listening on http://localhost:${PORT}`);
    console.log(`[Config] Chat Model: ${CHAT_MODEL} | TTS Model: ${TTS_MODEL} | Live Model: ${LIVE_MODEL}`);
    console.log(`[Config] GCP Project: ${GCP_PROJECT || '(none - using API key)'} | Region: ${GCP_REGION}`);
  });

  attachLiveBridge(server, {
    ...(hasGenAiCredentials()
      ? buildLiveClientOptions(primaryAi, fallbackAi, isAiStudioFallbackPermitted(true), vertexCooldown, LIVE_MODEL)
      : { clients: [] }),
    model: LIVE_MODEL,
    trustProxyHops: TRUST_PROXY_HOPS,
  });
}

// Tests import `app` and drive it with supertest, so don't bind a port or load Vite there
if (!process.env.VITEST) {
  startServer();
}

export { app };
