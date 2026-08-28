#!/usr/bin/env node
// stellar_card CLI dispatcher.
//
// Subcommands:
//   onboard    Trade a one-time claim code for an api key + create an
//              OWS wallet. The agent-facing setup path (see skill.md).
//   mcp        Start the MCP server over stdio (default when no
//              subcommand is given, so `npx stellar_card` in an MCP
//              client's config "just works").
//   version    Print the installed SDK version and exit.
//
// Each subcommand lives in its own module and is imported dynamically
// so `stellar_card onboard` doesn't pay the cost of loading the MCP server
// handlers (~500 lines of tool registration) and vice versa.

async function main(): Promise<number> {
  const [, , cmd = 'mcp', ...rest] = process.argv;

  // Fire-and-forget update check. Runs in parallel with the command;
  // warns on stderr if this install is older than the latest on npm.
  // Never blocks, never throws. Skipped for `version` / help since
  // those exit too quickly for the fetch to race.
  if (
    cmd !== 'version' &&
    cmd !== '--version' &&
    cmd !== '-v' &&
    cmd !== '-h' &&
    cmd !== '--help' &&
    cmd !== 'help'
  ) {
    try {
      const { checkForUpdates } = await import('./version-check');
      checkForUpdates();
    } catch {
      /* version-check module load failed — non-fatal */
    }
  }

  if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(`stellar_card — virtual Visa cards for AI agents

Usage:
  stellar_card onboard --claim <code>    Set up an agent from a dashboard claim code
  stellar_card purchase --amount <USDC>  Buy a card using the wallet from onboard
  stellar_card wallet address            Print this agent's Stellar address
  stellar_card wallet balance            Print XLM + USDC balances from Horizon
  stellar_card wallet trustline          Open the USDC trustline (required before
                                     the wallet can receive USDC)
  stellar_card mcp                       Start the MCP server over stdio (default)
  stellar_card version                   Print the SDK version
  stellar_card --help                    Show this message

All the 'purchase' and 'wallet' subcommands read ~/.stellar_card/config.json
(written by 'stellar_card onboard') so you don't need to pass an api key.

Docs: https://stellar_card.com/docs
Onboarding guide for agents: https://stellar_card.com/skill.md
`);
    return 0;
  }

  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (cmd === 'onboard') {
    const { onboardCommand } = await import('./commands/onboard');
    return onboardCommand(rest);
  }

  if (cmd === 'purchase' || cmd === 'buy') {
    const { purchaseCommand } = await import('./commands/purchase');
    return purchaseCommand(rest);
  }

  if (cmd === 'wallet') {
    const { walletCommand } = await import('./commands/wallet');
    return walletCommand(rest);
  }

  if (cmd === 'mcp') {
    const { startMcpServer } = await import('./mcp');
    await startMcpServer();
    return 0;
  }

  process.stderr.write(`error: unknown command '${cmd}'\n`);
  process.stderr.write(`Run 'stellar_card --help' to see available commands.\n`);
  return 2;
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    process.stderr.write(
      `fatal: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
