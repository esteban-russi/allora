/** Tests for InMemoryUsageStore using the shared contract. */
import { InMemoryUsageStore } from '../src/platform/server/usageStore';
import { runUsageStoreContract } from './helpers/usageStoreContract';

runUsageStoreContract('InMemoryUsageStore', () => new InMemoryUsageStore());
