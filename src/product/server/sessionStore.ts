/** Persistent learner sessions, conversation checkpoints, and retention/deletion lifecycle. */
import { randomUUID } from 'crypto';
import type { CefrLevel } from '../types';
import { getTopicById } from '../data/topics';

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
  topic?: string;
  title?: string;
  progress: LearnerProgress;
  checkpointTurns: ConversationTurn[];
  upstreamResumptionHandle: string | null;
  upstreamModel: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface SessionSummary {
  sessionId: string;
  personaId: string;
  topic: string;
  title: string;
  lastLinePreview: string;
  lastLineSender: 'user' | 'persona' | null;
  turnCount: number;
  updatedAt: string;
}

export interface CreateSessionOptions {
  userId: string;
  personaId?: string;
  learnerName?: string;
  learnerLevel?: CefrLevel;
  grammarStrictness?: string;
  retentionMs?: number;
  topic?: string;
  title?: string;
  savedPhrases?: LearnerProgress['savedPhrases'];
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

/** What the browser may see of a session: no owner ID and no Live resumption handle. */
export type ClientLearnerSession = Omit<LearnerSession, 'userId' | 'upstreamResumptionHandle' | 'upstreamModel'>;

/**
 * Strip server-only fields before sending a session to the browser.
 *
 * Args:
 *   session: Stored session.
 *
 * Returns:
 *   A copy without `userId`, `upstreamResumptionHandle` and `upstreamModel`.
 */
export function toClientSession(session: LearnerSession): ClientLearnerSession {
  const view: Partial<LearnerSession> = { ...session };
  delete view.userId;
  delete view.upstreamResumptionHandle;
  delete view.upstreamModel;
  return view as ClientLearnerSession;
}

/** Raised when a write targets a session ID that belongs to another user. */
export class SessionOwnershipError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} belongs to another user`);
    this.name = 'SessionOwnershipError';
  }
}

/** Learner-editable fields of a session; `savedPhrases` is left unchanged when absent. */
export interface SessionSettings {
  personaId: string;
  learnerName: string;
  learnerLevel: CefrLevel;
  grammarStrictness: string;
  savedPhrases?: LearnerProgress['savedPhrases'];
}

export interface SessionStore {
  getSession(sessionId: string, userId: string): Promise<LearnerSession | null>;
  getActiveUserSession(userId: string): Promise<LearnerSession | null>;
  listUserSessions(userId: string, limit?: number): Promise<SessionSummary[]>;
  createOrUpdateSession(session: LearnerSession): Promise<LearnerSession>;
  saveTurnCheckpoint(sessionId: string, userId: string, turn: ConversationTurn): Promise<LearnerSession | null>;
  updateSessionSettings(sessionId: string, userId: string, settings: SessionSettings): Promise<LearnerSession | null>;
  updateUpstreamHandle(sessionId: string, userId: string, handle: string | null, model?: string): Promise<void>;
  getUserPhrases(userId: string): Promise<LearnerProgress['savedPhrases']>;
  saveUserPhrases(userId: string, phrases: LearnerProgress['savedPhrases']): Promise<void>;
  deleteSession(sessionId: string, userId: string): Promise<boolean>;
  deleteAllUserData(userId: string): Promise<number>;
  transferUserSessions(fromUserId: string, toUserId: string): Promise<'moved' | 'discarded' | 'none'>;
  purgeExpiredSessions(): Promise<number>;
}

const MAX_CHECKPOINT_TURNS = 50;

/**
 * Compute the display title for a conversation:
 * - Topic label if not free_chat
 * - First learner message (truncated) for free chat
 * - 'Free chat' if no learner message yet
 *
 * Args:
 *   session: Partial session with topic, title and turns.
 *
 * Returns:
 *   Friendly conversation title string.
 */
export function computeConversationTitle(
  session: Pick<LearnerSession, 'topic' | 'title' | 'checkpointTurns'>
): string {
  if (session.topic && session.topic !== 'free_chat') {
    const topic = getTopicById(session.topic);
    if (topic) return topic.label;
  }
  const firstUserTurn = session.checkpointTurns.find((t) => t.sender === 'user');
  if (firstUserTurn) {
    const text = firstUserTurn.text.trim();
    return text.length > 35 ? text.slice(0, 32) + '...' : text;
  }
  if (session.title && session.title !== 'Free chat') return session.title;
  return 'Free chat';
}

/**
 * Check whether a session has passed its retention expiry.
 *
 * Args:
 *   session: Stored session.
 *   nowMs: Current time in milliseconds.
 *
 * Returns:
 *   True once `expiresAt` is at or before now.
 */
export function isSessionExpired(session: LearnerSession, nowMs: number): boolean {
  return new Date(session.expiresAt).getTime() <= nowMs;
}

/**
 * Mark a session as updated now and restart its retention window.
 *
 * Args:
 *   session: Session to stamp.
 *   nowMs: Current time in milliseconds.
 *   retentionMs: Inactivity period after which the session expires.
 *
 * Returns:
 *   A new session object with `updatedAt` and `expiresAt` set.
 */
export function withRetention(session: LearnerSession, nowMs: number, retentionMs: number): LearnerSession {
  return {
    ...session,
    updatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + retentionMs).toISOString()
  };
}

/**
 * Append a turn to a session, keeping the last 50 and recomputing the talking share.
 *
 * Args:
 *   session: Session to extend.
 *   turn: Finished conversation turn.
 *   nowMs: Current time in milliseconds.
 *   retentionMs: Inactivity period after which the session expires.
 *
 * Returns:
 *   A new session object; the input is not modified.
 */
export function appendCheckpointTurn(
  session: LearnerSession,
  turn: ConversationTurn,
  nowMs: number,
  retentionMs: number
): LearnerSession {
  const turns = [...session.checkpointTurns, turn].slice(-MAX_CHECKPOINT_TURNS);

  let userWords = 0;
  let totalWords = 0;
  for (const t of turns) {
    const words = t.text.trim().split(/\s+/).filter(Boolean).length;
    totalWords += words;
    if (t.sender === 'user') userWords += words;
  }
  const talkingSharePct = totalWords > 0 ? Math.round((userWords / totalWords) * 100) : 0;
  const title =
    !session.topic || session.topic === 'free_chat'
      ? computeConversationTitle({ topic: session.topic, title: session.title, checkpointTurns: turns })
      : (session.title ?? computeConversationTitle(session));

  return withRetention(
    {
      ...session,
      title,
      checkpointTurns: turns,
      progress: { ...session.progress, totalTurns: turns.length, talkingSharePct }
    },
    nowMs,
    retentionMs
  );
}

/**
 * Apply learner-editable settings to a session, recording a level change in its history.
 *
 * Args:
 *   session: Session to update.
 *   settings: New profile fields, and saved phrases when present.
 *   nowMs: Current time in milliseconds.
 *   retentionMs: Inactivity period after which the session expires.
 *
 * Returns:
 *   A new session object; turns and the resumption handle are kept as they were.
 */
export function applySessionSettings(
  session: LearnerSession,
  settings: SessionSettings,
  nowMs: number,
  retentionMs: number
): LearnerSession {
  const { savedPhrases, ...profile } = settings;
  const levelChanged = settings.learnerLevel !== session.progress.cefrLevel;
  const progress = {
    ...session.progress,
    ...(savedPhrases && { savedPhrases }),
    ...(levelChanged && {
      cefrLevel: settings.learnerLevel,
      levelHistory: [
        ...session.progress.levelHistory,
        { level: settings.learnerLevel, timestamp: new Date(nowMs).toISOString() }
      ]
    })
  };
  return withRetention({ ...session, ...profile, progress }, nowMs, retentionMs);
}

/**
 * In-memory SessionStore, for local development and tests.
 *
 * Sessions are copied on the way in and out, so callers cannot change stored state
 * without going through the store, the same as with a database.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, LearnerSession>();
  private userPhrases = new Map<string, LearnerProgress['savedPhrases']>();

  constructor(private retentionMs: number = DEFAULT_RETENTION_MS, private now: () => number = Date.now) {}

  /** Synchronous owned read, so read-modify-write methods cannot interleave. */
  private readOwned(sessionId: string, userId: string): LearnerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return null;
    if (isSessionExpired(session, this.now())) {
      this.sessions.delete(sessionId);
      return null;
    }
    const cloned = structuredClone(session);
    if (this.userPhrases.has(userId)) {
      cloned.progress.savedPhrases = structuredClone(this.userPhrases.get(userId)!);
    } else if (cloned.progress.savedPhrases && cloned.progress.savedPhrases.length > 0) {
      this.userPhrases.set(userId, structuredClone(cloned.progress.savedPhrases));
    }
    return cloned;
  }

  private write(session: LearnerSession): LearnerSession {
    if (this.userPhrases.has(session.userId)) {
      session.progress.savedPhrases = structuredClone(this.userPhrases.get(session.userId)!);
    } else if (session.progress.savedPhrases && session.progress.savedPhrases.length > 0) {
      this.userPhrases.set(session.userId, structuredClone(session.progress.savedPhrases));
    }
    this.sessions.set(session.sessionId, structuredClone(session));
    return structuredClone(session);
  }

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
    const session = this.readOwned(sessionId, userId);
    return session ? structuredClone(session) : null;
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
    for (const session of [...this.sessions.values()]) {
      if (session.userId !== userId) continue;
      const owned = this.readOwned(session.sessionId, userId);
      if (!owned) continue;
      if (!latest || owned.updatedAt > latest.updatedAt) latest = owned;
    }
    return latest ? structuredClone(latest) : null;
  }

  /**
   * List the user's active sessions newest-first, returning summaries only.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *   limit: Max sessions to return (capped at 50).
   *
   * Returns:
   *   List of SessionSummary objects.
   */
  async listUserSessions(userId: string, limit: number = 50): Promise<SessionSummary[]> {
    const list: LearnerSession[] = [];
    for (const session of [...this.sessions.values()]) {
      if (session.userId !== userId) continue;
      const owned = this.readOwned(session.sessionId, userId);
      if (owned) list.push(owned);
    }
    list.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.sessionId.localeCompare(a.sessionId)
    );
    const max = Math.min(Math.max(limit, 1), 50);
    return list.slice(0, max).map((s) => {
      const turns = s.checkpointTurns;
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      return {
        sessionId: s.sessionId,
        personaId: s.personaId,
        topic: s.topic ?? 'free_chat',
        title: computeConversationTitle(s),
        lastLinePreview: lastTurn?.text ?? '',
        lastLineSender: lastTurn?.sender ?? null,
        turnCount: turns.length,
        updatedAt: s.updatedAt
      };
    });
  }

  /**
   * Get the learner's saved phrases notebook.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   List of saved phrases.
   */
  async getUserPhrases(userId: string): Promise<LearnerProgress['savedPhrases']> {
    return structuredClone(this.userPhrases.get(userId) ?? []);
  }

  /**
   * Save or replace the learner's saved phrases notebook across all user sessions.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *   phrases: Saved phrases list.
   */
  async saveUserPhrases(userId: string, phrases: LearnerProgress['savedPhrases']): Promise<void> {
    this.userPhrases.set(userId, structuredClone(phrases));
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.progress.savedPhrases = structuredClone(phrases);
      }
    }
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
    if (this.userPhrases.has(session.userId)) {
      session.progress.savedPhrases = structuredClone(this.userPhrases.get(session.userId)!);
    } else if (session.progress.savedPhrases && session.progress.savedPhrases.length > 0) {
      this.userPhrases.set(session.userId, structuredClone(session.progress.savedPhrases));
    }
    if (!session.title) {
      session.title = computeConversationTitle(session);
    }
    return this.write(withRetention(session, this.now(), this.retentionMs));
  }

  /**
   * Append a conversation turn to the session's checkpoint history (last 50 kept).
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
    const session = this.readOwned(sessionId, userId);
    if (!session) return null;
    return this.write(appendCheckpointTurn(session, turn, this.now(), this.retentionMs));
  }

  /**
   * Change the learner's profile settings and saved phrases without touching turns.
   *
   * Args:
   *   sessionId: Target session identifier.
   *   userId: Authenticated user identifier.
   *   settings: New settings.
   *
   * Returns:
   *   Updated LearnerSession, or null if session was not found.
   */
  async updateSessionSettings(
    sessionId: string,
    userId: string,
    settings: SessionSettings
  ): Promise<LearnerSession | null> {
    if (settings.savedPhrases !== undefined) {
      this.userPhrases.set(userId, structuredClone(settings.savedPhrases));
      for (const s of this.sessions.values()) {
        if (s.userId === userId) {
          s.progress.savedPhrases = structuredClone(settings.savedPhrases);
        }
      }
    }
    const session = this.readOwned(sessionId, userId);
    if (!session) return null;
    return this.write(applySessionSettings(session, settings, this.now(), this.retentionMs));
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
    const session = this.readOwned(sessionId, userId);
    if (!session) return;
    this.write(
      withRetention(
        { ...session, upstreamResumptionHandle: handle, upstreamModel: model ?? session.upstreamModel },
        this.now(),
        this.retentionMs
      )
    );
  }

  /**
   * Delete a specific conversation session and all its checkpoints (GDPR compliance).
   * The notebook (saved phrases) belongs to the learner and survives deleting a conversation.
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
    this.userPhrases.delete(userId);
    return deletedCount;
  }

  /**
   * Give a guest's sessions and notebook to an account.
   *
   * Args:
   *   fromUserId: Source user identifier (guest).
   *   toUserId: Destination user identifier (registered account).
   *
   * Returns:
   *   'moved' when reassigned, 'discarded' when target already has an active session,
   *   'none' when source user had no sessions.
   */
  async transferUserSessions(fromUserId: string, toUserId: string): Promise<'moved' | 'discarded' | 'none'> {
    let hasGuestSessions = false;
    for (const session of this.sessions.values()) {
      if (session.userId === fromUserId) {
        hasGuestSessions = true;
        break;
      }
    }
    if (!hasGuestSessions) return 'none';

    const targetActive = await this.getActiveUserSession(toUserId);
    if (targetActive) {
      await this.deleteAllUserData(fromUserId);
      return 'discarded';
    }

    const guestPhrases = this.userPhrases.get(fromUserId);
    if (guestPhrases) {
      this.userPhrases.delete(fromUserId);
      if (!this.userPhrases.has(toUserId) || this.userPhrases.get(toUserId)!.length === 0) {
        this.userPhrases.set(toUserId, guestPhrases);
      }
    }

    for (const session of this.sessions.values()) {
      if (session.userId === fromUserId) {
        session.userId = toUserId;
        session.upstreamResumptionHandle = null;
        session.upstreamModel = null;
      }
    }
    return 'moved';
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
      if (isSessionExpired(session, nowMs)) {
        this.sessions.delete(id);
        purgedCount++;
      }
    }
    return purgedCount;
  }
}

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
  const topic = options.topic ?? 'free_chat';
  const topicConfig = getTopicById(topic);
  const title = options.title ?? (topic !== 'free_chat' && topicConfig ? topicConfig.label : 'Free chat');

  const checkpointTurns: ConversationTurn[] = [];
  if (topic !== 'free_chat' && topicConfig?.firstLine) {
    checkpointTurns.push({
      id: `turn_${randomUUID()}`,
      sender: 'persona',
      text: topicConfig.firstLine.text,
      translation: topicConfig.firstLine.translation,
      timestamp: now
    });
  }

  return {
    sessionId: `sess_${randomUUID()}`,
    userId: options.userId,
    personaId: options.personaId ?? 'emmanuele',
    learnerName: options.learnerName ?? '',
    learnerLevel: level,
    grammarStrictness: options.grammarStrictness ?? 'tutor',
    topic,
    title,
    progress: {
      cefrLevel: level,
      levelHistory: [{ level, timestamp: now }],
      savedPhrases: options.savedPhrases ? [...options.savedPhrases] : [],
      totalTurns: checkpointTurns.length,
      talkingSharePct: 0
    },
    checkpointTurns,
    upstreamResumptionHandle: null,
    upstreamModel: null,
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
}
