/** Remembers the learner session on this device, restores it on load, and links chat requests to it. */
import type { ClientLearnerSession, ConversationTurn, SessionSummary } from '../server/sessionStore';
import type { CefrLevel, ChatMessage, GrammarNote, LearnerProfile, SavedPhrase } from '../types';
import { deleteWithAuth, getWithAuth, postJson } from '../../platform/client/apiClient';
import { readQuotaError, type QuotaError } from '../../platform/client/quotaError';
import type { HabitSummary } from '../server/habitStore';
import { celebrateGoalMet, notifyHabits } from './habitsClient';

const STORAGE_KEY = 'parliamo.learnerSessionId';
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
const NOTE_CATEGORIES: GrammarNote['category'][] = ['verb', 'idiom', 'grammar', 'vocabulary', 'cultural'];

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

/** What the learner chose in onboarding, plus their notebook. */
export interface LearnerSettings {
  profile: LearnerProfile;
  grammarStrictness: string;
  savedPhrases: SavedPhrase[];
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

/** A session being created by onboarding; chat and settings wait for it so they never make a second one. */
let pendingStart: Promise<string | null> | null = null;

function settingsBody(settings: LearnerSettings) {
  return {
    personaId: settings.profile.personaId,
    learnerName: settings.profile.name,
    learnerLevel: settings.profile.level,
    grammarStrictness: settings.grammarStrictness,
    savedPhrases: settings.savedPhrases
  };
}

/** POST /api/session and remember the returned ID; null on any failure. */
async function postSession(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await postJson('/api/session', body);
    if (!res.ok) return null;
    const { sessionId } = await res.json();
    if (typeof sessionId !== 'string') return null;
    rememberLearnerSessionId(sessionId);
    return sessionId;
  } catch {
    return null;
  }
}

async function settledSessionId(): Promise<string | null> {
  if (pendingStart) await pendingStart;
  return getLearnerSessionId();
}

/**
 * Start a new learner session (a new conversation) with these settings.
 *
 * Args:
 *   settings: Profile, grammar strictness and saved phrases for the session.
 *
 * Returns:
 *   The new session ID, or null if the server could not create one.
 */
export function startLearnerSession(settings: LearnerSettings): Promise<string | null> {
  rememberLearnerSessionId(null);
  pendingStart = postSession(settingsBody(settings));
  return pendingStart;
}

/**
 * Save the learner's settings and notebook to their current session.
 *
 * Starts a new session when there is none or the server no longer knows it.
 *
 * Args:
 *   settings: Profile, grammar strictness and saved phrases to store.
 *
 * Returns:
 *   True if the server saved them.
 */
export async function saveLearnerSettings(settings: LearnerSettings): Promise<boolean> {
  const sessionId = await settledSessionId();
  if (sessionId) {
    try {
      const res = await postJson('/api/session', { ...settingsBody(settings), sessionId });
      if (res.ok) return true;
      if (res.status !== 404) return false;
    } catch {
      return false;
    }
  }
  return (await startLearnerSession(settings)) !== null;
}

function isClientSession(value: unknown): value is ClientLearnerSession {
  const session = value as Partial<ClientLearnerSession> | null;
  return (
    !!session &&
    typeof session.sessionId === 'string' &&
    typeof session.personaId === 'string' &&
    typeof session.learnerName === 'string' &&
    CEFR_LEVELS.includes(session.learnerLevel as CefrLevel) &&
    typeof session.grammarStrictness === 'string' &&
    Array.isArray(session.checkpointTurns) &&
    Array.isArray(session.progress?.savedPhrases)
  );
}

/**
 * Fetch the learner's latest session from the server and remember its ID.
 *
 * Returns:
 *   The session, or null when there is none, the request fails, or the reply is malformed.
 */
export async function loadLearnerSession(): Promise<ClientLearnerSession | null> {
  const rememberedId = getLearnerSessionId();
  if (rememberedId) {
    try {
      const res = await getWithAuth(`/api/session/${rememberedId}`);
      if (res.ok) {
        const session: unknown = await res.json();
        if (isClientSession(session)) return session;
      }
    } catch {
      // Fall through to most recent session
    }
  }

  try {
    const res = await getWithAuth('/api/session');
    if (!res.ok) return null;
    const session: unknown = await res.json();
    if (!isClientSession(session)) return null;
    rememberLearnerSessionId(session.sessionId);
    return session;
  } catch {
    return null;
  }
}

/**
 * Fetch summaries of all user sessions, newest first.
 *
 * Returns:
 *   List of SessionSummary objects.
 */
