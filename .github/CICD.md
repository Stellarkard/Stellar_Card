# CI/CD Pipeline Documentation

Automated testing, building, and publishing for the stellar_card SDK.

## Workflows

### 1. Test & Lint (`test.yml`)

Runs on:
- Every push to `main`, `develop`, or `feature/*` branches
- Every pull request to `main` or `develop`
- Only when changes touch `stellar_card-sdk/` or this workflow file

Jobs:
- **test**: Runs on Ubuntu and macOS, Node.js 18.x, 20.x, 22.x
  - Lint with ESLint
  - TypeScript type checking
  - Unit tests with Vitest
  - Build TypeScript → JavaScript
  - Browser-entry guard (`npm run check:browser`) — fails if `src/browser.ts`'s import graph reaches a Node.js built-in not stubbed by the `browser` field
  - Package verification (`npm run verify:package`) — `npm pack --dry-run` check that the publishable tarball has every entry point, no source/tests/tooling, and stays under the size budget
  - Upload coverage to Codecov

- **type-matrix**: Tests TypeScript compatibility with multiple versions (5.0 - 5.3)

### 1a. E2E Tests (`e2e.yml`)

Runs the Playwright suite in `stellar_card-frontend/e2e/` across a CI matrix covering `chromium`, `firefox`, `webkit`, `Mobile Chrome`, and `Mobile Safari` — mirroring every project defined in `playwright.config.ts` except `Microsoft Edge`, which needs a system-installed Edge browser that isn't available on the `ubuntu-latest` runner image and is left as a local-only / self-hosted-runner project.

`Mobile Chrome` and `Mobile Safari` are device-emulation presets, not separate browser engines — they render on `chromium` and `webkit` respectively, so the workflow resolves each matrix entry to its underlying engine before installing or caching browser binaries.

### 2. Security Audit (`security.yml`)

Runs:
- On changes to `package.json` files
- Daily at 2 AM UTC
- Manual trigger via workflow_dispatch

Jobs:
- **npm-audit**: Checks for known vulnerabilities in dependencies
- **dependency-check**: Lists outdated packages
- **trivy-scan**: Container image vulnerability scanning
- **codeql**: CodeQL static analysis for security issues

Reports uploaded to GitHub Security tab.

### 3. Publish to npm (`publish.yml`)

Triggers:
- Push of tags matching `sdk-v*.*.*`
- Manual dispatch with version input

Process:
1. Checkout code
2. Install dependencies
3. Run lint, typecheck, tests
4. Build distribution files
5. Verify browser entry has no Node.js built-ins (`check:browser`)
6. Verify publishable package contents (`verify:package`)
7. Verify version matches `package.json`
8. Extract changelog from `CHANGELOG.md`
9. Publish to npm registry
10. Create GitHub Release
11. Notify Slack (if webhook configured)

Requires secrets:
- `NPM_TOKEN`: npm automation token
- `SLACK_WEBHOOK_URL`: (optional) Slack notification webhook

### 4. Release (`release.yml`)

Manual workflow for version bumping and release creation.

Inputs:
- `version-type`: patch, minor, major, or prerelease

Process:
1. Calculate new version based on type
2. Update `package.json` version
3. Update `CHANGELOG.md` with commits since last release
4. Commit and push changes
5. Create git tag
6. Trigger publish workflow

## Setting Up Secrets

### NPM Token

1. Go to https://www.npmjs.com/settings/tokens
2. Create new token (Automation type recommended for CI)
3. Add to GitHub repo secrets as `NPM_TOKEN`

```bash
gh secret set NPM_TOKEN --body "npm_..."
```

### Slack Webhook (Optional)

1. Create Slack app at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Create new webhook pointing to your channel
4. Add to GitHub repo secrets as `SLACK_WEBHOOK_URL`

```bash
gh secret set SLACK_WEBHOOK_URL --body "https://hooks.slack.com/..."
```

## Release Process

### Automated Release (Recommended)

1. Ensure all changes are merged to `main`
2. Go to Actions → Release
3. Click "Run workflow"
4. Select version type (patch, minor, major)
5. Workflow creates PR with:
   - Updated `package.json`
   - Updated `CHANGELOG.md`
   - New git tag
6. Review and merge PR (auto-merge can be enabled)
7. Publish workflow automatically runs

### Manual Release

