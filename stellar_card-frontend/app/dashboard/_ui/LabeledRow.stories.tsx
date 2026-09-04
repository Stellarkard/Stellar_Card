import type { Meta, StoryObj } from '@storybook/react-vite';
import { LabeledRow } from './LabeledRow';

const meta: Meta<typeof LabeledRow> = {
  title: 'Dashboard/Form/LabeledRow',
  component: LabeledRow,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LabeledRow>;

export const Default: Story = {
  args: {
    label: 'Label',
    children: 'Input field',
  },
};

export const WithDescription: Story = {
  args: {
    label: 'Description',
    children: 'Some description text',
    description: 'This is a required field',
  },
};

export const Required: Story = {
  args: {
    label: 'Required field',
    children: 'Input',
    required: true,
  },
};