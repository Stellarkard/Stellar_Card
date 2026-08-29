import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/portal/'],
      },
    ],
    sitemap: 'https://stellar_card.com/sitemap.xml',
    host: 'https://stellar_card.com',
  };
}
