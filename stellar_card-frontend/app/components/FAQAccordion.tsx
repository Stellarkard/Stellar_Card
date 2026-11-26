'use client';

import { useState, useRef, useEffect } from 'react';

interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

interface FAQAccordionProps {
  items: FAQItem[];
  allowMultiple?: boolean;
  className?: string;
}

export function FAQAccordion({ items, allowMultiple = false, className = '' }: FAQAccordionProps) {
  const [openIndices, setOpenIndices] = useState<number[]>(() => {
    if (allowMultiple) return [];
    return items.length > 0 ? [0] : [];
  });
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const toggleItem = (index: number) => {
    setOpenIndices((prev) => {
      if (allowMultiple) {
        return prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index];
      }
      return prev.includes(index) ? [] : [index];
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleItem(index);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (index + 1) % items.length;
      const nextButton = document.querySelector(`[data-faq-trigger="${nextIndex}"]`) as HTMLElement;
      nextButton?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (index - 1 + items.length) % items.length;
      const prevButton = document.querySelector(`[data-faq-trigger="${prevIndex}"]`) as HTMLElement;
      prevButton?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      const firstButton = document.querySelector('[data-faq-trigger="0"]') as HTMLElement;
      firstButton?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const lastButton = document.querySelector(`[data-faq-trigger="${items.length - 1}"]`) as HTMLElement;
      lastButton?.focus();
    }
  };

  return (
    <div className={`faq-accordion ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {items.map((item, index) => {
        const isOpen = openIndices.includes(index);
        const contentId = `faq-content-${index}`;
        const triggerId = `faq-trigger-${index}`;

        return (
          <details
            key={index}
            open={isOpen}
            onToggle={() => toggleItem(index)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              overflow: 'hidden',
            }}
          >
            <summary
              id={triggerId}
              data-faq-trigger={index}
              onKeyDown={(e) => handleKeyDown(e, index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: '0.9rem',
                fontWeight: 500,
                color: 'var(--fg)',
                listStyle: 'none',
                userSelect: 'none',
                gap: '1rem',
              }}
              aria-expanded={isOpen}
              aria-controls={contentId}
            >
              <span>{item.question}</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1rem',
                  color: 'var(--fg-dim)',
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                ▼
              </span>
            </summary>
            <div
              id={contentId}
              ref={(el) => (contentRefs.current[index] = el)}
              role="region"
              aria-labelledby={triggerId}
              style={{
                overflow: 'hidden',
                maxHeight: isOpen ? '500px' : '0',
                transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), padding 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
                opacity: isOpen ? 1 : 0,
                padding: isOpen ? '0 1.25rem 1.25rem' : '0 1.25rem',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.88rem',
                  color: 'var(--fg-muted)',
                  lineHeight: 1.7,
                  animation: isOpen ? 'fadeIn 0.25s ease-out' : 'none',
                }}
              >
                {item.answer}
              </div>
            </div>
          </details>
        );
      })}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// Pre-built FAQ data for common pages
export const GENERAL_FAQ = [
  {
    question: 'What is Stellar_Card?',
    answer: (
      <>
        Stellar_Card is a programmable card issuance platform built on the Stellar network. It enables
        developers and businesses to issue virtual and physical debit cards programmatically via API,
        with real-time authorisation, KYC/KYB compliance, and on-chain settlement in USDC or XLM.
      </>
    ),
  },
  {
    question: 'How does the referral program work?',
    answer: (
      <>
        When you join the affiliate program, you receive a unique referral code. Anyone who signs up
        through your link is attributed to you for the lifetime of their account. You earn 20% of
        Stellar_Card's revenue on every card they issue, paid monthly in USDC or XLM.
      </>
    ),
  },
  {
    question: 'What are the payout terms?',
    answer: (
      <>
        Payouts are processed monthly on the 1st. The default currency is USDC on Stellar, with XLM
        available as an option. There is a $50 minimum withdrawal threshold — earnings accumulate
        until the threshold is met. All transactions are on-chain and auditable.
      </>
    ),
  },
  {
    question: 'Is there a volume requirement to join?',
    answer: (
      <>
        No minimum volume is required to join the waitlist. The early access program prioritizes
        platforms with active agent operators or developer audiences, but anyone can apply.
      </>
    ),
  },
  {
    question: 'Can I use my own branding?',
    answer: (
      <>
        Yes. The white-label dashboard allows you to host a sub-branded onboarding experience with
        your logo, colours, and a custom claim-code flow. Your referrals never see the Stellar_Card
        domain.
      </>
    ),
  },
  {
    question: 'What compliance is handled?',
    answer: (
      <>
        Stellar_Card handles KYC/KYB, OFAC screening, and transaction monitoring. Cardholders
        complete identity verification during onboarding. We partner with licensed issuers to ensure
        full regulatory compliance.
      </>
    ),
  },
];

export const DEVELOPER_FAQ = [
  {
    question: 'What APIs are available?',
    answer: (
      <>
        We provide REST APIs for card issuance, authorisation webhooks, transaction monitoring,
        balance management, and compliance status. SDKs are available for TypeScript, Python, and Go.
      </>
    ),
  },
  {
    question: 'How does authorisation work?',
    answer: (
      <>
        Real-time authorisation webhooks fire within 200ms of a transaction attempt. Your endpoint
        responds with approve/decline/modify. Fallback rules can be configured for timeout scenarios.
      </>
    ),
  },
  {
    question: 'What is the SLA for API uptime?',
    answer: (
      <>
        Our target is 99.9% uptime for the HTTP API and 99.95% for the authorisation path.
        Historical uptime is published on the <a href="/status" style={{ color: 'var(--green)', borderBottom: '1px solid var(--green-border)' }}>status page</a>.
      </>
    ),
  },
  {
    question: 'Can I test in sandbox?',
    answer: (
      <>
        Yes. A full sandbox environment is available with testnet Stellar integration. Sandbox cards
        work with our test merchant simulator for end-to-end testing without real funds.
      </>
    ),
  },
  {
    question: 'What are the rate limits?',
    answer: (
      <>
        Default limits are 100 requests/second for card operations and 500 requests/second for
        reads. Higher limits are available on request for enterprise customers.
      </>
    ),
  },
  {
    question: 'How do webhooks handle retries?',
    answer: (
      <>
        Failed webhook deliveries retry with exponential backoff (1s, 2s, 4s, 8s, 16s, max 5min)
        for up to 24 hours. Dead letter queue available for manual replay via dashboard.
      </>
    ),
  },
];