import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';

const meta: Meta<typeof PageContainer> = {
  title: 'Dashboard/PageContainer',
  component: PageContainer,
  tags: ['autodocs'],
  argTypes: {
    maxWidth: { control: 'number' },
    gap: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof PageContainer>;

export const Default: Story = {
  render: (args) => (
    <PageContainer {...args}>
      <PageHeader title="Example page" subtitle="PageContainer provides consistent padding and max-width." />
      <div style={{ background: 'var(--surface-2)', padding: '1rem', borderRadius: 8, fontSize: '0.8rem', color: 'var(--fg-dim)' }}>
        Page content goes here.
      </div>
    </PageContainer>
  ),
};

export const NarrowWidth: Story = {
  args: { maxWidth: 800 },
  render: (args) => (
    <PageContainer {...args}>
      <PageHeader title="Narrow container" subtitle="maxWidth set to 800px." />
      <div style={{ background: 'var(--surface-2)', padding: '1rem', borderRadius: 8, fontSize: '0.8rem', color: 'var(--fg-dim)' }}>
        This container is narrower than the default.
      </div>
    </PageContainer>
  ),
};
