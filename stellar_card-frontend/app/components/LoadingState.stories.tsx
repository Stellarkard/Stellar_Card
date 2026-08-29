import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadingState, Skeleton, PageLoadingSkeleton } from '../components/LoadingState';

const meta: Meta<typeof LoadingState> = {
  title: 'Components/LoadingState',
  component: LoadingState,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LoadingState>;

export const Default: Story = {
  args: {},
};

export const WithAvatar: Story = {
  args: {
    avatar: true,
    title: true,
    lines: 4,
  },
};

export const WithChildren: Story = {
  args: {
    children: 'Processing your request…',
  },
};

export const SkeletonStory: StoryObj<typeof Skeleton> = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: 200 }}>
      <Skeleton width="100%" height={14} />
      <Skeleton width="80%" height={14} />
      <Skeleton width="60%" height={14} />
    </div>
  ),
};

export const PageLoader: StoryObj<typeof PageLoadingSkeleton> = {
  render: () => <PageLoadingSkeleton />,
};
