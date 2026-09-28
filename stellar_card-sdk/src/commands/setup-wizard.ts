// `stellar_card setup-wizard` — Interactive first-time merchant configuration
//
// This wizard guides new merchants through:
// 1. API key setup and validation
// 2. Wallet creation and passphrase configuration
// 3. Initial funding requirements
// 4. Trustline setup for USDC
// 5. Configuration persistence

import * as readline from 'readline';
import { assertSafeBaseUrl, loadStellar_CardConfig, saveStellar_CardConfig } from '../config';
import { createOWSWallet, getOWSPublicKey, addUsdcTrustlineOWS } from '../ows';
import { Stellar_CardClient } from '../client';

interface WizardConfig {
  apiKey?: string;
  walletName?: string;
  passphrase?: string;
  apiBase?: string;
  vaultPath?: string;
}

class SetupWizard {
  private rl: readline.Interface;
  private config: WizardConfig = {};

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private async question(prompt: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve) => {
      const fullPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
      this.rl.question(fullPrompt, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });
  }

  private async questionPassword(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(`${prompt}: `);
      const stdin = process.stdin;
      stdin.resume();
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');

      let password = '';
      stdin.on('data', (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\u0003') {
          process.exit();
        } else {
          password += char;
          process.stdout.write('*');
        }
      });
    });
  }

  async run(): Promise<number> {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   stellar_card Merchant Setup Wizard      ║');
    console.log('╚════════════════════════════════════════════╝\n');

    try {
      // Step 1: API Key
      await this.setupApiKey();

      // Step 2: Wallet Configuration
      await this.setupWallet();

      // Step 3: Passphrase
      await this.setupPassphrase();

      // Step 4: Optional API Base URL
      await this.setupApiBase();

      // Step 5: Review and save
      await this.reviewAndSave();

      console.log('\n✓ Setup complete!\n');
      return 0;
    } catch (err) {
      console.error('\n✗ Setup failed:');
      if (err instanceof Error) {
        console.error(`  ${err.message}`);
      } else {
        console.error(`  ${String(err)}`);
      }
      return 1;
    } finally {
      this.rl.close();
    }
  }

  private async setupApiKey(): Promise<void> {
    console.log('STEP 1: API Key Configuration');
    console.log('─────────────────────────────');
    console.log('You can get an API key from https://stellar_card.com/dashboard\n');

    let apiKey = '';
    let attempts = 0;

    while (!apiKey || !apiKey.startsWith('stellar_card_')) {
      if (attempts > 0) {
        console.log('Invalid format. API key must start with "stellar_card_"\n');
      }

      apiKey = await this.question('Enter your API key');
      attempts++;

      if (attempts > 3) {
        throw new Error('Too many invalid attempts');
      }
    }

    // Validate API key by making a test request
    console.log('\nValidating API key...');
    try {
      const client = new Stellar_CardClient({ apiKey });
      await client.getUsage();
      console.log('✓ API key is valid\n');
      this.config.apiKey = apiKey;
    } catch (err) {
      throw new Error(`Invalid API key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async setupWallet(): Promise<void> {
    console.log('STEP 2: Wallet Configuration');
    console.log('───────────────────────────');
    console.log('The SDK uses OWS (Offchain Withdrawal Server) to securely manage');
    console.log('your Stellar wallet. Your private keys stay on your machine.\n');

    let walletName = '';
    while (!walletName) {
      walletName = await this.question('Enter a name for your wallet', 'merchant-wallet');
      if (!walletName.match(/^[a-zA-Z0-9_-]{1,50}$/)) {
        console.log(
          'Invalid name. Use only alphanumeric characters, dashes, and underscores (1-50 chars).\n',
        );
        walletName = '';
      }
    }

    console.log(`\nCreating wallet "${walletName}"...`);
    this.config.walletName = walletName;
  }

  private async setupPassphrase(): Promise<void> {
    console.log('\nSTEP 3: Wallet Passphrase');
    console.log('────────────────────────');
    console.log('The wallet is encrypted with a passphrase. Use a strong, memorable one.\n');
    console.log('Requirements:');
    console.log('  • At least 12 characters');
    console.log('  • Mix of uppercase, lowercase, numbers, and symbols');
    console.log('  • Do NOT share with anyone\n');

    let passphrase = '';
    let attempts = 0;

    while (!passphrase || passphrase.length < 12) {
      if (attempts > 0) {
        console.log('Passphrase too short. Must be at least 12 characters.\n');
      }

      passphrase = await this.questionPassword('Enter wallet passphrase');
      attempts++;

      if (attempts > 3) {
        throw new Error('Too many weak passphrase attempts');
      }
    }

    const confirm = await this.questionPassword('Confirm passphrase');
    if (passphrase !== confirm) {
      throw new Error('Passphrases do not match');
    }

    console.log('✓ Passphrase set\n');
    this.config.passphrase = passphrase;
  }

  private async setupApiBase(): Promise<void> {
    console.log('STEP 4: Advanced Configuration (Optional)');
    console.log('───────────────────────────────────────');
    const custom = await this.question('Use custom API base URL? (y/N)', 'N');

    if (custom.toLowerCase() === 'y') {
      const apiBase = await this.question('API base URL', 'https://api.stellar_card.com/v1');
      try {
        assertSafeBaseUrl(apiBase);
        this.config.apiBase = apiBase;
        console.log('✓ API base URL configured\n');
      } catch (err) {
        console.log(`Invalid URL: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    } else {
      console.log('✓ Using default API base URL\n');
    }
  }

  private async reviewAndSave(): Promise<void> {
    console.log('STEP 5: Review Configuration');
    console.log('───────────────────────────');
    console.log('Configuration summary:\n');
    console.log(`  API Key: ${this.config.apiKey?.substring(0, 20)}...`);
    console.log(`  Wallet Name: ${this.config.walletName}`);
    console.log(`  API Base: ${this.config.apiBase || 'https://api.stellar_card.com/v1'}`);
    console.log(`  Storage: ~/.stellar_card/ (0600)\n`);

    const proceed = await this.question('Save configuration? (Y/n)', 'Y');
    if (proceed.toLowerCase() !== 'y' && proceed !== '') {
      throw new Error('Setup cancelled by user');
    }

    // Create wallet with passphrase
    console.log('\nCreating wallet...');
    await createOWSWallet(this.config.walletName!, this.config.passphrase);

    // Get wallet address
    const address = await getOWSPublicKey(this.config.walletName!);
    console.log(`✓ Wallet created: ${address}\n`);

    // Save configuration
    console.log('Saving configuration...');
    const existingConfig = loadStellar_CardConfig();
    const updatedConfig = {
      ...existingConfig,
      api_key: this.config.apiKey,
      wallet_name: this.config.walletName,
      wallet_address: address,
      api_base: this.config.apiBase,
    };

    saveStellar_CardConfig(updatedConfig);
    console.log('✓ Configuration saved to ~/.stellar_card/config.json\n');

    // Next steps
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('NEXT STEPS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`1. Fund your wallet at:`);
    console.log(`   ${address}\n`);
    console.log('   Minimum amounts:');
    console.log('   • 2 XLM (for fees and base reserve)');
    console.log('   • 10 USDC (for card purchases)\n');

    console.log('2. Set up the USDC trustline:');
    console.log('   $ stellar_card wallet trustline\n');

    console.log('3. Verify your setup:');
    console.log('   $ stellar_card wallet balance\n');

    console.log('4. Purchase your first card:');
    console.log('   $ stellar_card purchase --amount 10.00\n');

    console.log('For help: https://stellar_card.com/docs');
    console.log('Support: support@stellar_card.com\n');
  }
}

export async function setupWizardCommand(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: stellar_card setup-wizard

Interactive setup wizard for first-time merchant configuration.

This guide walks you through:
  1. API key validation
  2. Wallet creation with passphrase
  3. Configuration storage
  4. Next steps for funding and activation

Options:
  -h, --help                Show this message
`);
    return 0;
  }

  const wizard = new SetupWizard();
  return wizard.run();
}
