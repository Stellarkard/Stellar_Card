import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Dashboard/Form/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
    defaultValue: { control: 'text' },
    'aria-invalid': { control: 'boolean' },
    'aria-required': { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <label htmlFor="input-with-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
        Email Address
      </label>
      <Input
        id="input-with-label"
        type="email"
        placeholder="your@email.com"
        aria-label="Email Address"
        aria-describedby="email-help"
      />
      <div id="email-help" style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>
        We will never share your email.
      </div>
    </div>
  ),
};

export const WithPrefix: Story = {
  args: {
    prefix: '$',
    placeholder: '0.00',
    defaultValue: '1234.56',
  },
};

export const WithSuffix: Story = {
  args: {
    suffix: 'USD',
    placeholder: '0.00',
    type: 'number',
  },
};

export const Invalid: Story = {
  args: {
    placeholder: 'Enter amount',
    'aria-invalid': true,
    'aria-describedby': 'error-message',
  },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Input {...args} />
      <div id="error-message" style={{ fontSize: '0.7rem', color: 'var(--red)' }}>
        Please enter a valid amount.
      </div>
    </div>
  ),
};

export const Required: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <label htmlFor="required-input" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
        Required Field <span style={{ color: 'var(--red)' }}>*</span>
      </label>
      <Input
        id="required-input"
        placeholder="This field is required"
        required
        aria-label="Required Field"
        aria-required="true"
      />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    placeholder: 'Disabled input',
    disabled: true,
    defaultValue: 'You cannot edit this',
  },
};

export const SearchInput: Story = {
  args: {
    type: 'search',
    placeholder: 'Search agents...',
    prefix: '🔍',
  },
};
