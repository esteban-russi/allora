/** Tests for InMemoryHabitStore conforming to HabitStore contract. */
import { describeHabitStoreContract } from './helpers/habitStoreContract';
import { InMemoryHabitStore } from '../src/product/server/habitStore';

describeHabitStoreContract('InMemoryHabitStore', (options) => new InMemoryHabitStore(options?.now));
