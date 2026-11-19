/** Firestore-backed SessionStore, shared by all server instances and kept across restarts. */
import { Firestore, Timestamp, type CollectionReference, type DocumentData } from '@google-cloud/firestore';
import {
  appendCheckpointTurn,
  applySessionSettings,
  DEFAULT_RETENTION_MS,
  isSessionExpired,
  SessionOwnershipError,
  withRetention,
  type ConversationTurn,
  type LearnerSession,
  type SessionSettings,
  type SessionStore
} from './sessionStore';

/** Collection holding one document per learner session, keyed by session ID. */
export const SESSIONS_COLLECTION = 'learnerSessions';

/** Firestore writes at most 500 operations per batch. */
const DELETE_BATCH_SIZE = 500;

/**
 * Convert a session into its Firestore document.
 *
 * Args:
 *   session: Session to store.
 *
 * Returns:
 *   The session plus `expiresAtTs`, the Timestamp field the TTL policy deletes on.
 */
export function toSessionDocument(session: LearnerSession): DocumentData {
  return { ...session, expiresAtTs: Timestamp.fromDate(new Date(session.expiresAt)) };
}

/**
 * Convert a Firestore document back into a session.
 *
 * Args:
 *   data: Document data written by `toSessionDocument`.
 *
 * Returns:
 *   The session without the TTL-only `expiresAtTs` field.
 */
export function fromSessionDocument(data: DocumentData): LearnerSession {
  const session = { ...data };
  delete session.expiresAtTs;
  return session as LearnerSession;
}

export interface FirestoreSessionStoreOptions {
  /** Collection name; tests use a throwaway one. */
  collectionName?: string;
  /** Inactivity period after which a session expires. */
  retentionMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * SessionStore backed by Cloud Firestore.
 *
 * Every read-modify-write runs in a transaction, so concurrent checkpoints from the
 * chat route and the Live bridge cannot overwrite each other. Expired sessions are
 * hidden on read and deleted by the collection's TTL policy on `expiresAtTs`.
 */
export class FirestoreSessionStore implements SessionStore {
  private collection: CollectionReference;
  private retentionMs: number;
  private now: () => number;

  constructor(
    private db: Firestore,
    options: FirestoreSessionStoreOptions = {}
  ) {
    this.collection = db.collection(options.collectionName ?? SESSIONS_COLLECTION);
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? Date.now;
  }

  /** Owned, unexpired session from a document snapshot's data, or null. */
  private owned(data: DocumentData | undefined, userId: string): LearnerSession | null {
    if (!data) return null;
    const session = fromSessionDocument(data);
    if (session.userId !== userId || isSessionExpired(session, this.now())) return null;
    return session;
  }

  /** Run `change` on the owned session in a transaction and save what it returns. */
  private async modify(
    sessionId: string,
    userId: string,
    change: (session: LearnerSession) => LearnerSession
  ): Promise<LearnerSession | null> {
    const ref = this.collection.doc(sessionId);
    return this.db.runTransaction(async (tx) => {
      const session = this.owned((await tx.get(ref)).data(), userId);
      if (!session) return null;
      const updated = change(session);
      tx.set(ref, toSessionDocument(updated));
      return updated;
    });
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
    return this.owned((await this.collection.doc(sessionId).get()).data(), userId);
  }

  /**
   * Retrieve the most recently updated active session for a user.
   *
   * Every write restarts the retention window, so the most recently updated session
   * is also the last to expire: if it has expired, all of the user's sessions have.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Latest non-expired session, or null if none exist.
   */
  async getActiveUserSession(userId: string): Promise<LearnerSession | null> {
    const snapshot = await this.collection
      .where('userId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    return snapshot.empty ? null : this.owned(snapshot.docs[0].data(), userId);
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
    const ref = this.collection.doc(session.sessionId);
    return this.db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      if (existing && existing.userId !== session.userId) {
        throw new SessionOwnershipError(session.sessionId);
      }
      const stored = withRetention(session, this.now(), this.retentionMs);
      tx.set(ref, toSessionDocument(stored));
      return stored;
    });
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
    return this.modify(sessionId, userId, (session) =>
      appendCheckpointTurn(session, turn, this.now(), this.retentionMs)
    );
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
    return this.modify(sessionId, userId, (session) =>
      applySessionSettings(session, settings, this.now(), this.retentionMs)
    );
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
    await this.modify(sessionId, userId, (session) =>
      withRetention(
        { ...session, upstreamResumptionHandle: handle, upstreamModel: model ?? session.upstreamModel },
        this.now(),
        this.retentionMs
      )
    );
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
    const ref = this.collection.doc(sessionId);
    return this.db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      if (!existing || existing.userId !== userId) return false;
      tx.delete(ref);
      return true;
    });
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
    let deleted = 0;
    for (;;) {
      const snapshot = await this.collection.where('userId', '==', userId).limit(DELETE_BATCH_SIZE).get();
      if (snapshot.empty) return deleted;
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
  }

  /**
   * Give a guest's sessions to an account.
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
    const firstCheck = await this.collection.where('userId', '==', fromUserId).limit(1).get();
    if (firstCheck.empty) return 'none';

    const targetActive = await this.getActiveUserSession(toUserId);
    if (targetActive) {
      await this.deleteAllUserData(fromUserId);
      return 'discarded';
    }

    for (;;) {
      const snapshot = await this.collection.where('userId', '==', fromUserId).limit(DELETE_BATCH_SIZE).get();
      if (snapshot.empty) break;
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          userId: toUserId,
          upstreamResumptionHandle: null,
          upstreamModel: null
        });
      });
      await batch.commit();
    }
    return 'moved';
  }

  /**
   * No-op: the Firestore TTL policy on `expiresAtTs` deletes expired sessions.
   *
   * Returns:
   *   Always 0.
   */
  async purgeExpiredSessions(): Promise<number> {
    return 0;
  }
}
