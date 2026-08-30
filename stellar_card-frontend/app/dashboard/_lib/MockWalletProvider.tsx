'use client';

import type { ReactNode } from 'react';
import { MockWalletContext, type UseWalletConnectionReturn } from './useWalletConnection';
import { createMockWalletConnection, type CreateMockWalletOptions } from './mockWallet';

export interface MockWalletProviderProps {
  children: ReactNode;
  /** Full mock value (takes precedence over `scenario`/`mock`). */
  value?: UseWalletConnectionReturn;
  /** Preset scenario to build a mock value from. Defaults to `disconnected`. */
  scenario?: CreateMockWalletOptions['scenario'];
  /** Additional overrides applied when building from a scenario. */
  mock?: Omit<CreateMockWalletOptions, 'scenario'>;
}

/**
 * A sandbox context provider for mocking wallet connections in Storybook and tests.
 * When this provider is present, the useWalletConnection hook will return the mocked value.
 *
 * Can be used either with a pre-built `value`, or declaratively with a
 * `scenario` name (e.g. `<MockWalletProvider scenario="connected">`) which
 * builds a complete mock value via {@link createMockWalletConnection}.
 */
export function MockWalletProvider({ children, value, scenario, mock }: MockWalletProviderProps) {
  const resolvedValue = value ?? createMockWalletConnection({ scenario, ...mock });
  return (
    <MockWalletContext.Provider value={resolvedValue}>
      {children}
    </MockWalletContext.Provider>
  );
}
