import type { Meta, StoryObj } from '@storybook/react-vite';
import { QrCode } from './QrCode';

const meta: Meta<typeof QrCode> = {
  title: 'Dashboard/Utility/QrCode',
  component: QrCode,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof QrCode>;

export const Default: Story = {
  args: {
    text: 'https://example.com',
  },
};

export const WithStellarAddress: Story = {
  args: {
    text: 'GB2WVYC6LWDA5XWRMFV5KQJ3EBXJQVROZHYXSCDBKEDX47FVPfjdpq7',
  },
};

export const SmallSize: Story = {
  args: {
    text: 'https://example.com/small',
    size: 120,
  },
};

export const LargeSize: Story = {
  args: {
    text: 'https://example.com/large',
    size: 300,
  },
};

export const WithComplexData: Story = {
  args: {
    text: 'https://stellar.expert/explorer/public/account/GB2WVYC6LWDA5XWRMFV5KQJ3EBXJQVROZHYXSCDBKEDX47FVPFJDPQ7?utm_source=app&utm_medium=qr',
  },
};

export const CenteredLayout: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Scan to fund account</div>
      <QrCode text="https://example.com" size={200} />
      <div style={{ fontSize: '0.7rem', color: 'var(--fg-dim)', maxWidth: 250, textAlign: 'center' }}>
        Use your mobile wallet to scan this code and fund your account
      </div>
    </div>
  ),
};
