import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { FilterChip } from './FilterChip';

const meta: Meta<typeof FilterChip> = {
  title: 'Dashboard/Filter/FilterChip',
  component: FilterChip,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FilterChip>;

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState(false);
    return (
      <FilterChip
        active={active}
        onClick={() => setActive(!active)}
        aria-pressed={active}
      >
        All Items
      </FilterChip>
    );
  },
};

export const WithCount: Story = {
  render: () => {
    const [active, setActive] = useState(true);
    return (
      <FilterChip
        active={active}
        onClick={() => setActive(!active)}
        count={42}
        aria-label="Show active items (42 total)"
        aria-pressed={active}
      >
        Active
      </FilterChip>
    );
  },
};

export const WithTone: Story = {
  render: () => {
    const tones = ['green', 'red', 'yellow', 'blue', 'purple', 'neutral'] as const;
    const [active, setActive] = useState<Record<string, boolean>>({
      green: true,
      red: false,
      yellow: false,
      blue: false,
      purple: false,
      neutral: false,
    });

    return (
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {tones.map((tone) => (
          <FilterChip
            key={tone}
            active={active[tone]}
            onClick={() => setActive({ ...active, [tone]: !active[tone] })}
            tone={tone}
            count={Math.floor(Math.random() * 100)}
            aria-label={`Filter by ${tone} status`}
            aria-pressed={active[tone]}
          >
            {tone.charAt(0).toUpperCase() + tone.slice(1)}
          </FilterChip>
        ))}
      </div>
    );
  },
};

export const FilterGroup: Story = {
  render: () => {
    const [active, setActive] = useState<Record<string, boolean>>({
      all: true,
      pending: false,
      completed: false,
      failed: false,
    });

    return (
      <fieldset style={{ border: 'none', padding: 0 }}>
        <legend style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Status Filter
        </legend>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <FilterChip
            active={active.all}
            onClick={() => setActive({ all: true, pending: false, completed: false, failed: false })}
            aria-label="Show all statuses"
            aria-pressed={active.all}
          >
            All
          </FilterChip>
          <FilterChip
            active={active.pending}
            onClick={() => setActive({ all: false, pending: true, completed: false, failed: false })}
            tone="yellow"
            count={5}
            aria-label="Show pending items"
            aria-pressed={active.pending}
          >
            Pending
          </FilterChip>
          <FilterChip
            active={active.completed}
            onClick={() => setActive({ all: false, pending: false, completed: true, failed: false })}
            tone="green"
            count={23}
            aria-label="Show completed items"
            aria-pressed={active.completed}
          >
            Completed
          </FilterChip>
          <FilterChip
            active={active.failed}
            onClick={() => setActive({ all: false, pending: false, completed: false, failed: true })}
            tone="red"
            count={2}
            aria-label="Show failed items"
            aria-pressed={active.failed}
          >
            Failed
          </FilterChip>
        </div>
      </fieldset>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <button
      disabled
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.35rem 0.7rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        fontSize: '0.72rem',
        color: 'var(--fg-dim)',
        cursor: 'not-allowed',
        opacity: 0.5,
      }}
    >
      Unavailable
    </button>
  ),
};
