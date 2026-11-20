/** Tests for InMemoryAccountStore using the shared contract. */
import { InMemoryAccountStore } from '../src/platform/server/accountStore';
import { runAccountStoreContract } from './helpers/accountStoreContract';

runAccountStoreContract('InMemoryAccountStore', ({ now }) => new InMemoryAccountStore(now));
