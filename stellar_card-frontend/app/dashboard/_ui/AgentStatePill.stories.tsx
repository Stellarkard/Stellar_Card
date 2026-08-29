import type { Meta, StoryObj } from '@storybook/react';
import { AgentStatePill } from './AgentStatePill';
import type { AgentStateName } from '../_lib/types';

const STATES: AgentStateName[] = [
  'minted', 'initializing', 'awaiting_funding', 'funded', 'active', 'unknown',
];

const meta: Meta<typeof AgentStatePill> = {
  title: 'Dashboard/UI/AgentStatePill',
  component: AgentStatePill,
  tags: ['autodocs'],
  argTypes: {
    state: { control: 'select', options: STATES },
  },
};

export default meta;
type Story = StoryObj<typeof AgentStatePill>;

export const Active: Story = { args: { state: 'active' } };
export const Initializing: Story = { args: { state: 'initializing' } };
export const AwaitingFunding: Story = { args: { state: 'awaiting_funding' } };
export const Funded: Story = { args: { state: 'funded' } };
export const Minted: Story = { args: { state: 'minted' } };
export const Unknown: Story = { args: { state: 'unknown' } };

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {STATES.map((s) => <AgentStatePill key={s} state={s} />)}
    </div>
  ),
};
