'use client';

import { useState, useCallback } from 'react';

interface CommissionBreakdown {
  monthlyRevenue: number;
  affiliateShare: number;
  estimatedMonthlyEarnings: number;
  estimatedAnnualEarnings: number;
}

const COMMISSION_RATE = 0.20; // 20%
const REVENUE_PER_CARD_PER_MONTH = 2.50; // $2.50 per card per month in revenue
const MIN_WITHDRAWAL = 50; // $50 minimum withdrawal

export function calculateCommission(referredCardVolume: number): CommissionBreakdown {
  const monthlyRevenue = referredCardVolume * REVENUE_PER_CARD_PER_MONTH;
  const affiliateShare = COMMISSION_RATE;
  const estimatedMonthlyEarnings = monthlyRevenue * affiliateShare;
  const estimatedAnnualEarnings = estimatedMonthlyEarnings * 12;

  return {
    monthlyRevenue,
    affiliateShare,
    estimatedMonthlyEarnings,
    estimatedAnnualEarnings,
  };
}

export function AffiliateCalculator() {
  const [referralCode, setReferralCode] = useState('');
  const [referredVolume, setReferredVolume] = useState(100);
  const [copied, setCopied] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');

  const baseUrl = 'https://stellar_card.com/ref';

  const generateLink = useCallback((code: string) => {
    if (!code.trim()) return `${baseUrl}?code=`;
    return `${baseUrl}?code=${encodeURIComponent(code.trim())}`;
  }, []);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const code = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    setReferralCode(code);
    setGeneratedLink(generateLink(code));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 0) {
      setReferredVolume(value);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = generatedLink;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const commission = calculateCommission(referredVolume);

  if (!generatedLink && referralCode) {
    setGeneratedLink(generateLink(referralCode));
  } else if (!generatedLink && !referralCode) {
    setGeneratedLink(`${baseUrl}?code=`);
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Referral Link Generator */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '2rem',
          marginBottom: '2rem',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 500,
            color: 'var(--fg)',
            margin: '0 0 0.5rem',
          }}
        >
          Your Referral Link
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            color: 'var(--fg-muted)',
            margin: '0 0 1.5rem',
            maxWidth: 600,
          }}
        >
          Enter a custom code to create your branded referral link. Share this link with your audience —
          anyone who signs up through it will be attributed to you for lifetime commissions.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 560 }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label
              htmlFor="referral-code"
              style={{
                display: 'flex',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                color: 'var(--fg)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px 0 0 8px',
                padding: '0 1rem',
              }}
            >
              {baseUrl}?code=
            </label>
            <input
              id="referral-code"
              type="text"
              value={referralCode}
              onChange={handleCodeChange}
              placeholder="your-code"
              maxLength={32}
              style={{
                flex: 1,
                minWidth: 200,
                padding: '0.75rem 1rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                color: 'var(--fg)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '0 8px 8px 0',
                outline: 'none',
              }}
              aria-label="Custom referral code"
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={generatedLink}
              readOnly
              style={{
                flex: 1,
                minWidth: 280,
                padding: '0.75rem 1rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                color: 'var(--fg-muted)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                outline: 'none',
              }}
              aria-label="Generated referral link"
            />
            <button
              onClick={copyToClipboard}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                fontFamily: 'var(--font-body)',
                fontSize: '0.85rem',
                fontWeight: 500,
                color: 'var(--bg)',
                background: 'var(--fg)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'opacity 0.2s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
            >
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>

          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '0.75rem',
              color: 'var(--fg-dim)',
              margin: '0.5rem 0 0',
            }}
          >
            Link format: <code style={{ color: 'var(--fg-muted)' }}>{baseUrl}?code=your-code</code>
            — case-insensitive, alphanumeric + underscore/hyphen only.
          </p>
        </div>
      </div>

      {/* Commission Calculator */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '2rem',
          marginBottom: '1.5rem',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 500,
            color: 'var(--fg)',
            margin: '0 0 0.5rem',
          }}
        >
          Commission Estimator
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            color: 'var(--fg-muted)',
            margin: '0 0 1.5rem',
            maxWidth: 600,
          }}
        >
          Adjust the slider to estimate your monthly and annual earnings based on the number of active
          cards your referrals generate. Assumes <strong>$2.50/month revenue per card</strong> at <strong>20% commission</strong>.
        </p>

        <div style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <label
              htmlFor="volume-slider"
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: '0.85rem',
                color: 'var(--fg)',
                fontWeight: 500,
              }}
            >
              Referred Card Volume
            </label>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--green)',
              }}
            >
              {referredVolume.toLocaleString()} cards
            </span>
          </div>
          <input
            id="volume-slider"
            type="range"
            min="0"
            max="10000"
            step="10"
            value={referredVolume}
            onChange={handleVolumeChange}
            style={{
              width: '100%',
              accentColor: 'var(--green)',
              marginBottom: '1.5rem',
            }}
            aria-label="Referred card volume slider"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: 'var(--fg-dim)',
            }}
          >
            <span>0</span>
            <span>1,000</span>
            <span>5,000</span>
            <span>10,000+</span>
          </div>

          {/* Earnings Display */}
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1.5rem',
              background: 'var(--green-muted)',
              border: '1px solid var(--green-border)',
              borderRadius: '10px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--green)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.25rem',
                  }}
                >
                  Est. Monthly
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(1.75rem, 3vw + 0.5rem, 2.25rem)',
                    fontWeight: 600,
                    color: 'var(--green)',
                  }}
                >
                  ${commission.estimatedMonthlyEarnings.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--green)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.25rem',
                  }}
                >
                  Est. Annual
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(1.75rem, 3vw + 0.5rem, 2.25rem)',
                    fontWeight: 600,
                    color: 'var(--green)',
                  }}
                >
                  ${commission.estimatedAnnualEarnings.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--green-border)',
                fontFamily: 'var(--font-body)',
                fontSize: '0.8rem',
                color: 'var(--fg-muted)',
              }}
            >
              Based on {referredVolume.toLocaleString()} cards × $${REVENUE_PER_CARD_PER_MONTH.toFixed(2)}/mo ×{' '}
              {(COMMISSION_RATE * 100).toFixed(0)}% = ${commission.estimatedMonthlyEarnings.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}/mo
            </div>
          </div>
        </div>
      </div>

      {/* Payout Terms */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.5rem',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
            fontWeight: 500,
            color: 'var(--fg)',
            margin: '0 0 1rem',
          }}
        >
          Payout Terms
        </h3>
        <ul
          style={{
            margin: 0,
            paddingLeft: '1.25rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '0.75rem',
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            color: 'var(--fg-muted)',
            lineHeight: 1.6,
          }}
        >
          <li><strong style={{ color: 'var(--fg)' }}>Commission:</strong> 20% of Stellar_Card revenue on referred cards, lifetime.</li>
          <li><strong style={{ color: 'var(--fg)' }}>Payouts:</strong> Monthly, on the 1st (USDC on Stellar by default).</li>
          <li><strong style={{ color: 'var(--fg)' }}>Minimum withdrawal:</strong> ${MIN_WITHDRAWAL} (accumulates until threshold met).</li>
          <li><strong style={{ color: 'var(--fg)' }}>Attribution:</strong> Lifetime cookie — no expiry, no 30-day window.</li>
          <li><strong style={{ color: 'var(--fg)' }}>Tracking:</strong> Real-time dashboard with CSV export.</li>
          <li><strong style={{ color: 'var(--fg)' }}>White-label:</strong> Custom domain, branding, and claim-code flow available.</li>
        </ul>
      </div>
    </div>
  );
}