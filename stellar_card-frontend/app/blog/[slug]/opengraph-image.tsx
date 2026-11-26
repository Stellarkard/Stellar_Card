// Dynamic Open Graph image for blog posts. Uses Next.js ImageResponse
// to generate a 1200x630 PNG with the post title, author, date, and logo.

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface BlogOGProps {
  params: Promise<{ slug: string }>;
}

const POST_METADATA: Record<string, { title: string; author: string; date: string; tags: string[] }> = {
  'what-we-found-auditing-our-own-code': {
    title: 'What we found auditing our own code',
    author: 'Stellar_Card Team',
    date: 'April 16, 2026',
    tags: ['security', 'engineering'],
  },
  'claim-codes-credentials-that-never-touch-the-transcript': {
    title: 'Claim codes: credentials that never touch the transcript',
    author: 'Stellar_Card Team',
    date: 'April 14, 2026',
    tags: ['security', 'onboarding'],
  },
  'non-custodial-card-issuance-on-soroban': {
    title: 'How we built non-custodial card issuance on Soroban',
    author: 'Stellar_Card Team',
    date: 'April 14, 2026',
    tags: ['architecture', 'stellar'],
  },
  'anatomy-of-a-stellar_card-order': {
    title: 'Anatomy of a Stellar_Card order',
    author: 'Stellar_Card Team',
    date: 'April 14, 2026',
    tags: ['engineering', 'fulfilment'],
  },
  'sse-beats-polling-for-agent-apis': {
    title: 'Why SSE beats polling for agent-facing APIs',
    author: 'Stellar_Card Team',
    date: 'April 14, 2026',
    tags: ['api', 'engineering'],
  },
};

function truncateText(text: string, maxLines: number, charsPerLine: number): string {
  const maxChars = maxLines * charsPerLine;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  // Approximate character width for the serif font at given fontSize
  const charWidth = fontSize * 0.55;
  const maxCharsPerLine = Math.floor(maxWidth / charWidth);
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export default async function OGImage({ params }: BlogOGProps) {
  const { slug } = await params;
  const metadata = POST_METADATA[slug] || {
    title: 'Stellar_Card Blog',
    author: 'Stellar_Card Team',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    tags: ['engineering'],
  };

  const titleLines = wrapText(metadata.title, 1000, 56);
  const displayTitle = titleLines.slice(0, 3).join('\n');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px 100px',
        background:
          'radial-gradient(ellipse 60% 55% at 25% 15%, rgba(124, 255, 178, 0.1), transparent 65%), radial-gradient(ellipse 50% 40% at 80% 90%, rgba(124, 255, 178, 0.06), transparent 65%), #050505',
        color: '#f4f4f4',
        fontFamily: '"Georgia", "Times New Roman", serif',
      }}
    >
      {/* Top row: Blog badge + date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 16,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: '#7cffb2',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>BLOG</span>
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 16,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          {metadata.date}
        </div>
      </div>

      {/* Title area */}
      <div style={{ maxWidth: 1000, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
        <div
          style={{
            fontSize: 56,
            lineHeight: 1.1,
            letterSpacing: -2,
            color: '#f4f4f4',
            fontWeight: 500,
            fontStyle: 'italic',
          }}
        >
          {displayTitle}
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {metadata.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontFamily: 'monospace',
                fontSize: 14,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(124, 255, 178, 0.12)',
                border: '1px solid rgba(124, 255, 178, 0.25)',
                color: '#7cffb2',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom row: Author + Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 32,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 30% 30%, #7cffb2, #0a4d2e)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: '#050505' }}>
              SC
            </span>
          </div>
          <div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'rgba(255, 255, 255, 0.4)',
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginBottom: 2,
              }}
            >
              By
            </div>
            <div
              style={{
                fontFamily: '"Georgia", serif',
                fontSize: 20,
                fontWeight: 500,
                color: '#f4f4f4',
              }}
            >
              {metadata.author}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: 'monospace',
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          <span>stellar_card.com/blog</span>
        </div>
      </div>
    </div>,
    { ...size }
  );
}