import express from 'express';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { PERSONA_PROMPTS, LEVEL_PROMPTS, GRAMMAR_STRICTNESS_LEVELS, buildSystemInstruction } from './src/data/personaPrompts';
import type { CefrLevel } from './src/types';
import { attachLiveBridge } from './liveBridge';
import { VertexCooldown, isPersistentVertexError, summarizeError } from './vertexCooldown';
import { assertAuthConfig, authenticateHttpUser } from './src/server/auth';
import {
  defaultSessionStore,
  initializeLearnerSession,
  type ConversationTurn
} from './src/server/sessionStore';
import { createUserRateLimitMiddleware, defaultUserLimiter } from './src/server/rateLimiter';
import {
  getPrivacyPolicyConfig,
  isAiStudioFallbackPermitted,
  logPrivacyAuditNotice
} from './src/server/privacyAndPolicy';
import { defaultMetrics } from './src/server/metrics';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const GCP_PROJECT = process.env.GCP_PROJECT;
const GCP_REGION = process.env.GCP_REGION || 'europe-west2';

// Local ADC credentials carry their own quota project (often another gcloud
// project), and Google bills calls there even when a projectId is passed.
// Pin it to GCP_PROJECT unless the environment already chooses one.
if (GCP_PROJECT && !process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = GCP_PROJECT;
}

// Split models: Chat / Pedagogical Tutor vs. Audio / TTS Generation
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
// Native-audio model for real-time voice calls over the Live API
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

// Gemini is reachable through Vertex AI (GCP_PROJECT + ADC) or an AI Studio key
const HAS_GENAI_CREDENTIALS = Boolean(GCP_PROJECT || process.env.GEMINI_API_KEY);

// Behind a load balancer (e.g. Cloud Run) set TRUST_PROXY_HOPS=1 so req.ip is
// the client's address rather than the proxy's, or every user shares one limit.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS) || 0;
app.set('trust proxy', TRUST_PROXY_HOPS);

// Outer perimeter rate limiting per IP
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;
app.use(['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session'], rateLimit({
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

// Helper to create GoogleGenAI client (Vertex AI or Google AI Studio)
function createGenAiClient(preferVertex: boolean) {
  const options: Record<string, any> = {
    httpOptions: {
      headers: {
        'User-Agent': 'parliamo-italiano-gcp',
      },
    },
  };

  if (preferVertex && GCP_PROJECT) {
    options.vertexai = true;
    options.project = GCP_PROJECT;
    if (GCP_REGION && GCP_REGION !== 'global') {
      options.location = GCP_REGION;
    }
  } else if (process.env.GEMINI_API_KEY) {
    options.apiKey = process.env.GEMINI_API_KEY;
  }

  return new GoogleGenAI(options);
}

// Primary client (Vertex AI if GCP_PROJECT configured, otherwise API key)
const primaryAi = createGenAiClient(Boolean(GCP_PROJECT));
// Fallback client (Google AI Studio via GEMINI_API_KEY)
const fallbackAi = (GCP_PROJECT && process.env.GEMINI_API_KEY) ? createGenAiClient(false) : null;

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

// Vertex AI models that just failed with a configuration error (IAM, region,
// model name) are skipped for a while instead of costing a round trip per request.
const vertexCooldown = new VertexCooldown();
const hasVertexFallback = (ai: GoogleGenAI) => ai === primaryAi && fallbackAi !== null;

// Execution wrapper enforcing data privacy rules (Vertex default vs AI Studio audit)
async function generateContentWithFallback(requestConfig: any, isLearnerData = true) {
  const model = String(requestConfig.model);
  const allowAiStudio = isAiStudioFallbackPermitted(isLearnerData);

  if (allowAiStudio && fallbackAi && vertexCooldown.isCoolingDown(model)) {
    return await fallbackAi.models.generateContent(requestConfig);
  }

  try {
    return await primaryAi.models.generateContent(requestConfig);
  } catch (primaryErr: any) {
    if (!fallbackAi || !allowAiStudio) {
      if (!allowAiStudio && fallbackAi) {
        console.warn(
          `[Data Privacy] Vertex AI request failed for ${model}. AI Studio failover skipped to enforce learner privacy (vertex_only): ${summarizeError(primaryErr)}`
        );
      }
      throw primaryErr;
    }

    if (isPersistentVertexError(primaryErr)) {
      vertexCooldown.trip(model);
      console.warn(
        `[GCP Fallback] Vertex AI ${primaryErr.status} for ${model}; using AI Studio for the next ` +
          `${vertexCooldown.cooldownMinutes} min: ${summarizeError(primaryErr)}`
      );
    } else {
      console.warn(`[GCP Fallback] Vertex AI request failed, retrying with AI Studio: ${summarizeError(primaryErr)}`);
    }
    return await fallbackAi.models.generateContent(requestConfig);
  }
}

// Health check endpoint with GCP, Model, Privacy, and Operational Metrics metadata
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
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

// Authentication and per-user rate limit middleware stack for billed routes
app.use(
  ['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session'],
  authenticateHttpUser(),
  createUserRateLimitMiddleware(defaultUserLimiter)
);

// Learner Session Endpoints (Session Continuity, Checkpointing, and GDPR Deletion)
app.get('/api/session', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const session = await defaultSessionStore.getActiveUserSession(userId);
    if (!session) {
      return res.status(404).json({ error: 'No active session found for user' });
    }
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error fetching session' });
  }
});

app.post('/api/session', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const {
      sessionId,
      personaId = 'emmanuele',
      learnerName = '',
      learnerLevel = 'A2',
      grammarStrictness = 'tutor',
      savedPhrases
    } = req.body;

    let session = sessionId ? await defaultSessionStore.getSession(sessionId, userId) : null;
    if (sessionId && !session) {
      return res.status(404).json({ error: 'Session not found or not owned by user' });
    }

    if (!session) {
      session = initializeLearnerSession({
        userId,
        personaId,
        learnerName,
        learnerLevel,
        grammarStrictness
      });
    } else {
      session.personaId = personaId;
      session.learnerName = learnerName;
      session.learnerLevel = learnerLevel;
      session.grammarStrictness = grammarStrictness;
      if (Array.isArray(savedPhrases)) {
        session.progress.savedPhrases = savedPhrases;
      }
    }

    const saved = await defaultSessionStore.createOrUpdateSession(session);
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error saving session' });
  }
});

