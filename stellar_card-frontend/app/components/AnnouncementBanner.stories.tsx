import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnnouncementBanner } from './AnnouncementBanner';

const meta: Meta<typeof AnnouncementBanner> = {
  title: 'Components/AnnouncementBanner',
  component: AnnouncementBanner,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnnouncementBanner>;

export const InfoTone: Story = {
  args: {
    id: 'demo-info',
    tone: 'info',
    href: '/changelog',
    children: 'New feature: Live metrics are now available in the dashboard',
  },
};

export const WarningTone: Story = {
  args: {
    id: 'demo-warning',
    tone: 'warning',
    href: '/status',
    children: 'Service maintenance scheduled for tonight 2-4 AM UTC',
  },
};

export const MutedTone: Story = {
  args: {
    id: 'demo-muted',
    tone: 'muted',
    href: '/docs',
    children: 'Check out our new API documentation',
  },
};

export const WithoutLink: Story = {
  args: {
    id: 'demo-no-link',
    tone: 'info',
    children: 'Important update: Please review our security guidelines',
  },
};

export const LongText: Story = {
  args: {
    id: 'demo-long',
    tone: 'info',
    href: '/changelog',
    children:
      'Major update released: Improved performance, better error messages, and new dashboard analytics features for better insights',
  },
};

export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div>
        <AnnouncementBanner id="demo-info-all" tone="info" href="/changelog">
          Info tone: New feature available
        </AnnouncementBanner>
      </div>
      <div>
        <AnnouncementBanner id="demo-warning-all" tone="warning" href="/status">
          Warning tone: Maintenance window
        </AnnouncementBanner>
      </div>
      <div>
        <AnnouncementBanner id="demo-muted-all" tone="muted" href="/docs">
          Muted tone: Documentation update
        </AnnouncementBanner>
      </div>
    </div>
  ),
};
