import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../server';
import { cloudSttEncodingFor, stripBase64DataUrlPrefix } from '../src/server/speechRoutes';

describe('stripBase64DataUrlPrefix', () => {
  it.each([
    ['data:audio/webm;codecs=opus;base64,GkXfo59ChoEB', 'GkXfo59ChoEB'],
    ['data:audio/ogg;codecs=opus;base64,T2dnUwACAA', 'T2dnUwACAA'],
    ['data:audio/wav;base64,UklGRi4AAABXQVZF', 'UklGRi4AAABXQVZF'],
    ['GkXfo59ChoEB', 'GkXfo59ChoEB'],
  ])('strips prefix from %s', (input, expected) => {
    expect(stripBase64DataUrlPrefix(input)).toBe(expected);
  });
});

describe('cloudSttEncodingFor', () => {
  it.each([
    ['audio/webm;codecs=opus', 'WEBM_OPUS'],
    ['audio/ogg;codecs=opus', 'OGG_OPUS'],
    ['audio/wav', 'LINEAR16'],
    ['audio/mp4', null],
    ['audio/aac', null],
  ])('maps %s to %s', (mimeType, expected) => {
    expect(cloudSttEncodingFor(mimeType)).toBe(expected);
  });
});

describe('POST /api/translate validation', () => {
  it('rejects a request without text', async () => {
    const res = await request(app).post('/api/translate').send({});
    expect(res.status).toBe(400);
  });

  it('rejects text longer than 2000 characters', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum length/);
  });

  it('returns 503 when no Gemini credentials are configured', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'Ciao' });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/tts and /api/stt validation', () => {
  it('rejects TTS without text', async () => {
    const res = await request(app).post('/api/tts').send({});
    expect(res.status).toBe(400);
  });

  it('rejects TTS text longer than 2000 characters', async () => {
    const res = await request(app).post('/api/tts').send({ text: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum length/);
  });

  it('rejects STT without audio', async () => {
    const res = await request(app).post('/api/stt').send({ mimeType: 'audio/webm' });
    expect(res.status).toBe(400);
  });
});