app.delete('/api/session/:sessionId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { sessionId } = req.params;
    const deleted = await defaultSessionStore.deleteSession(sessionId, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found or not owned by user' });
    }
    res.json({ status: 'deleted', sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error deleting session' });
  }
});

app.delete('/api/session', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const count = await defaultSessionStore.deleteAllUserData(userId);
    res.json({ status: 'all_data_deleted', sessionsDeleted: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error deleting user data' });
  }
});

// Gemini Conversational Chat API with Italian pedagogical grammar analysis and session checkpointing
app.post('/api/chat', async (req, res) => {

  const startTime = Date.now();
  try {
    const {
      personaId,
      history,
      userMessage,
      temperature = 0.7,
      grammarStrictness = 'tutor',
      learnerLevel = 'A2',
      learnerName,
      sessionId
    } = req.body;

    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({ error: 'Missing userMessage' });
    }
    if (userMessage.length > 2000) {
      return res.status(400).json({ error: 'userMessage exceeds maximum length of 2000 characters' });
    }

    const hasPersona = typeof personaId === 'string' && Object.hasOwn(PERSONA_PROMPTS, personaId);
    if (!hasPersona) {
      return res.status(400).json({ error: `Unknown personaId: ${String(personaId)}` });
    }
    if (!GRAMMAR_STRICTNESS_LEVELS.includes(grammarStrictness)) {
      return res.status(400).json({ error: `grammarStrictness must be one of ${GRAMMAR_STRICTNESS_LEVELS.join(', ')}` });
    }
    if (typeof learnerLevel !== 'string' || !Object.hasOwn(LEVEL_PROMPTS, learnerLevel)) {
      return res.status(400).json({ error: `learnerLevel must be one of ${Object.keys(LEVEL_PROMPTS).join(', ')}` });
    }

    if (!HAS_GENAI_CREDENTIALS) {
      return res.status(503).json({
        error: 'Neither GCP_PROJECT nor GEMINI_API_KEY is configured',
        fallbackNeeded: true
      });
    }

    const systemInstruction = buildSystemInstruction({
      personaId,
      level: learnerLevel as CefrLevel,
      grammarStrictness,
      learnerName
    });

    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h && typeof h === 'object' && typeof h.text === 'string' && h.text.trim().length > 0) {
          contents.push({
            role: h.sender === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
          });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const response = await generateContentWithFallback({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction,
        temperature: Math.min(Math.max(Number(temperature) || 0.7, 0.1), 1.2),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'Italian conversational response' },
            translation: { type: Type.STRING, description: 'Accurate English translation' },
            grammarNotes: {
              type: Type.ARRAY,
              description: 'Grammar and cultural notes',
              items: {
                type: Type.OBJECT,
                properties: {
                  wordOrPhrase: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  category: { type: Type.STRING }
                },
                required: ['wordOrPhrase', 'explanation', 'category']
              }
            }
          },
          required: ['text', 'translation', 'grammarNotes']
        }
      }
    });

    const parsed = parseModelJsonResponse(response.text, {
      text: 'Scusa, ho avuto un problema a capire. Puoi ripetere?',
      translation: 'Sorry, I had trouble understanding. Could you repeat that?',
      grammarNotes: []
    });

    // Checkpoint conversation turn to session store if sessionId provided
    const userId = req.user?.userId;
    if (sessionId && userId) {
      const turnDurationMs = Date.now() - startTime;
      const turn: ConversationTurn = {
        id: `turn_${Date.now()}`,
        sender: 'persona',
        text: parsed.text,
        translation: parsed.translation,
        grammarNotes: parsed.grammarNotes,
        timestamp: new Date().toISOString(),
        turnDurationMs
      };
      await defaultSessionStore.saveTurnCheckpoint(sessionId, userId, turn);
    }

    // Record privacy-safe lesson metrics
    defaultMetrics.recordCompletedLesson(
      Math.ceil(userMessage.length / 4),
      Math.ceil((parsed.text.length + (parsed.translation?.length || 0)) / 4),
      0
    );

    res.json(parsed);
  } catch (error: any) {
    console.error('Chat generation error:', error);
    res.status(500).json({
      error: error.message || 'Error communicating with AI model',
      fallbackNeeded: true
    });
  }
});

