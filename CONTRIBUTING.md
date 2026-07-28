# Contributing to Stellar_Card

Thank you for helping improve Stellar_Card. This guide covers everything you need to open a successful pull request.

---

## Project layout

```
Stellar_Card/
├── stellar_card-sdk/        # TypeScript SDK published to npm
├── stellar_card-contract/   # Soroban smart contract (Rust)
├── stellar_card-backend/    # API server
├── stellar_card-frontend/   # Web dashboard
└── tooling/                 # Build and deployment scripts
```

Each sub-package has its own `README.md` with setup instructions specific to that area.

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|-----------------|-------|
| Node.js | 18 | SDK development and tooling scripts |
| npm | 9 | Package management for the SDK |
| Rust | stable | Contract development |
| Soroban CLI | latest | Contract build and deploy |

---

## Setting up locally

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/Stellar_Card.git
cd Stellar_Card

# 2. Install SDK dependencies
cd stellar_card-sdk && npm ci && cd ..
```

---

## Workflow

1. **Pick an issue** — check the open issues list and leave a comment to claim one before starting.
2. **Branch naming** — follow the convention used in issue descriptions:
   - `feature/<task-slug>` for new features
   - `fix/<short-description>` for bug fixes
   - `docs/<short-description>` for documentation-only changes
3. **Make your changes** — keep commits small and focused; see the commit message guide below.
4. **Test** — run `npm test` in `stellar_card-sdk/` before opening a PR. For contract changes, run `cargo test` in `stellar_card-contract/`.
5. **Open a PR** — fill in the pull request template and link the issue with `Closes #N`.

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

Allowed types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`, `build`.

Examples:
```
feat(sdk): add retry helper for Soroban RPC calls
fix(contract): correct off-by-one in fee calculation
docs: update CONTRIBUTING.md with commit format
ci: add npm cache key to test workflow
```

Commit messages are validated automatically by commitlint on every commit (see `.commitlintrc.json`).

---

## Code style

- **TypeScript**: the SDK has no ESLint config checked in yet; follow the existing file conventions (2-space indent, named exports, `node:` import protocol for built-ins).
- **Rust**: run `cargo fmt` before committing contract changes.
- **Shell scripts**: use `set -euo pipefail` at the top of every script.

---

## Pull request checklist

- [ ] `npm test` passes in `stellar_card-sdk/`
- [ ] New behaviour has test coverage
- [ ] Commit messages follow Conventional Commits
- [ ] PR description links the resolved issue (`Closes #N`)
- [ ] No secrets, keys, or credentials included

---

## Reporting bugs

Open an issue using the [issue template](issueTemplate.md). Include:
- Steps to reproduce
- Expected vs actual behaviour
- Node.js / Rust / Soroban CLI versions

---

## Questions

Open a GitHub Discussion or comment directly on the relevant issue.
