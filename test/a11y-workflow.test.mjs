import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const rootDir = resolve(import.meta.dirname, '..');
const workflowPath = resolve(rootDir, '.github/workflows/a11y.yml');
const workflowContent = readFileSync(workflowPath, 'utf-8');
const workflow = parseYaml(workflowContent);

describe('Accessibility audit workflow', () => {
  it('triggers on push to main and feature branches', () => {
    const pushBranches = workflow.on.push.branches;
    expect(pushBranches).toContain('main');
    expect(pushBranches).toContain('feature/**');
  });

  it('triggers on pull requests', () => {
    expect(workflow.on.pull_request).toBeDefined();
    expect(workflow.on.pull_request.branches).toContain('main');
  });

  it('has scheduled runs', () => {
    expect(workflow.on.schedule).toBeDefined();
    expect(workflow.on.schedule[0].cron).toBeTruthy();
  });

  it('includes a11y-audit job', () => {
    expect(workflow.jobs['a11y-audit']).toBeDefined();
  });

  it('runs playwright tests', () => {
    const steps = workflow.jobs['a11y-audit'].steps;
    const playwrightStep = steps.find(s => s.name?.includes('Playwright'));
    expect(playwrightStep).toBeDefined();
  });

  it('runs storybook a11y checks', () => {
    const steps = workflow.jobs['a11y-audit'].steps;
    const storybookStep = steps.find(s => s.name?.includes('Storybook'));
    expect(storybookStep).toBeDefined();
  });
});