// English translation of one spoken line
app.post('/api/translate', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required for translation' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 2000 characters for translation' });
    }
    if (!HAS_GENAI_CREDENTIALS) {
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
app.post('/api/tts', async (req, res) => {
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
    if (!HAS_GENAI_CREDENTIALS) {
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

/**
 * Safely parse a JSON string from an LLM response, stripping optional markdown
 * code fences (```json ... ```) and returning a fallback value if parsing fails.
 */
export function parseModelJsonResponse<T>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText) return fallback;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/** Map a browser recording MIME type to a Cloud Speech-to-Text encoding, or null if unsupported. */
export function cloudSttEncodingFor(mimeType: string): 'WEBM_OPUS' | 'OGG_OPUS' | 'LINEAR16' | null {
  if (mimeType.includes('webm')) return 'WEBM_OPUS';
  if (mimeType.includes('ogg')) return 'OGG_OPUS';
  if (mimeType.includes('wav')) return 'LINEAR16';
  return null;
}

// Production-Grade Speech-to-Text (STT) Endpoint
app.post('/api/stt', async (req, res) => {
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
    if (HAS_GENAI_CREDENTIALS) {
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
                text: `You are an accurate speech-to-text transcriber for a conversational Italian learning platform ("Parliamo Italiano").
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

// 404 handler for unknown API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  assertAuthConfig();
  logPrivacyAuditNotice();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, () => {
    console.log(`Parliamo Italiano server listening on http://localhost:${PORT}`);
    console.log(`[Config] Chat Model: ${CHAT_MODEL} | TTS Model: ${TTS_MODEL} | Live Model: ${LIVE_MODEL}`);
    console.log(`[Config] GCP Project: ${GCP_PROJECT || '(none - using API key)'} | Region: ${GCP_REGION}`);
  });

  attachLiveBridge(server, {
    clients: HAS_GENAI_CREDENTIALS ? [primaryAi, fallbackAi].filter((ai): ai is GoogleGenAI => ai !== null) : [],
    model: LIVE_MODEL,
    trustProxyHops: TRUST_PROXY_HOPS,
    skipClient: (ai) => {
      if (ai === fallbackAi && !isAiStudioFallbackPermitted(true)) return true;
      return hasVertexFallback(ai) && vertexCooldown.isCoolingDown(LIVE_MODEL);
    },
    onClientFailed: (ai) => {
      if (hasVertexFallback(ai)) vertexCooldown.trip(LIVE_MODEL);
    },
  });
}

// Tests import `app` and drive it with supertest, so don't bind a port or load Vite there
if (!process.env.VITEST) {
  startServer();
}

export { app };
