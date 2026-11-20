/** HTTP routes for translation, text-to-speech and speech-to-text of Italian lines. */
import { SpeechClient } from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Type } from '@google/genai';
import { Router } from 'express';
import { BRAND } from '../data/brand';
import {
  CHAT_MODEL,
  GCP_PROJECT,
  generateContentWithFallback,
  hasGenAiCredentials,
  parseModelJsonResponse,
  TTS_MODEL
} from './genAi';
import { requireQuota } from './quota';

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

/** Which Google Cloud speech clients were created, for the operator metrics route. */
export function speechClientStatus(): { cloudTts: boolean; cloudSpeech: boolean } {
  return { cloudTts: Boolean(cloudTtsClient), cloudSpeech: Boolean(cloudSpeechClient) };
}

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

/**
 * Create the Express router for the speech helpers, mounted at /api.
 *
 * Routes: POST /translate (Italian to English), POST /tts (Cloud TTS, then
 * Gemini TTS) and POST /stt (Cloud Speech, then Gemini transcription). Each
 * counts against the daily helper-request quota.
 *
 * Returns:
 *   Configured Express Router.
 */
export function createSpeechRouter(): Router {
  const router = Router();

  // English translation of one spoken line
  router.post('/translate', requireQuota('helperRequests'), async (req, res) => {
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
  router.post('/tts', requireQuota('helperRequests'), async (req, res) => {
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

  // Production-Grade Speech-to-Text (STT) Endpoint
  router.post('/stt', requireQuota('helperRequests'), async (req, res) => {
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

  return router;
}
