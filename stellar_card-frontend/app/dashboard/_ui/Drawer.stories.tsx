import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';

const meta: Meta<typeof Drawer> = {
  title: 'Dashboard/Modal/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Drawer>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Drawer</Button>
        <Drawer open={open} onClose={() => setOpen(false)} title="Drawer Title">
          <div style={{ padding: '1rem', color: 'var(--fg)' }}>
            Drawer content goes here. Press Escape to close.
          </div>
        </Drawer>
      </>
    );
  },
};

export const WithContent: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>View Details</Button>
        <Drawer open={open} onClose={() => setOpen(false)} title="Order Details">
          <div style={{ padding: '1.5rem', color: 'var(--fg)' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Order ID
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                ORD-2024-001234
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Status
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--green)' }}>
                Completed
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Amount
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                $123.45
              </div>
            </div>
            <Button variant="secondary" style={{ width: '100%' }}>
              Print Receipt
            </Button>
          </div>
        </Drawer>
      </>
    );
  },
};

export const CustomWidth: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Wide Drawer</Button>
        <Drawer open={open} onClose={() => setOpen(false)} title="Wide Panel" width={600}>
          <div style={{ padding: '1rem', color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
            This drawer has a custom width of 600px
          </div>
        </Drawer>
      </>
    );
  },
};

export const NoTitle: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Drawer open={open} onClose={() => setOpen(false)}>
          <div style={{ padding: '1rem', color: 'var(--fg)' }}>
            Drawer without a title
          </div>
        </Drawer>
      </>
    );
  },
};
