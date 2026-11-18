/** Remembers the learner session on this device and links chat requests to it. */
import { postJson } from './apiClient';

const STORAGE_KEY = 'parliamo.learnerSessionId';

/**
 * Read the remembered learner session ID.
 *
 * Returns:
 *   The session ID, or null when none is stored or storage is unavailable.
 */
export function getLearnerSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Remember (or with null, forget) the learner session ID on this device.
 *
 * Args:
 *   sessionId: ID the server assigned, or null to start a new session next time.
 */
export function rememberLearnerSessionId(sessionId: string | null): void {
  try {
    if (sessionId) localStorage.setItem(STORAGE_KEY, sessionId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the session simply lasts for this page load
  }
}

export interface ChatRequest {
  personaId: string;
  userMessage: string;
  history?: Array<{ speaker?: string; sender?: string; text: string }>;
  temperature?: number;
  grammarStrictness?: string;
  learnerLevel?: string;
  learnerName?: string;
}

/**
 * Create a learner session on the server and remember its ID.
 *
 * Returns:
 *   The new session ID, or null if the server could not create one.
 */
async function createLearnerSession(request: ChatRequest): Promise<string | null> {
  try {
    const res = await postJson('/api/session', {
      personaId: request.personaId,
      learnerLevel: request.learnerLevel,
      grammarStrictness: request.grammarStrictness,
      learnerName: request.learnerName
    });
    if (!res.ok) return null;
    const { sessionId } = await res.json();
    if (typeof sessionId !== 'string') return null;
    rememberLearnerSessionId(sessionId);
    return sessionId;
  } catch {
    return null;
  }
}

/**
 * Send one chat turn, checkpointed to the learner session.
 *
 * Creates the session on first use. When the server reports the remembered ID as
 * unknown (expired or deleted), it is forgotten so the next turn starts a new one.
 *
 * Args:
 *   request: The chat body, without a sessionId.
 *
 * Returns:
 *   The fetch Response, as from `postJson`.
 */
export async function postChat(request: ChatRequest): Promise<Response> {
  const sessionId = getLearnerSessionId() ?? (await createLearnerSession(request));
  const res = await postJson('/api/chat', { ...request, sessionId: sessionId ?? undefined });

  if (res.ok && sessionId) {
    const body = await res.clone().json().catch(() => null);
    if (body && body.sessionId === null) rememberLearnerSessionId(null);
  }
  return res;
}
