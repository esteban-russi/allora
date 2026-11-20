/** Tests for InMemoryReportStore using the shared contract. */
import { InMemoryReportStore } from '../src/server/reportStore';
import { runReportStoreContract } from './helpers/reportStoreContract';

runReportStoreContract('InMemoryReportStore', () => {
  const store = new InMemoryReportStore();
  return {
    store,
    listByUser: async (userId) => store.getUserReports(userId)
  };
});
