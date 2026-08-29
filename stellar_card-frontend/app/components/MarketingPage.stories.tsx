import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageHero, PageSection, LegalBody } from './MarketingPage';

const meta: Meta = {
  title: 'Components/MarketingPage',
  tags: ['autodocs'],
};

export default meta;

export const PageHeroStory: StoryObj = {
  render: () => (
    <PageHero
      eyebrow="Feature Overview"
      title="Everything you need to know"
      intro="Comprehensive guide to using Stellar_Card for your AI agents."
      accent="agile"
    />
  ),
};

export const PageSectionPlain: StoryObj = {
  render: () => (
    <PageSection eyebrow="Getting Started" title="How to build with Stellar_Card">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '2rem' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--fg)' }}>
            Step 1
          </h3>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.95rem' }}>Install the SDK and set up your API key.</p>
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--fg)' }}>
            Step 2
          </h3>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.95rem' }}>Create your first agent with Stellar wallet.</p>
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--fg)' }}>
            Step 3
          </h3>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.95rem' }}>Issue virtual cards and start transacting.</p>
        </div>
      </div>
    </PageSection>
  ),
};

export const PageSectionSurface: StoryObj = {
  render: () => (
    <PageSection background="surface" eyebrow="Highlights" title="Key benefits">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <h4 style={{ color: 'var(--fg)', marginBottom: '0.25rem' }}>Non-custodial</h4>
          <p style={{ color: 'var(--fg-muted)', margin: 0 }}>Agents control their own wallets and funds.</p>
        </div>
        <div>
          <h4 style={{ color: 'var(--fg)', marginBottom: '0.25rem' }}>Real cards</h4>
          <p style={{ color: 'var(--fg-muted)', margin: 0 }}>Full Visa credentials in about 60 seconds.</p>
        </div>
      </div>
    </PageSection>
  ),
};

export const PageSectionBordered: StoryObj = {
  render: () => (
    <PageSection background="bordered" title="Documentation">
      <p style={{ color: 'var(--fg-muted)', marginBottom: '1rem' }}>
        Read the full API documentation to get started with Stellar_Card.
      </p>
      <a href="#" style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}>
        View docs →
      </a>
    </PageSection>
  ),
};

export const LegalBodyStory: StoryObj = {
  render: () => (
    <LegalBody
      intro="This is an important legal document. Please read carefully."
      sections={[
        {
          heading: '1. Terms and Conditions',
          body: (
            <p>
              By using Stellar_Card, you agree to these terms and conditions. We provide virtual Visa cards for AI
              agents...
            </p>
          ),
        },
        {
          heading: '2. Limitations of Liability',
          body: (
            <p>
              In no event shall Stellar_Card be liable for any indirect, incidental, special, consequential, or
              punitive damages...
            </p>
          ),
        },
        {
          heading: '3. Disclaimer',
          body: (
            <p>
              The service is provided "as is" without warranties of any kind. We make no guarantees about uptime,
              availability, or performance...
            </p>
          ),
        },
      ]}
    />
  ),
};
