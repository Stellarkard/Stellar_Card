// Derives a structured wallet connection state from the raw AgentStateName.
// "Wallet connection" is the agent's Stellar wallet lifecycle from minting
// through funding to active payment readiness.

import type { AgentStateName } from './types';

export type WalletConnectionPhase =
  | 'disconnected'   // no wallet address yet (minted, unknown)
  | 'connecting'     // wallet being provisioned (initializing)
  | 'awaiting_funds' // address known but balance is zero
  | 'ready';         // funded or active — address has a balance

export interface WalletConnectionState {
  /** Coarse phase for branch logic. */
  phase: WalletConnectionPhase;
  /** True when a wallet address exists on-chain (funded, active). */
  isConnected: boolean;
  /** True only when the agent can submit payments (active). */
  isReady: boolean;
  /** True for states that will transition automatically without operator action. */
  isTransient: boolean;
  /** Show the top-up / deposit UI to the operator. */
  canTopUp: boolean;
  /** Agent is cleared to make payments right now. */
  canTransact: boolean;
  /** Short human-readable label for display. */
  label: string;
  /** Longer description of what the operator should do next. */
  description: string;
}

const PHASE_MAP: Record<AgentStateName, WalletConnectionPhase> = {
  minted:           'disconnected',
  initializing:     'connecting',
  awaiting_funding: 'awaiting_funds',
  funded:           'ready',
  active:           'ready',
  unknown:          'disconnected',
};

const DESCRIPTIONS: Record<AgentStateName, { label: string; description: string }> = {
  minted:           {
    label:       'Not set up',
    description: 'Claim the agent to generate its Stellar wallet address.',
  },
  initializing:     {
    label:       'Setting up',
    description: 'Wallet is being created on-chain. This usually takes a few seconds.',
  },
  awaiting_funding: {
    label:       'Awaiting deposit',
    description: 'Send USDC to the wallet address shown below to activate this agent.',
  },
  funded:           {
    label:       'Funded',
    description: 'Wallet has a balance. The agent will activate once it processes its first order.',
  },
  active:           {
    label:       'Active',
    description: 'Wallet is connected and the agent is ready to make payments.',
  },
  unknown:          {
    label:       'Unknown',
    description: 'Wallet state could not be determined. Refresh the page or contact support.',
  },
};

/**
 * Derives a {@link WalletConnectionState} from the raw agent state name.
 * Pure function — safe to call outside React.
 */
export function deriveWalletConnectionState(state: AgentStateName): WalletConnectionState {
  const phase = PHASE_MAP[state];
  return {
    phase,
    isConnected:  phase === 'awaiting_funds' || phase === 'ready',
    isReady:      state === 'active',
    isTransient:  state === 'initializing' || state === 'awaiting_funding',
    canTopUp:     state === 'awaiting_funding' || state === 'funded' || state === 'active',
    canTransact:  state === 'active',
    ...DESCRIPTIONS[state],
  };
}
