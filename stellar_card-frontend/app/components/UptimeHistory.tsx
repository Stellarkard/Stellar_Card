'use client';

import type { ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';

interface DayStatus {
  date: string;
  api: 'operational' | 'degraded' | 'outage';
  horizon: 'operational' | 'degraded' | 'outage';
  cardIssuance: 'operational' | 'degraded' | 'outage';
  uptimePercent: number;
  incidents?: string[];
}

interface UptimeHistoryProps {
  data: DayStatus[];
  overallUptime: number;
  incidents?: Array<{ date: string; title: string; description: string }>;
}

const STATUS_COLORS = {
  operational: { bar: 'var(--green)', tooltip: 'var(--green)' },
  degraded: { bar: 'var(--yellow)', tooltip: 'var(--yellow)' },
  outage: { bar: 'var(--red)', tooltip: 'var(--red)' },
};

function UptimeBar({
  date,
  status,
  component,
  uptimePercent,
  incidents,
}: {
  date: string;
  status: 'operational' | 'degraded' | 'outage';
  component: string;
  uptimePercent: number;
  incidents?: string[];
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHovered) {
      const timer = setTimeout(() => setShowTooltip(true), 100);
      return () => clearTimeout(timer);
    }
    setShowTooltip(false);
  }, [isHovered]);

  const color = STATUS_COLORS[status];

  return (
    <div
      ref={barRef}
      className="uptime-bar"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`${component} on ${date}: ${status} (${uptimePercent.toFixed(1)}% uptime)`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.25rem',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '48px',
          background: color.bar,
          borderRadius: '2px 2px 0 0',
          minWidth: '4px',
          transition: 'opacity 0.2s ease',
          opacity: isHovered ? 0.8 : 1,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.55rem',
          color: 'var(--fg-dim)',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          whiteSpace: 'nowrap',
        }}
      >
        {date}
      </span>

      {showTooltip && tooltipRef.current && (
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            minWidth: '200px',
            maxWidth: '280px',
            boxShadow: 'var(--shadow-lg)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.75rem',
            lineHeight: 1.5,
            color: 'var(--fg)',
            whiteSpace: 'normal',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--fg)' }}>
            {component} — {date}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.35rem',
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: color.tooltip,
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>{status}</span>
            <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
              ({uptimePercent.toFixed(1)}% uptime)
            </span>
          </div>
          {incidents && incidents.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.35rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--fg-dim)', marginBottom: '0.25rem' }}>
                Incidents:
              </div>
              <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.7rem' }}>
                {incidents.map((inc, i) => (
                  <li key={i} style={{ color: 'var(--fg-muted)' }}>
                    {inc}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UptimeComponentGrid({
  data,
  componentKey,
  componentLabel,
}: {
  data: DayStatus[];
  componentKey: keyof Pick<DayStatus, 'api' | 'horizon' | 'cardIssuance'>;
  componentLabel: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.85rem',
          fontWeight: 500,
          color: 'var(--fg)',
          paddingLeft: '0.5rem',
          marginBottom: '0.25rem',
        }}
      >
        {componentLabel}
      </div>
      <div
        style={{
          display: 'flex',
          gap: '2px',
          overflowX: 'auto',
          padding: '0.5rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          minHeight: '72px',
          alignItems: 'flex-end',
        }}
        role="list"
        aria-label={`${componentLabel} 90-day status history`}
      >
        {data.map((day) => (
          <UptimeBar
            key={day.date}
            date={day.date}
            status={day[componentKey]}
            component={componentLabel}
            uptimePercent={day.uptimePercent}
            incidents={day.incidents}
          />
        ))}
      </div>
    </div>
  );
}

function IncidentsAccordion({
  incidents,
}: {
  incidents: Array<{ date: string; title: string; description: string }>;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.1rem',
          fontWeight: 500,
          color: 'var(--fg)',
          marginBottom: '1rem',
        }}
      >
        Recent Incidents
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {incidents.map((incident, index) => (
          <details
            key={index}
            open={openIndex === index}
            onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: '0.85rem',
                color: 'var(--fg)',
                listStyle: 'none',
                userSelect: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenIndex(openIndex === index ? null : index);
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--fg-dim)',
                    background: 'var(--bg)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                  }}
                >
                  {incident.date}
                </span>
                <span style={{ fontWeight: 500 }}>{incident.title}</span>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1rem',
                  color: 'var(--fg-dim)',
                  transition: 'transform 0.2s ease',
                  transform: openIndex === index ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              >
                ▼
              </span>
            </summary>
            <div
              style={{
                padding: '0 1.25rem 1rem',
                color: 'var(--fg-muted)',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                animation: 'slideDown 0.2s ease-out',
              }}
            >
              {incident.description}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export function UptimeHistory({
  data,
  overallUptime,
  incidents = [],
}: UptimeHistoryProps) {
  const components = [
    { key: 'api' as const, label: 'HTTP API' },
    { key: 'horizon' as const, label: 'Horizon RPC' },
    { key: 'cardIssuance' as const, label: 'Card Issuance' },
  ];

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.5rem, 2.5vw + 0.5rem, 2rem)',
              fontWeight: 500,
              color: 'var(--fg)',
              margin: '0 0 0.25rem',
            }}
          >
            90-Day Uptime History
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--fg-dim)', margin: 0 }}>
            Daily status for each component. Hover a bar for details.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1rem 1.5rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            minWidth: '240px',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Overall Uptime
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.75rem, 3vw + 0.5rem, 2.5rem)',
              fontWeight: 600,
              color: overallUptime >= 99.9 ? 'var(--green)' : overallUptime >= 99 ? 'var(--yellow)' : 'var(--red)',
            }}
          >
            {overallUptime.toFixed(2)}%
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {components.map((c) => (
          <UptimeComponentGrid
            key={c.key}
            data={data}
            componentKey={c.key}
            componentLabel={c.label}
          />
        ))}
      </div>

      {incidents.length > 0 && <IncidentsAccordion incidents={incidents} />}
    </div>
  );
}

export function calculateOverallUptime(data: DayStatus[]): number {
  if (data.length === 0) return 100;
  const total = data.reduce((sum, day) => sum + day.uptimePercent, 0);
  return total / data.length;
}

export function generateMockUptimeData(): DayStatus[] {
  const data: DayStatus[] = [];
  const today = new Date();
  const components: Array<'api' | 'horizon' | 'cardIssuance'> = ['api', 'horizon', 'cardIssuance'];

  for (let i = 89; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    let uptimePercent = 100;
    const apiStatus: DayStatus['api'] = 'operational';
    const horizonStatus: DayStatus['horizon'] = 'operational';
    const cardIssuanceStatus: DayStatus['cardIssuance'] = 'operational';
    const incidents: string[] = [];

    const rand = Math.random();
    if (rand < 0.05) {
      uptimePercent = 0;
      incidents.push('Major outage');
    } else if (rand < 0.1) {
      uptimePercent = 50 + Math.random() * 40;
      incidents.push('Degraded performance');
    } else if (rand < 0.15) {
      uptimePercent = 95 + Math.random() * 4.99;
      incidents.push('Minor degradation');
    }

    data.push({
      date: dateStr,
      api: apiStatus,
      horizon: horizonStatus,
      cardIssuance: cardIssuanceStatus,
      uptimePercent,
      incidents: incidents.length > 0 ? incidents : undefined,
    });
  }

  return data;
}