import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const rootDir = resolve(import.meta.dirname, '..');

describe('Dependabot Security Updates Configuration', () => {
  const dependabotPath = resolve(rootDir, '.github/dependabot.yml');
  const securityWorkflowPath = resolve(rootDir, '.github/workflows/security.yml');

  it('verifies dependabot.yml and security.yml exist', () => {
    expect(existsSync(dependabotPath)).toBe(true);
    expect(existsSync(securityWorkflowPath)).toBe(true);
  });

  it('validates dependabot.yml structure and ecosystem entries', () => {
    const content = readFileSync(dependabotPath, 'utf-8');
    const dependabot = parseYaml(content);

    expect(dependabot.version).toBe(2);
    expect(dependabot.updates).toBeDefined();

    const directories = dependabot.updates.map(u => u.directory);
    const ecosystems = dependabot.updates.map(u => u['package-ecosystem']);

    expect(directories).toContain('/stellar_card-sdk');
    expect(directories).toContain('/stellar_card-backend');
    expect(directories).toContain('/stellar_card-frontend');
    expect(directories).toContain('/stellar_card-contract');
    expect(directories).toContain('/');

    expect(ecosystems).toContain('npm');
    expect(ecosystems).toContain('cargo');
    expect(ecosystems).toContain('github-actions');
    expect(ecosystems).toContain('docker');
  });

  it('enforces conventional commits and reviewers across all dependabot entries', () => {
    const content = readFileSync(dependabotPath, 'utf-8');
    const dependabot = parseYaml(content);

    for (const update of dependabot.updates) {
      expect(update.reviewers).toContain('devpeter999');
      expect(update.schedule.interval).toBe('weekly');
      expect(update['commit-message']).toBeDefined();
    }
  });

  it('validates security.yml workflow audits multiple subpackages', () => {
    const content = readFileSync(securityWorkflowPath, 'utf-8');
    expect(content).toContain('stellar_card-sdk');
    expect(content).toContain('stellar_card-backend');
    expect(content).toContain('stellar_card-frontend');
    expect(content).toContain('stellar_card-contract/Cargo.toml');
  });

  it('watches the directories where Dockerfiles actually live', () => {
    const dependabot = parseYaml(readFileSync(dependabotPath, 'utf-8'));

    // The docker ecosystem does not recurse, so an entry pointing at '/' —
    // where this repo has no Dockerfile — silently checks nothing.
    const dockerDirs = dependabot.updates
      .filter(u => u['package-ecosystem'] === 'docker')
      .map(u => u.directory);

    expect(dockerDirs).toContain('/stellar_card-backend');
    expect(dockerDirs).toContain('/stellar_card-frontend');
    expect(dockerDirs).not.toContain('/');

    // Every watched directory must really hold a Dockerfile.
    for (const dir of dockerDirs) {
      expect(existsSync(resolve(rootDir, `.${dir}/Dockerfile`))).toBe(true);
    }
  });

  it('covers the images pinned directly in docker-compose.yml', () => {
    const dependabot = parseYaml(readFileSync(dependabotPath, 'utf-8'));
    const ecosystems = dependabot.updates.map(u => u['package-ecosystem']);
    expect(ecosystems).toContain('docker-compose');
  });

  it('groups routine updates so a weekly run does not flood the PR queue', () => {
    const dependabot = parseYaml(readFileSync(dependabotPath, 'utf-8'));

    const grouped = dependabot.updates.filter(u => u.groups && Object.keys(u.groups).length > 0);
    expect(grouped.length).toBeGreaterThanOrEqual(5);

    // Groups must never sweep up a major bump — those need a human.
    for (const update of grouped) {
      for (const group of Object.values(update.groups)) {
        if (group['update-types']) {
          expect(group['update-types']).not.toContain('major');
          expect(group['update-types']).not.toContain('version-update:semver-major');
        }
      }
    }
  });

  it('every ecosystem entry is reviewed, labelled, and rate-limited', () => {
    const dependabot = parseYaml(readFileSync(dependabotPath, 'utf-8'));

    for (const update of dependabot.updates) {
      expect(update.labels, `${update.directory} has no labels`).toBeDefined();
      expect(update.labels).toContain('security');
      expect(update['open-pull-requests-limit']).toBeGreaterThan(0);
    }
  });
});

describe('Dependabot Auto-Merge Automation', () => {
  const autoMergePath = resolve(rootDir, '.github/workflows/dependabot-auto-merge.yml');

  it('provides an auto-merge workflow', () => {
    expect(existsSync(autoMergePath)).toBe(true);
  });

  it('only runs for pull requests actually opened by Dependabot', () => {
    const workflow = parseYaml(readFileSync(autoMergePath, 'utf-8'));
    const condition = workflow.jobs['auto-merge'].if;

    // Without an actor check, anyone could open a lookalike PR and have it
    // approved and merged automatically.
    expect(condition).toContain("github.actor == 'dependabot[bot]'");
    expect(condition).toContain("github.event.pull_request.user.login == 'dependabot[bot]'");
  });

  it('never auto-merges a major version bump', () => {
    const content = readFileSync(autoMergePath, 'utf-8');

    expect(content).toContain('version-update:semver-patch');
    expect(content).not.toContain('version-update:semver-major)');
  });

  it('restricts minor auto-merges to development dependencies', () => {
    const content = readFileSync(autoMergePath, 'utf-8');
    expect(content).toContain('direct:development');
  });

  it('grants write permission at the job level, not the workflow level', () => {
    const workflow = parseYaml(readFileSync(autoMergePath, 'utf-8'));

    // Workflow-level defaults should stay read-only so any job added later
    // starts from least privilege.
    expect(workflow.permissions.contents).toBe('read');
    expect(workflow.jobs['auto-merge'].permissions['contents']).toBe('write');
    expect(workflow.jobs['auto-merge'].permissions['pull-requests']).toBe('write');
  });
});

describe('Security workflow supply-chain hygiene', () => {
  const securityWorkflowPath = resolve(rootDir, '.github/workflows/security.yml');

  it('audits Cargo dependencies against the RustSec advisory database', () => {
    const content = readFileSync(securityWorkflowPath, 'utf-8');

    // Trivy's filesystem scan is not a substitute for cargo-audit.
    expect(content).toContain('cargo audit');
  });

  it('pins third-party actions instead of tracking a moving branch', () => {
    const content = readFileSync(securityWorkflowPath, 'utf-8');

    // `uses: ...@master` runs whatever is on someone else's default branch.
    expect(content).not.toContain('@master');
  });

  it('uses the supported major version of the CodeQL action', () => {
    const content = readFileSync(securityWorkflowPath, 'utf-8');
    expect(content).not.toContain('codeql-action/init@v2');
    expect(content).not.toContain('codeql-action/analyze@v2');
    expect(content).not.toContain('codeql-action/upload-sarif@v2');
  });
});
