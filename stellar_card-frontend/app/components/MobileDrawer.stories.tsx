import type { Meta, StoryObj } from '@storybook/react-vite';
import { MobileDrawer } from './MobileDrawer';
import { useState } from 'react';

const meta: Meta<typeof MobileDrawer> = {
  title: 'Components/MobileDrawer',
  component: MobileDrawer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof MobileDrawer>;

function DrawerDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--green)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {open ? 'Close Drawer' : 'Open Drawer'}
      </button>
      <MobileDrawer open={open} onClose={() => setOpen(false)}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <a
            href="#"
            style={{
              padding: '0.75rem',
              textDecoration: 'none',
              color: 'var(--fg)',
              borderRadius: 6,
              fontSize: '0.85rem',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Overview
          </a>
          <a
            href="#"
            style={{
              padding: '0.75rem',
              textDecoration: 'none',
              color: 'var(--fg)',
              borderRadius: 6,
              fontSize: '0.85rem',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Agents
          </a>
          <a
            href="#"
            style={{
              padding: '0.75rem',
              textDecoration: 'none',
              color: 'var(--fg)',
              borderRadius: 6,
              fontSize: '0.85rem',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Settings
          </a>
        </nav>
      </MobileDrawer>
    </>
  );
}

export const Open: Story = {
  render: () => (
    <MobileDrawer open={true} onClose={() => {}}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <a
          href="#"
          style={{
            padding: '0.75rem',
            textDecoration: 'none',
            color: 'var(--fg)',
            borderRadius: 6,
            fontSize: '0.85rem',
          }}
        >
          Overview
        </a>
        <a
          href="#"
          style={{
            padding: '0.75rem',
            textDecoration: 'none',
            color: 'var(--fg)',
            borderRadius: 6,
            fontSize: '0.85rem',
          }}
        >
          Agents
        </a>
        <a
          href="#"
          style={{
            padding: '0.75rem',
            textDecoration: 'none',
            color: 'var(--fg)',
            borderRadius: 6,
            fontSize: '0.85rem',
          }}
        >
          Settings
        </a>
      </nav>
    </MobileDrawer>
  ),
};

export const Closed: Story = {
  render: () => (
    <MobileDrawer open={false} onClose={() => {}}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <a href="#" style={{ padding: '0.75rem', textDecoration: 'none' }}>
          Overview
        </a>
      </nav>
    </MobileDrawer>
  ),
};

export const Interactive: Story = {
  render: () => <DrawerDemo />,
};
