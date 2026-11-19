/** Tests for InMemoryAccountStore using the shared contract. */
import { InMemoryAccountStore } from '../src/server/accountStore';
import { runAccountStoreContract } from './helpers/accountStoreContract';

runAccountStoreContract('InMemoryAccountStore', ({ now }) => new InMemoryAccountStore(now));
