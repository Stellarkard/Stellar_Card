import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from '../components/ErrorState';

const meta: Meta<typeof ErrorState> = {
  title: 'Components/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
  args: {},
};

export const CustomMessage: Story = {
  args: {
    title: 'Connection failed',
    message: 'Unable to reach the server. Check your network connection.',
  },
};

export const WithRetry: Story = {
  args: {
    title: 'Load failed',
    message: 'The data could not be loaded.',
    onRetry: () => alert('Retrying…'),
  },
};

export const WithDigest: Story = {
  args: {
    title: 'Server error',
    message: 'An internal error occurred.',
    digest: 'err-abc-123-def',
    onRetry: () => alert('Retrying…'),
  },
};
