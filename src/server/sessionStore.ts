/** Persistent learner sessions, conversation checkpoints, and retention/deletion lifecycle. */
import { randomUUID } from 'crypto';
import type { CefrLevel } from '../types';

export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30-day inactivity retention

const MAX_ID_LENGTH = 100;
const MAX_TURN_TEXT_LENGTH = 2000;
const MAX_NOTE_FIELD_LENGTH = 500;
const MAX_GRAMMAR_NOTES = 20;
const MAX_SAVED_PHRASES = 500;
const MAX_PHRASE_LENGTH = 500;

export interface ConversationTurn {
  id: string;
  sender: 'user' | 'persona';
  text: string;
  translation?: string;
  grammarNotes?: Array<{
    wordOrPhrase: string;
    explanation: string;
    category: string;
  }>;
  timestamp: string;
  turnDurationMs?: number;
}

export interface LearnerProgress {
  cefrLevel: CefrLevel;
  levelHistory: Array<{ level: CefrLevel; timestamp: string }>;
  savedPhrases: Array<{ id: string; it: string; en: string }>;
  totalTurns: number;
  talkingSharePct: number;
}

export interface LearnerSession {
  sessionId: string;
  userId: string;
  personaId: string;
  learnerName: string;
  learnerLevel: CefrLevel;
  grammarStrictness: string;
  progress: LearnerProgress;
  checkpointTurns: ConversationTurn[];
  upstreamResumptionHandle: string | null;
  upstreamModel: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateSessionOptions {
  userId: string;
  personaId?: string;
  learnerName?: string;
  learnerLevel?: CefrLevel;
  grammarStrictness?: string;
  retentionMs?: number;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/**
 * Validate an untrusted conversation turn and copy only its known fields.
 *
 * Args:
 *   value: Raw turn from a client message.
 *
 * Returns:
 *   A clean ConversationTurn, or null if any field is missing, mistyped, or too long.
 */
export function parseConversationTurn(value: unknown): ConversationTurn | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  if (!isBoundedString(raw.id, MAX_ID_LENGTH) || !raw.id) return null;
  if (raw.sender !== 'user' && raw.sender !== 'persona') return null;
  if (!isBoundedString(raw.text, MAX_TURN_TEXT_LENGTH)) return null;
  if (!isBoundedString(raw.timestamp, MAX_ID_LENGTH) || Number.isNaN(Date.parse(raw.timestamp))) return null;
  if (raw.translation !== undefined && !isBoundedString(raw.translation, MAX_TURN_TEXT_LENGTH)) return null;
  if (raw.turnDurationMs !== undefined && !(typeof raw.turnDurationMs === 'number' && raw.turnDurationMs >= 0)) {
    return null;
  }

  let grammarNotes: ConversationTurn['grammarNotes'];
  if (raw.grammarNotes !== undefined) {
    if (!Array.isArray(raw.grammarNotes) || raw.grammarNotes.length > MAX_GRAMMAR_NOTES) return null;
    grammarNotes = [];
    for (const note of raw.grammarNotes) {
      const { wordOrPhrase, explanation, category } = (note ?? {}) as Record<string, unknown>;
      if (
        !isBoundedString(wordOrPhrase, MAX_NOTE_FIELD_LENGTH) ||
        !isBoundedString(explanation, MAX_NOTE_FIELD_LENGTH) ||
        !isBoundedString(category, MAX_NOTE_FIELD_LENGTH)
      ) {
        return null;
      }
      grammarNotes.push({ wordOrPhrase, explanation, category });
    }
  }

  return {
    id: raw.id,
    sender: raw.sender,
    text: raw.text,
    timestamp: raw.timestamp,
    ...(raw.translation !== undefined && { translation: raw.translation as string }),
    ...(grammarNotes && { grammarNotes }),
    ...(raw.turnDurationMs !== undefined && { turnDurationMs: raw.turnDurationMs as number })
  };
}

/**
 * Validate an untrusted list of saved notebook phrases.
 *
 * Args:
 *   value: Raw `savedPhrases` from a request body.
 *
 * Returns:
 *   Clean phrases, or null if the list or any entry is malformed or too large.
 */
export function parseSavedPhrases(value: unknown): LearnerProgress['savedPhrases'] | null {
  if (!Array.isArray(value) || value.length > MAX_SAVED_PHRASES) return null;
  const phrases: LearnerProgress['savedPhrases'] = [];
  for (const entry of value) {
    const { id, it, en } = (entry ?? {}) as Record<string, unknown>;
    if (
      !isBoundedString(id, MAX_ID_LENGTH) ||
      !isBoundedString(it, MAX_PHRASE_LENGTH) ||
      !isBoundedString(en, MAX_PHRASE_LENGTH)
    ) {
      return null;
    }
    phrases.push({ id, it, en });
  }
  return phrases;
}

/** Raised when a write targets a session ID that belongs to another user. */
export class SessionOwnershipError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} belongs to another user`);
    this.name = 'SessionOwnershipError';
  }
}

export interface SessionStore {
  getSession(sessionId: string, userId: string): Promise<LearnerSession | null>;
  getActiveUserSession(userId: string): Promise<LearnerSession | null>;
  createOrUpdateSession(session: LearnerSession): Promise<LearnerSession>;
  saveTurnCheckpoint(sessionId: string, userId: string, turn: ConversationTurn): Promise<LearnerSession | null>;
  updateUpstreamHandle(sessionId: string, userId: string, handle: string | null, model?: string): Promise<void>;
  deleteSession(sessionId: string, userId: string): Promise<boolean>;
  deleteAllUserData(userId: string): Promise<number>;
  purgeExpiredSessions(): Promise<number>;
}

/** In-memory implementation of SessionStore supporting checkpoints and TTL expiry. */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, LearnerSession>();

  constructor(private retentionMs: number = DEFAULT_RETENTION_MS, private now: () => number = Date.now) {}

  /**
   * Retrieve a learner session by ID, verifying ownership and retention period.
   *
   * Args:
   *   sessionId: Target session identifier.
   *   userId: Authenticated user requesting access.
   *
   * Returns:
   *   The session if found, valid, and owned by user; null otherwise.
   */
  async getSession(sessionId: string, userId: string): Promise<LearnerSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return null;

    const expiresAtMs = new Date(session.expiresAt).getTime();
    if (expiresAtMs <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Retrieve the most recently updated active session for a user.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Latest non-expired session, or null if none exist.
   */
  async getActiveUserSession(userId: string): Promise<LearnerSession | null> {
    let latest: LearnerSession | null = null;
    const nowMs = this.now();

    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      const expiresAtMs = new Date(session.expiresAt).getTime();
      if (expiresAtMs <= nowMs) {
        this.sessions.delete(session.sessionId);
        continue;
      }
      if (!latest || new Date(session.updatedAt).getTime() > new Date(latest.updatedAt).getTime()) {
        latest = session;
      }
    }

    return latest;
  }

  /**
   * Create or update a learner session, extending its retention expiration.
   *
   * Args:
   *   session: Complete or updated session object.
   *
   * Returns:
   *   The persisted session.
   *
   * Raises:
   *   SessionOwnershipError: If the session ID is already held by a different user.
   */
  async createOrUpdateSession(session: LearnerSession): Promise<LearnerSession> {
    const existing = this.sessions.get(session.sessionId);
    if (existing && existing.userId !== session.userId) {
      throw new SessionOwnershipError(session.sessionId);
    }

    const nowIso = new Date(this.now()).toISOString();
    const expiresAtIso = new Date(this.now() + this.retentionMs).toISOString();

    const stored: LearnerSession = {
      ...session,
      updatedAt: nowIso,
      expiresAt: expiresAtIso
    };

    this.sessions.set(session.sessionId, stored);
    return stored;
  }

  /**
   * Append a conversation turn to the session's checkpoint history.
   *
   * Args:
   *   sessionId: Target session identifier.
   *   userId: Authenticated user identifier.
   *   turn: Finished conversation exchange.
   *
   * Returns:
   *   Updated LearnerSession, or null if session was not found.
   */
  async saveTurnCheckpoint(
    sessionId: string,
    userId: string,
    turn: ConversationTurn
  ): Promise<LearnerSession | null> {
    const session = await this.getSession(sessionId, userId);
    if (!session) return null;

    const updatedTurns = [...session.checkpointTurns, turn];
    // Keep up to 50 recent checkpoint turns per session
    if (updatedTurns.length > 50) {
      updatedTurns.splice(0, updatedTurns.length - 50);
    }

    let userWords = 0;
    let totalWords = 0;
    for (const t of updatedTurns) {
      const words = t.text.trim().split(/\s+/).filter(Boolean).length;
      totalWords += words;
      if (t.sender === 'user') userWords += words;
    }
    const talkingSharePct = totalWords > 0 ? Math.round((userWords / totalWords) * 100) : 0;

    const updatedSession: LearnerSession = {
      ...session,
      checkpointTurns: updatedTurns,
      progress: {
        ...session.progress,
        totalTurns: updatedTurns.length,
        talkingSharePct
      },
      updatedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + this.retentionMs).toISOString()
    };

    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  /**
   * Update the upstream Gemini Live resumption handle for seamless reconnection.
   *
   * Args:
   *   sessionId: Target session identifier.
   *   userId: Authenticated user identifier.
   *   handle: Base64 session resumption token, or null if invalid/expired.
   *   model: Live model identifier.
   */
  async updateUpstreamHandle(
    sessionId: string,
    userId: string,
    handle: string | null,
    model?: string
  ): Promise<void> {
    const session = await this.getSession(sessionId, userId);
    if (!session) return;

    session.upstreamResumptionHandle = handle;
    if (model) session.upstreamModel = model;
    session.updatedAt = new Date(this.now()).toISOString();
  }

  /**
   * Delete a specific conversation session and all its checkpoints (GDPR compliance).
   *
   * Args:
   *   sessionId: Target session identifier.
   *   userId: Authenticated user requesting deletion.
   *
   * Returns:
   *   True if a session was found and deleted; false otherwise.
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return false;
    return this.sessions.delete(sessionId);
  }

  /**
   * Delete all sessions, checkpoints, and saved progress for a user (GDPR right to be forgotten).
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Number of sessions deleted.
   */
  async deleteAllUserData(userId: string): Promise<number> {
    let deletedCount = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(id);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  /**
   * Purge all sessions that have passed their retention expiration time.
   *
   * Returns:
   *   Number of expired sessions purged.
   */
  async purgeExpiredSessions(): Promise<number> {
    let purgedCount = 0;
    const nowMs = this.now();
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt).getTime() <= nowMs) {
        this.sessions.delete(id);
        purgedCount++;
      }
    }
    return purgedCount;
  }
}

export const defaultSessionStore = new InMemorySessionStore();

/**
 * Initialize a new default learner session structure with a server-generated ID.
 *
 * IDs are never taken from the client, so one user cannot claim another's ID.
 *
 * Args:
 *   options: Session creation parameters.
 *
 * Returns:
 *   A new LearnerSession ready to be saved.
 */
export function initializeLearnerSession(options: CreateSessionOptions): LearnerSession {
  const now = new Date().toISOString();
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const expiresAt = new Date(Date.now() + retentionMs).toISOString();
  const level: CefrLevel = options.learnerLevel ?? 'A2';

  return {
    sessionId: `sess_${randomUUID()}`,
    userId: options.userId,
    personaId: options.personaId ?? 'emmanuele',
    learnerName: options.learnerName ?? '',
    learnerLevel: level,
    grammarStrictness: options.grammarStrictness ?? 'tutor',
    progress: {
      cefrLevel: level,
      levelHistory: [{ level, timestamp: now }],
      savedPhrases: [],
      totalTurns: 0,
      talkingSharePct: 0
    },
    checkpointTurns: [],
    upstreamResumptionHandle: null,
    upstreamModel: null,
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
}
