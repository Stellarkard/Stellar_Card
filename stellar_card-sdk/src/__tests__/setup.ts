// Vitest setup for Soroban integration tests
import { beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
  // Set default timeout and suppress network warnings during tests
  process.env.STELLAR_NETWORK = 'TESTNET';
});

afterAll(() => {
  vi.restoreAllMocks();
});
