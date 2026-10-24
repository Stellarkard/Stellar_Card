// Wallet connection status indicator component.
// Displays the current wallet connection state with appropriate
// visual feedback, animation states, and action buttons.

'use client';

import type { WalletConnectionState } from '../_lib/walletConnection';
import { getWalletStateLabel } from '../_lib/walletConnection';

interface Props {
  state: WalletConnectionState;
  publicKey?: string | null;
  network?: 'mainnet' | 'testnet' | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRetry?: () => void;
  compact?: boolean;
  showAnimation?: boolean;
}

const statusDotStyles: Record<WalletConnectionState, { background: string; boxShadow: string }> = {
  disconnected: { background: 'var(--fg-dim)', boxShadow: 'none' },
  connecting: { background: 'var(--yellow)', boxShadow: '0 0 8px var(--yellow-muted)' },
  connected: { background: 'var(--green)', boxShadow: '0 0 10px var(--green-glow)' },
  error: { background: 'var(--red)', boxShadow: '0 0 8px var(--red-muted)' },
  insufficient_balance: { background: 'var(--yellow)', boxShadow: '0 0 8px var(--yellow-muted)' },
  network_mismatch: { background: 'var(--red)', boxShadow: '0 0 8px var(--red-muted)' },
};

const buttonBase: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 120ms, border-color 120ms',
};

const primaryButton: React.CSSProperties = {
  ...buttonBase,
  background: 'var(--green-muted)',
  color: 'var(--green)',
  border: '1px solid var(--green-border)',
};

const secondaryButton: React.CSSProperties = {
  ...buttonBase,
  background: 'var(--surface)',
  color: 'var(--fg-muted)',
  border: '1px solid var(--border)',
};

const dangerButton: React.CSSProperties = {
  ...buttonBase,
  background: 'var(--surface)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
};

const statusDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const statusDotCompact: React.CSSProperties = {
  ...statusDot,
  width: 6,
  height: 6,
};

export function WalletConnectionStatus({
  state,
  publicKey,
  network,
  onConnect,
  onDisconnect,
  onRetry,
  compact = false,
  showAnimation = true,
}: Props) {
  const label = getWalletStateLabel(state);
  const dotStyle = statusDotStyles[state];

  const connectingAnimation = showAnimation && state === 'connecting' ? {
    animation: 'pulse 2s ease-in-out infinite',
  } : {};

  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.72rem',
          fontFamily: 'var(--font-mono)',
        }}
        role="status"
        aria-live="polite"
      >
        <span
          style={{
            ...statusDotCompact,
            ...dotStyle,
            ...connectingAnimation,
          }}
          aria-hidden="true"
        />
        <span style={{ color: 'var(--fg-muted)' }}>{label}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '1rem',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              ...statusDot,
              ...dotStyle,
              ...connectingAnimation,
            }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 500,
              color: 'var(--fg)',
              fontFamily: 'var(--font-body)',
            }}
          >
            {label}
          </span>
        </div>
        {network && (
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--fg-dim)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
            }}
          >
            {network}
          </span>
        )}
      </div>

      {publicKey && (
        <div
          style={{
            fontSize: '0.72rem',
            color: 'var(--fg-dim)',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {state === 'disconnected' && onConnect && (
          <button onClick={onConnect} type="button" style={primaryButton}>
            Connect Wallet
          </button>
        )}
        {state === 'connected' && onDisconnect && (
          <button onClick={onDisconnect} type="button" style={secondaryButton}>
            Disconnect
          </button>
        )}
        {(state === 'error' || state === 'network_mismatch') && onRetry && (
          <button onClick={onRetry} type="button" style={dangerButton}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
