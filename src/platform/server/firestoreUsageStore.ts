/** Firestore-backed UsageStore, shared across instances with TTL-based retention. */
import {
  Firestore,
  Timestamp,
  type CollectionReference,
  type DocumentData
} from '@google-cloud/firestore';
import {
  EMPTY_USAGE,
  type DailyUsage,
  type UsageCounter,
  type UsageStore
} from './usageStore';

export const USAGE_COLLECTION = 'usage';
const RETENTION_DAYS = 35;
const BATCH_DELETE_SIZE = 500;

export interface FirestoreUsageStoreOptions {
  collectionName?: string;
}

/**
 * Daily usage store backed by Cloud Firestore.
 *
 * Each document stores counters for a single user on a single UTC day (`<userId>_<day>`).
 * Automatic cleanup is provided via `expiresAtTs` (35 days after the start of that day).
 */
export class FirestoreUsageStore implements UsageStore {
  private collection: CollectionReference;

  constructor(
    private db: Firestore,
    options: FirestoreUsageStoreOptions = {}
  ) {
    this.collection = db.collection(options.collectionName ?? USAGE_COLLECTION);
  }

  private expiryForDay(day: string): Timestamp {
    const dayStartMs = Date.parse(`${day}T00:00:00.000Z`);
    const expiresAt = new Date(dayStartMs + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return Timestamp.fromDate(expiresAt);
  }

  /**
   * Retrieve daily usage for a user.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *
   * Returns:
   *   Current counters or zeros.
   */
  async getUsage(userId: string, day: string): Promise<DailyUsage> {
    const docRef = this.collection.doc(`${userId}_${day}`);
    const snap = await docRef.get();
    if (!snap.exists) return { ...EMPTY_USAGE };
    const data = snap.data()!;
    return {
      chatMessages: (data.chatMessages as number) ?? 0,
      voiceSeconds: (data.voiceSeconds as number) ?? 0,
      helperRequests: (data.helperRequests as number) ?? 0
    };
  }

  /**
   * Atomically try to consume a quota amount.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *   counter: Counter to increment.
   *   amount: Number of units to consume.
   *   limit: Maximum allowed units.
   *
   * Returns:
   *   Whether consumption was allowed and the resulting/current usage.
   */
  async tryConsume(
    userId: string,
    day: string,
    counter: UsageCounter,
    amount: number,
    limit: number
  ): Promise<{ allowed: boolean; used: number }> {
    const docRef = this.collection.doc(`${userId}_${day}`);

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? snap.data()! : null;
      const current = (data?.[counter] as number | undefined) ?? 0;

      if (current + amount <= limit) {
        const nextUsed = current + amount;
        const updateData: DocumentData = {
          userId,
          day,
          [counter]: nextUsed,
          expiresAtTs: this.expiryForDay(day)
        };
        tx.set(docRef, updateData, { merge: true });
        return { allowed: true, used: nextUsed };
      }

      return { allowed: false, used: current };
    });
  }

  /**
   * Add or refund an amount to a usage counter unconditionally.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *   counter: Counter to adjust.
   *   amount: Number of units to add (negative for refunds).
   */
  async add(userId: string, day: string, counter: UsageCounter, amount: number): Promise<void> {
    const docRef = this.collection.doc(`${userId}_${day}`);

    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? snap.data()! : null;
      const current = (data?.[counter] as number | undefined) ?? 0;
      const nextUsed = Math.max(0, current + amount);
      const updateData: DocumentData = {
        userId,
        day,
        [counter]: nextUsed,
        expiresAtTs: this.expiryForDay(day)
      };
      tx.set(docRef, updateData, { merge: true });
    });
  }

  /**
   * Delete all usage documents for a specific user across all days.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   Number of deleted daily records.
   */
  async deleteAllUserUsage(userId: string): Promise<number> {
    const snapshot = await this.collection.where('userId', '==', userId).get();
    if (snapshot.empty) return 0;

    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += BATCH_DELETE_SIZE) {
      const batch = this.db.batch();
      const chunk = docs.slice(i, i + BATCH_DELETE_SIZE);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    return docs.length;
  }
}
