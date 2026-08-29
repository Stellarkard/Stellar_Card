import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Toggle } from './Toggle';
import { Input } from './Input';

const meta: Meta<typeof Toggle> = {
  title: 'Dashboard/Form/Toggle',
  component: Toggle,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Default: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return (
      <Toggle
        checked={checked}
        onChange={setChecked}
        label="Enable notifications"
      />
    );
  },
};

export const WithDescription: Story = {
  render: () => {
    const [checked, setChecked] = useState(true);
    return (
      <Toggle
        checked={checked}
        onChange={setChecked}
        label="Dark mode"
        description="Use a dark color scheme to reduce eye strain"
      />
    );
  },
};

export const WithValueField: Story = {
  render: () => {
    const [checked, setChecked] = useState(true);
    return (
      <Toggle
        checked={checked}
        onChange={setChecked}
        label="Set spending limit"
        description="Enable a maximum spending limit for security"
        aria-label="Spending limit toggle"
        aria-describedby="limit-description"
      >
        <Input
          type="number"
          placeholder="$0.00"
          prefix="$"
          aria-label="Spending limit amount"
          aria-required={true}
          disabled={!checked}
        />
      </Toggle>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Toggle
      checked={false}
      onChange={() => {}}
      label="Feature (Not available)"
      description="This feature is only available for premium accounts"
      aria-label="Disabled toggle"
      aria-disabled="true"
    />
  ),
};

export const Multiple: Story = {
  render: () => {
    const [settings, setSettings] = useState({
      notifications: true,
      emails: false,
      sms: true,
    });

    return (
      <div>
        {Object.entries(settings).map(([key, value]) => (
          <Toggle
            key={key}
            checked={value}
            onChange={(next) => setSettings({ ...settings, [key]: next })}
            label={key.charAt(0).toUpperCase() + key.slice(1)}
            aria-label={`Enable ${key}`}
          />
        ))}
      </div>
    );
  },
};
