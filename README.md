# Stellar_Card

Full spend management and virtual Visa cards for AI agents.
Pay XLM or USDC on Stellar, get a real Visa card number in about 60 seconds.

Stellar Card gives agents their own funding rails without giving them your personal card details.
With one line of code, an agent can deploy an Open Wallet Standard (OWS) wallet with Stellar and Soroban support, then use that wallet to buy anywhere x402 is supported and anywhere Visa is accepted.

## Core idea

- Instant 1:1 value cards with no markup fee. `5 USDC -> $5 Visa card`.
- Real card credentials returned fast: PAN, CVV, and expiry.
- Non-custodial payment flow: the agent wallet pays the invoice contract directly.
- Stellar_Card does not custody customer funds.

## Why this matters

Agents are already making purchase decisions. The missing step has been safe, programmable execution on real-world payment rails.
Stellar_Card closes that gap:

- No need to hand an agent your own card.
- No need to trust third-party card sharing hacks.
- Less than 60 seconds end-to-end from payment to usable card details.
- Works across checkout pages, API billing, subscriptions, and marketplaces.

From solo users to large businesses running swarms of agents, Stellar_Card unlocks conventional finance rails in a programmable way:

- One Stellar transaction in USDC or XLM.
- One delivered Visa card out.
- Spend instantly, globally, and securely.

## Spend control plane for operators

Stellar_Card is not only card issuance. It is a full control plane for operating spending agents safely at scale.

- Agent spending limits: per order, daily, and lifetime caps enforced by policy.
- Human approval queues: route large purchases for manual approval or rejection.
- Live kill switch: suspend an agent and block the next purchase at API boundary.
- Agent groups: organize by purpose, owner, or environment for fast triage.
- Wallet top-ups with QR codes: each agent has a dedicated OWS Stellar wallet.
- Full audit log: every mutation tracked with actor, timestamp, IP, and user-agent.

## Developer experience

- x402 payment -> Visa card -> purchase anything.
- Fully resumable flows.
- Interactive APIs and webhooks.
- Human dashboard for oversight and operations.

Stellar_Card gives agents real purchasing power with strict, configurable guardrails.
