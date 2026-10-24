import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyCodeBlock } from './CopyCodeBlock';

const meta: Meta<typeof CopyCodeBlock> = {
  title: 'Components/CopyCodeBlock',
  component: CopyCodeBlock,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CopyCodeBlock>;

const sampleCode = `const api = new StellarCardAPI({
  apiKey: 'YOUR_API_KEY',
  baseUrl: 'https://api.stellar-card.com'
});

const card = await api.cards.create({
  agentId: 'agent_123',
  amount: 250.00,
  currency: 'USDC'
});`;

const pythonCode = `from stellar_card import StellarCardAPI

api = StellarCardAPI(api_key='YOUR_API_KEY')

card = api.cards.create(
    agent_id='agent_123',
    amount=250.00,
    currency='USDC'
)

print(f"Card created: {card.pan}")`;

export const Default: Story = {
  args: {
    label: 'JavaScript',
    children: sampleCode,
  },
};

export const WithoutLabel: Story = {
  args: {
    children: sampleCode,
  },
};

export const PythonExample: Story = {
  args: {
    label: 'Python',
    children: pythonCode,
  },
};

export const LongCode: Story = {
  args: {
    label: 'Extended example',
    children: `${sampleCode}\n\n// Handle response\nif (card.status === 'active') {\n  console.log('Card ready to use');\n  console.log('PAN:', card.pan);\n  console.log('CVV:', card.cvv);\n  console.log('Expiry:', card.expiry);\n} else {\n  console.error('Card creation failed:', card.status);\n}`,
    maxHeight: 300,
  },
};
