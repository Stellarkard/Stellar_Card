import type { Meta, StoryObj } from '@storybook/react-vite';
import { HeroCard, HeroScene } from './HeroCard';

const meta: Meta = {
  title: 'Components/HeroCard',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const CardOnly: StoryObj = {
  render: () => (
    <div style={{ width: '100%', maxWidth: '600px', position: 'relative', minHeight: '500px' }}>
      <HeroCard />
    </div>
  ),
};

export const WithScene: StoryObj = {
  render: () => (
    <section style={{ position: 'relative', width: '100%', minHeight: '600px', overflow: 'hidden' }}>
      <HeroScene />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '600px' }}>
        <HeroCard />
      </div>
    </section>
  ),
};

export const ResponsiveCard: StoryObj = {
  render: () => (
    <div style={{ width: '100%', minHeight: '500px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <HeroCard />
    </div>
  ),
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};
