'use client';

import React, { ReactNode } from 'react';
import { MockWalletContext } from './useWalletConnection';
import type { UseWalletConnectionReturn } from './useWalletConnection';

export interface MockWalletProviderProps {
  children: ReactNode;
  value: UseWalletConnectionReturn;
}

/**
 * A sandbox context provider for mocking wallet connections in Storybook and tests.
 * When this provider is present, the useWalletConnection hook will return the mocked value.
 */
export function MockWalletProvider({ children, value }: MockWalletProviderProps) {
  return (
    <MockWalletContext.Provider value={value}>
      {children}
    </MockWalletContext.Provider>
  );
}
