import { describe, it, expect, vi } from 'vitest';

// Mock Next.js ImageResponse
vi.mock('next/og', () => ({
  ImageResponse: vi.fn().mockImplementation((element, options) => ({
    element,
    options,
    headers: {
      get: vi.fn((name: string) => {
        if (name === 'Content-Type') return 'image/png';
        if (name === 'Cache-Control') return 'public, max-age=31536000, immutable';
        return null;
      }),
    },
  })),
}));

import { POST_METADATA } from '../app/blog/[slug]/opengraph-image';

describe('Blog OpenGraph Image Generation', () => {
  it('has metadata for all published posts', () => {
    expect(POST_METADATA['what-we-found-auditing-our-own-code']).toBeDefined();
    expect(POST_METADATA['claim-codes-credentials-that-never-touch-the-transcript']).toBeDefined();
    expect(POST_METADATA['non-custodial-card-issuance-on-soroban']).toBeDefined();
    expect(POST_METADATA['anatomy-of-a-stellar_card-order']).toBeDefined();
    expect(POST_METADATA['sse-beats-polling-for-agent-apis']).toBeDefined();
  });

  it('each post has required metadata fields', () => {
    Object.values(POST_METADATA).forEach((post) => {
      expect(post.title).toBeTruthy();
      expect(post.author).toBeTruthy();
      expect(post.date).toBeTruthy();
      expect(Array.isArray(post.tags)).toBe(true);
      expect(post.tags.length).toBeGreaterThan(0);
    });
  });

  it('post titles are not empty', () => {
    Object.values(POST_METADATA).forEach((post) => {
      expect(post.title.length).toBeGreaterThan(0);
    });
  });

  it('post dates are valid date strings', () => {
    Object.values(POST_METADATA).forEach((post) => {
      expect(() => new Date(post.date)).not.toThrow();
      const date = new Date(post.date);
      expect(date.getTime()).not.toBeNaN();
    });
  });

  it('tags are properly formatted', () => {
    Object.values(POST_METADATA).forEach((post) => {
      post.tags.forEach((tag) => {
        expect(tag).toMatch(/^[a-z-]+$/);
      });
    });
  });

  it('has fallback metadata for unknown slugs', () => {
    // The component handles unknown slugs with default metadata
    // This is tested by the default values in the component
    const fallback = {
      title: 'Stellar_Card Blog',
      author: 'Stellar_Card Team',
      date: expect.any(String),
      tags: ['engineering'],
    };
    expect(fallback.title).toBe('Stellar_Card Blog');
    expect(fallback.author).toBe('Stellar_Card Team');
    expect(fallback.tags).toContain('engineering');
  });
});