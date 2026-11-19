/** Firestore-backed AccountStore, shared by all server instances and kept across restarts. */
import {
  FieldValue,
  Firestore,
  Timestamp,
  type CollectionReference,
  type DocumentData
} from '@google-cloud/firestore';
import type { Account, AccountStore, Subscription } from './accountStore';

export const USERS_COLLECTION = 'users';

const GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Convert a stored document into an Account object.
 *
 * Args:
 *   data: Firestore document data.
 *
 * Returns:
 *   The Account object with TTL metadata stripped.
 */
export function fromAccountDocument(data: DocumentData): Account {
  return {
    userId: data.userId,
    email: data.email ?? null,
    isAnonymous: Boolean(data.isAnonymous),
    subscription: data.subscription ?? null,
    createdAt: data.createdAt,
    lastSeenAt: data.lastSeenAt
  };
}

export interface FirestoreAccountStoreOptions {
  collectionName?: string;
  now?: () => number;
}

/**
 * AccountStore backed by Cloud Firestore.
 *
 * Mutations execute in transactions to ensure atomic upserts and updates.
 * Anonymous user records carry `expiresAtTs` for TTL cleanup.
 */
export class FirestoreAccountStore implements AccountStore {
  private collection: CollectionReference;
  private now: () => number;

  constructor(
    private db: Firestore,
    options: FirestoreAccountStoreOptions = {}
  ) {
    this.collection = db.collection(options.collectionName ?? USERS_COLLECTION);
    this.now = options.now ?? Date.now;
  }

  /**
   * Create account if missing, or update if email, anonymity, or last seen has changed.
   *
   * Args:
   *   user: Authenticated user details.
   *
   * Returns:
   *   The Account record.
   */
  async upsertFromAuth(user: { userId: string; email?: string; isAnonymous: boolean }): Promise<Account> {
    const docRef = this.collection.doc(user.userId);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const email = user.email ?? null;

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);

      if (!snap.exists) {
        const created: Account = {
          userId: user.userId,
          email,
          isAnonymous: user.isAnonymous,
          subscription: null,
          createdAt: nowIso,
          lastSeenAt: nowIso
        };
        const docData: DocumentData = {
          ...created,
          ...(user.isAnonymous
            ? { expiresAtTs: Timestamp.fromDate(new Date(nowMs + GUEST_TTL_MS)) }
            : {})
        };
        tx.set(docRef, docData);
        return created;
      }

      const existingData = snap.data()!;
      const existing = fromAccountDocument(existingData);

      const emailChanged = existing.email !== email;
      const anonChanged = existing.isAnonymous !== user.isAnonymous;
      const lastSeenAge = nowMs - Date.parse(existing.lastSeenAt);
      const staleLastSeen = Number.isNaN(lastSeenAge) || lastSeenAge >= 24 * 60 * 60 * 1000;

      if (emailChanged || anonChanged || staleLastSeen) {
        const updated: Account = {
          ...existing,
          email,
          isAnonymous: user.isAnonymous,
          lastSeenAt: nowIso
        };

        const updateData: DocumentData = {
          email,
          isAnonymous: user.isAnonymous,
          lastSeenAt: nowIso
        };

        if (user.isAnonymous) {
          updateData.expiresAtTs = Timestamp.fromDate(new Date(nowMs + GUEST_TTL_MS));
        } else if (existingData.expiresAtTs) {
          updateData.expiresAtTs = FieldValue.delete();
        }

        tx.set(docRef, updateData, { merge: true });
        return updated;
      }

      return existing;
    });
  }

  /**
   * Retrieve an account by user ID.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   The Account if found, or null.
   */
  async getAccount(userId: string): Promise<Account | null> {
    const docRef = this.collection.doc(userId);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return fromAccountDocument(snap.data()!);
  }

  /**
   * Set or clear subscription for an existing user account.
   *
   * Args:
   *   userId: Target user identifier.
   *   subscription: Subscription record or null.
   */
  async setSubscription(userId: string, subscription: Subscription | null): Promise<void> {
    const docRef = this.collection.doc(userId);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return;
      tx.update(docRef, { subscription: subscription ? structuredClone(subscription) : null });
    });
  }

  /**
   * Delete an account record.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   True if deleted, false if not found.
   */
  async deleteAccount(userId: string): Promise<boolean> {
    const docRef = this.collection.doc(userId);
    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      tx.delete(docRef);
      return true;
    });
  }
}
