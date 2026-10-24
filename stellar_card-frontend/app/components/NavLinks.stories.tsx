import type { Meta, StoryObj } from '@storybook/react-vite';
import { NavLinks } from './NavLinks';

const meta: Meta<typeof NavLinks> = {
  title: 'Components/NavLinks',
  component: NavLinks,
  tags: ['autodocs'],
  parameters: {
    backgrounds: {
      default: 'dark',
    },
  },
};

export default meta;
type Story = StoryObj<typeof NavLinks>;

export const Desktop: Story = {
  render: () => (
    <nav
      style={{
        background: 'rgba(5,5,5,0.72)',
        borderBottom: '1px solid var(--border)',
        padding: '0.5rem 1.35rem',
        position: 'relative',
      }}
      className="marketing-nav"
    >
      <NavLinks />
    </nav>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'desktop',
    },
  },
};

export const Tablet: Story = {
  render: () => (
    <nav
      style={{
        background: 'rgba(5,5,5,0.72)',
        borderBottom: '1px solid var(--border)',
        padding: '0.5rem 1.35rem',
        position: 'relative',
      }}
      className="marketing-nav"
    >
      <NavLinks />
    </nav>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
  },
};

export const Mobile: Story = {
  render: () => (
    <nav
      style={{
        background: 'rgba(5,5,5,0.72)',
        borderBottom: '1px solid var(--border)',
        padding: '0.5rem 1.35rem',
        position: 'relative',
      }}
      className="marketing-nav"
    >
      <NavLinks />
    </nav>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const MobileSmall: Story = {
  render: () => (
    <nav
      style={{
        background: 'rgba(5,5,5,0.72)',
        borderBottom: '1px solid var(--border)',
        padding: '0.5rem 1.35rem',
        position: 'relative',
      }}
      className="marketing-nav"
    >
      <NavLinks />
    </nav>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'iphone12',
    },
  },
};
