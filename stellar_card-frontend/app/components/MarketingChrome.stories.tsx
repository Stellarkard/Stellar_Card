import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarketingChrome } from './MarketingChrome';

const meta: Meta<typeof MarketingChrome> = {
  title: 'Components/MarketingChrome',
  component: MarketingChrome,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MarketingChrome>;

export const WithContent: Story = {
  render: () => (
    <MarketingChrome>
      <div style={{ padding: '4rem 1.35rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--fg)' }}>Marketing Page Content</h1>
        <p style={{ color: 'var(--fg-muted)', marginBottom: '1rem' }}>
          This is the main content area wrapped by MarketingChrome. The component provides:
        </p>
        <ul style={{ color: 'var(--fg-muted)', marginLeft: '2rem' }}>
          <li>Sticky navigation header with logo and links</li>
          <li>Footer with links and social media</li>
          <li>Grain texture background</li>
          <li>Skip to main content link for accessibility</li>
        </ul>
      </div>
    </MarketingChrome>
  ),
};

export const ShortContent: Story = {
  render: () => (
    <MarketingChrome>
      <div style={{ padding: '2rem 1.35rem', maxWidth: 1180, margin: '0 auto', minHeight: '300px' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--fg)' }}>Short Page</h1>
        <p style={{ color: 'var(--fg-muted)' }}>Even short pages get the full chrome treatment.</p>
      </div>
    </MarketingChrome>
  ),
};