1. Update `stellar_card-sdk/package.json` version
2. Update `CHANGELOG.md` with release notes
3. Commit: `git commit -am "chore: release v0.5.0"`
4. Create tag: `git tag -a sdk-v0.5.0 -m "Release v0.5.0"`
5. Push: `git push origin main && git push origin sdk-v0.5.0`
6. Publish workflow runs automatically

## Workflow Status Badges

Add to README:

```markdown
![Tests](https://github.com/devpeter999/Stellar_Card/workflows/Test%20&%20Lint/badge.svg)
![Security](https://github.com/devpeter999/Stellar_Card/workflows/Security%20Audit/badge.svg)
![Publish](https://github.com/devpeter999/Stellar_Card/workflows/Publish%20to%20npm/badge.svg)
```

## Troubleshooting

### Test Workflow Fails

1. Check logs in Actions tab
2. Common issues:
   - Node.js version incompatibility
   - Missing environment variable
   - Test isolation issue (use `beforeEach`/`afterEach`)

### Publish Fails

1. Verify npm token is valid
2. Check version isn't already published: `npm view stellar_card versions`
3. Ensure `package.json` version matches git tag
4. Check dist files were built: `npm run build`

### Dependabot PRs Not Opening

1. Enable Dependabot in repo settings
2. Check `.github/dependabot.yml` syntax
3. Verify package manager is detected (run actions manually)

## Caching Strategy

All workflows cache dependencies and build artifacts to keep CI fast:

| Workflow | Cache | Key basis |
|----------|-------|-----------|
| `test.yml`, `a11y.yml` | npm store + Node modules (via `.github/actions/setup-node`) | OS, Node version, `package-lock.json` hash |
| `test.yml` | TypeScript `.tsbuildinfo` | OS, Node version, `src/**` + `tsconfig*.json` hash |
| `e2e.yml`, `a11y.yml` | Playwright browser binaries (`~/.cache/ms-playwright`) | OS, installed `@playwright/test` version, matrix project |
| `sdk-validate.yml`, `publish.yml`, `release.yml` | npm store (via `actions/setup-node@v4` `cache: npm`) | `package-lock.json` hash |
| `security.yml` | npm store (via `actions/setup-node@v4` `cache: npm`) | `package-lock.json` hash per audited directory |

Playwright caches are keyed per browser project so each matrix job (`chromium`, `firefox`, `webkit`) only restores its own binaries — a cache hit still runs `playwright install-deps` to pull OS-level shared libraries, which don't persist inside the cached path.

Use the reusable `.github/actions/setup-node` composite action for any new workflow that runs `npm ci` — it wires up both the npm store cache and `actions/setup-node`'s built-in lockfile cache with a consistent key format.

## Best Practices

1. **Always run tests locally before pushing**
   ```bash
   cd stellar_card-sdk
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

2. **Keep dependencies up to date**
   - Review and merge Dependabot PRs regularly
   - Test before merging major version bumps

3. **Write meaningful commit messages**
   - Helps generate better changelogs
   - Use `feat:`, `fix:`, `refactor:` prefixes

4. **Create GitHub releases**
   - Document migration guides for breaking changes
   - Include links to related PRs/issues

5. **Monitor test results**
   - Set up branch protection requiring CI to pass
   - Pin actions to specific versions for reproducibility

## Version Numbers

SDK uses [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking API changes (e.g., 0.4.0 → 1.0.0)
- **MINOR**: New features, backward compatible (e.g., 0.4.0 → 0.5.0)
- **PATCH**: Bug fixes, no API changes (e.g., 0.4.7 → 0.4.8)

## Environment Variables

### For Local Testing

```bash
# Allow insecure (http://) base URLs in tests
export CARDS402_ALLOW_INSECURE_BASE_URL=1

# Test with specific Node versions using nvm
nvm use 18
nvm use 20
nvm use 22
```

### In GitHub Actions

Set in workflow files:
```yaml
env:
  CARDS402_ALLOW_INSECURE_BASE_URL: '1'
```

Or use repository/organization secrets:
```bash
gh secret set MY_SECRET --body "value"
```

## Monitoring

- **GitHub Actions**: https://github.com/devpeter999/Stellar_Card/actions
- **npm package**: https://www.npmjs.com/package/stellar_card
- **Codecov**: (after first test run with coverage)
- **Slack notifications**: Configure webhook (optional)

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [npm Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