export async function fetchSessionList(): Promise<SessionSummary[]> {
  try {
    const res = await getWithAuth('/api/session/list');
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Fetch a specific learner session by ID.
 *
 * Args:
 *   sessionId: The session ID to retrieve.
 *
 * Returns:
 *   ClientLearnerSession if found and owned, null otherwise.
 */
export async function fetchSessionById(sessionId: string): Promise<ClientLearnerSession | null> {
  try {
    const res = await getWithAuth(`/api/session/${sessionId}`);
    if (!res.ok) return null;
    const session: unknown = await res.json();
    return isClientSession(session) ? session : null;
  } catch {
    return null;
  }
}

/**
 * Delete a specific conversation by ID.
 *
 * Args:
 *   sessionId: The session ID to delete.
 *
 * Returns:
 *   True if deleted successfully.
 */
export async function deleteSessionById(sessionId: string): Promise<boolean> {
  try {
    const res = await deleteWithAuth(`/api/session/${sessionId}`);
    if (res.ok) {
      if (getLearnerSessionId() === sessionId) {
        rememberLearnerSessionId(null);
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create a new conversation session with optional topic.
 *
 * Args:
 *   options: Persona, topic, learner profile and strictness settings.
 *
 * Returns:
 *   The newly created ClientLearnerSession.
 */
export async function createConversation(options: {
  personaId: string;
  topic?: string;
  learnerName?: string;
  learnerLevel?: CefrLevel;
  grammarStrictness?: string;
  savedPhrases?: SavedPhrase[];
}): Promise<ClientLearnerSession | null> {
  try {
    const res = await postJson('/api/session', {
      personaId: options.personaId,
      topic: options.topic,
      learnerName: options.learnerName ?? '',
      learnerLevel: options.learnerLevel ?? 'A2',
      grammarStrictness: options.grammarStrictness ?? 'tutor',
      savedPhrases: options.savedPhrases
    });
    if (!res.ok) return null;
    const session: unknown = await res.json();
    if (isClientSession(session)) {
      rememberLearnerSessionId(session.sessionId);
      return session;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Turn saved checkpoint turns back into chat messages.
 *
 * Args:
 *   turns: Checkpointed turns, oldest first.
 *   personaId: Tutor the conversation is with.
 *
 * Returns:
 *   Chat messages with local display times; unknown grammar note categories become "grammar".
 */
export function toChatMessages(turns: ConversationTurn[], personaId: string): ChatMessage[] {
  return turns.map((turn) => ({
    id: turn.id,
    sender: turn.sender,
    personaId,
    text: turn.text,
    translation: turn.translation ?? '',
    grammarNotes: turn.grammarNotes?.map((note) => ({
      ...note,
      category: NOTE_CATEGORIES.includes(note.category as GrammarNote['category'])
        ? (note.category as GrammarNote['category'])
        : 'grammar'
    })),
    timestamp: new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }));
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
  const sessionId =
    (await settledSessionId()) ??
    (await postSession({
      personaId: request.personaId,
      learnerLevel: request.learnerLevel,
      grammarStrictness: request.grammarStrictness,
      learnerName: request.learnerName
    }));
  const res = await postJson('/api/chat', { ...request, sessionId: sessionId ?? undefined });

  if (res.ok && sessionId) {
    const body = await res.clone().json().catch(() => null);
    if (body && body.sessionId === null) rememberLearnerSessionId(null);
  }
  return res;
}

export type ChatReplyErrorReason = 'network' | 'server';

export type ChatTurnResult =
  | {
      status: 'ok';
      text: string;
      translation: string;
      grammarNotes: GrammarNote[];
      quotaUsed?: number;
      habits?: HabitSummary;
    }
  | { status: 'quota'; quota: QuotaError }
  | { status: 'premium_required' }
  | { status: 'error'; reason: ChatReplyErrorReason };

/**
 * True when an HTTP response is a 403 PREMIUM_REQUIRED refusal.
 *
 * Clones the response before reading so non-matching responses keep their unread body.
 *
 * Args:
 *   res: Fetch Response object to check.
 *
 * Returns:
 *   True when the status is 403 and the JSON body has `code: 'PREMIUM_REQUIRED'`.
 */
export async function isPremiumRequiredResponse(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const data = await res.clone().json();
    return Boolean(data && typeof data === 'object' && data.code === 'PREMIUM_REQUIRED');
  } catch {
    return false;
  }
}

/**
 * Build the learner-facing error message for a failed tutor reply.
 *
 * Args:
 *   personaName: Display name of the tutor.
 *   reason: Whether the network request failed or the server returned an error.
 *
 * Returns:
 *   A short message blaming the connection only on network failures.
 */
export function formatReplyError(personaName: string, reason: ChatReplyErrorReason): string {
  return reason === 'network'
    ? `${personaName} couldn't reply. Check your connection.`
    : `${personaName} couldn't reply. Something went wrong on our side.`;
}

/**
 * Send a chat turn and classify the response as a tutor reply, quota limit, or failure.
 *
 * Args:
 *   request: The chat body, without a sessionId.
 *
 * Returns:
 *   The parsed reply, quota error, or an error marker distinguishing network vs server failures.
 */
export async function requestChatReply(request: ChatRequest): Promise<ChatTurnResult> {
  let res: Response;
  try {
    res = await postChat(request);
  } catch (err) {
    console.warn('Chat reply request failed:', err);
    return { status: 'error', reason: 'network' };
  }

  try {
    const quota = await readQuotaError(res);
    if (quota) return { status: 'quota', quota };

    if (await isPremiumRequiredResponse(res)) {
      return { status: 'premium_required' };
    }

    if (res.ok) {
      const data = await res.json();
      if (typeof data?.text === 'string' && data.text) {
        if (data.habits) {
          notifyHabits(data.habits);
          if (data.habits.justMetGoal) {
            celebrateGoalMet(data.habits.currentStreak);
          }
        }
        return {
          status: 'ok',
          text: data.text,
          translation: typeof data.translation === 'string' ? data.translation : '',
          grammarNotes: Array.isArray(data.grammarNotes) ? data.grammarNotes : [],
          quotaUsed: typeof data?.quota?.used === 'number' ? data.quota.used : undefined,
          habits: data.habits
        };
      }
    }
  } catch (err) {
    console.warn('Chat reply response invalid:', err);
  }
  return { status: 'error', reason: 'server' };
}
