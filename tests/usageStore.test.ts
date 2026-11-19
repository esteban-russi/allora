/** Tests for InMemoryUsageStore using the shared contract. */
import { InMemoryUsageStore } from '../src/server/usageStore';
import { runUsageStoreContract } from './helpers/usageStoreContract';

runUsageStoreContract('InMemoryUsageStore', () => new InMemoryUsageStore());
