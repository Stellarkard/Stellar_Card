import type { Meta, StoryObj } from '@storybook/react-vite';
import { Wordmark } from './Wordmark';

const meta: Meta<typeof Wordmark> = {
  title: 'Components/Wordmark',
  component: Wordmark,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Wordmark>;

export const Default: Story = {
  render: () => (
    <div style={{ color: 'var(--fg)' }}>
      <Wordmark />
    </div>
  ),
};

export const MarkOnly: Story = {
  render: () => (
    <div style={{ color: 'var(--fg)' }}>
      <Wordmark mark />
    </div>
  ),
};

export const Large: Story = {
  render: () => (
    <div style={{ color: 'var(--fg)' }}>
      <Wordmark height={48} />
    </div>
  ),
};

export const Small: Story = {
  render: () => (
    <div style={{ color: 'var(--fg)' }}>
      <Wordmark height={16} />
    </div>
  ),
};

export const MarkLarge: Story = {
  render: () => (
    <div style={{ color: 'var(--fg)' }}>
      <Wordmark height={64} mark />
    </div>
  ),
};

export const WithAccent: Story = {
  render: () => (
    <div style={{ color: 'var(--green)' }}>
      <Wordmark />
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '2rem' }}>
      <div>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-dim)', marginBottom: '0.5rem' }}>Default (28px)</p>
        <div style={{ color: 'var(--fg)' }}>
          <Wordmark />
        </div>
      </div>

      <div>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-dim)', marginBottom: '0.5rem' }}>Mark Only (28px)</p>
        <div style={{ color: 'var(--fg)' }}>
          <Wordmark mark />
        </div>
      </div>

      <div>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-dim)', marginBottom: '0.5rem' }}>Large (48px)</p>
        <div style={{ color: 'var(--fg)' }}>
          <Wordmark height={48} />
        </div>
      </div>

      <div>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-dim)', marginBottom: '0.5rem' }}>With Accent Color</p>
        <div style={{ color: 'var(--green)' }}>
          <Wordmark height={40} />
        </div>
      </div>
    </div>
  ),
};
