import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const rootDir = resolve(import.meta.dirname, '..');

describe('Docker Compose and Local Development Configuration', () => {
  const composePath = resolve(rootDir, 'docker-compose.yml');
  const backendDockerfile = resolve(rootDir, 'stellar_card-backend/Dockerfile');
  const frontendDockerfile = resolve(rootDir, 'stellar_card-frontend/Dockerfile');

  it('verifies docker-compose.yml and Dockerfiles exist', () => {
    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(backendDockerfile)).toBe(true);
    expect(existsSync(frontendDockerfile)).toBe(true);
    expect(existsSync(resolve(rootDir, '.dockerignore'))).toBe(true);
    expect(existsSync(resolve(rootDir, 'stellar_card-backend/.dockerignore'))).toBe(true);
    expect(existsSync(resolve(rootDir, 'stellar_card-frontend/.dockerignore'))).toBe(true);
  });

  it('validates docker-compose services, ports, and dependencies', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content);

    expect(compose.services).toBeDefined();
    expect(compose.services.backend).toBeDefined();
    expect(compose.services.frontend).toBeDefined();

    // Check backend config
    const backend = compose.services.backend;
    expect(backend.ports).toContain('4000:4000');
    expect(backend.healthcheck).toBeDefined();

    // Check frontend config
    const frontend = compose.services.frontend;
    expect(frontend.ports).toContain('3000:3000');
    expect(frontend.depends_on.backend).toBeDefined();
  });

  it('validates backend Dockerfile setup', () => {
    const content = readFileSync(backendDockerfile, 'utf-8');
    expect(content).toContain('FROM node:20-alpine');
    expect(content).toContain('EXPOSE 4000');
    expect(content).toContain('CMD');
  });

  it('validates frontend Dockerfile setup', () => {
    const content = readFileSync(frontendDockerfile, 'utf-8');
    expect(content).toContain('FROM node:20-alpine');
    expect(content).toContain('EXPOSE 3000');
    expect(content).toContain('CMD');
  });

  it('omits the obsolete top-level version key', () => {
    // Compose v2 ignores `version:` and warns about it on every invocation.
    const compose = parseYaml(readFileSync(composePath, 'utf-8'));
    expect(compose.version).toBeUndefined();
  });

  it('gives every long-running service a healthcheck', () => {
    const compose = parseYaml(readFileSync(composePath, 'utf-8'));

    // Without one on the frontend, `up --wait` and any future dependant would
    // treat "container started" as "ready to serve".
    expect(compose.services.frontend.healthcheck).toBeDefined();
    expect(compose.services.backend.healthcheck).toBeDefined();
  });

  it('pins each service to an explicit Dockerfile build stage', () => {
    const compose = parseYaml(readFileSync(composePath, 'utf-8'));

    // An implicit target silently means "last stage in the file", so adding a
    // dev stage at the bottom would otherwise change what `up` builds.
    expect(compose.services.backend.build.target).toBe('base');
    expect(compose.services.frontend.build.target).toBe('runner');
  });

  it('keeps optional tooling services behind a profile', () => {
    const compose = parseYaml(readFileSync(composePath, 'utf-8'));

    expect(compose.services.sdk).toBeDefined();
    expect(compose.services.contract).toBeDefined();
    expect(compose.services.sdk.profiles).toContain('tools');
    expect(compose.services.contract.profiles).toContain('tools');

    // The default `up` must not start them.
    const defaultServices = Object.entries(compose.services)
      .filter(([, service]) => !service.profiles?.length)
      .map(([name]) => name);
    expect(defaultServices.sort()).toEqual(['backend', 'frontend']);
  });

  it('treats developer .env files as optional', () => {
    const compose = parseYaml(readFileSync(composePath, 'utf-8'));

    // A required-but-missing env_file aborts the whole stack, which would
    // block anyone who has not created a local .env yet.
    for (const entry of compose.services.backend.env_file) {
      expect(entry.required).toBe(false);
    }
  });
});

describe('Docker Compose Development Overlay', () => {
  const devComposePath = resolve(rootDir, 'docker-compose.dev.yml');

  it('provides a dev overlay file', () => {
    expect(existsSync(devComposePath)).toBe(true);
  });

  it('targets the dev build stage for both services', () => {
    const dev = parseYaml(readFileSync(devComposePath, 'utf-8'));

    expect(dev.services.backend.build.target).toBe('dev');
    expect(dev.services.frontend.build.target).toBe('dev');
  });

  it('bind-mounts host source so edits are picked up without a rebuild', () => {
    const dev = parseYaml(readFileSync(devComposePath, 'utf-8'));

    const backendMounts = dev.services.backend.volumes.join(' ');
    const frontendMounts = dev.services.frontend.volumes.join(' ');

    expect(backendMounts).toContain('./stellar_card-backend/src:/app/src');
    expect(frontendMounts).toContain('./stellar_card-frontend:/app');
  });

  it('shields node_modules and .next from the host bind mount', () => {
    const dev = parseYaml(readFileSync(devComposePath, 'utf-8'));

    // A bare bind mount would shadow the container's installed dependencies
    // with the host tree, which is either absent or built for another platform.
    expect(dev.services.backend.volumes).toContain('backend-node-modules:/app/node_modules');
    expect(dev.services.frontend.volumes).toContain('frontend-node-modules:/app/node_modules');
    expect(dev.services.frontend.volumes).toContain('frontend-next-cache:/app/.next');

    expect(dev.volumes['backend-node-modules']).toBeDefined();
    expect(dev.volumes['frontend-node-modules']).toBeDefined();
    expect(dev.volumes['frontend-next-cache']).toBeDefined();
  });

  it('disables restart looping during development', () => {
    const dev = parseYaml(readFileSync(devComposePath, 'utf-8'));

    // A crash should surface the error, not restart forever behind your back.
    expect(dev.services.backend.restart).toBe('no');
    expect(dev.services.frontend.restart).toBe('no');
  });
});

describe('Dockerfile development stages', () => {
  const backendDockerfile = resolve(rootDir, 'stellar_card-backend/Dockerfile');
  const frontendDockerfile = resolve(rootDir, 'stellar_card-frontend/Dockerfile');

  it('backend Dockerfile defines a dev stage that watches for changes', () => {
    const content = readFileSync(backendDockerfile, 'utf-8');

    expect(content).toContain('AS base');
    expect(content).toContain('AS dev');
    expect(content).toContain('"--watch"');
  });

  it('frontend Dockerfile defines a dev stage running the Next dev server', () => {
    const content = readFileSync(frontendDockerfile, 'utf-8');

    expect(content).toContain('AS runner');
    expect(content).toContain('AS dev');
    expect(content).toContain('"npm", "run", "dev"');
  });

  it('backend dev stage avoids the --env-file dev script', () => {
    const content = readFileSync(backendDockerfile, 'utf-8');

    // `npm run dev` passes --env-file=.env, and Node exits non-zero when that
    // file is missing; under Compose the env arrives from the compose file.
    const devStage = content.slice(content.indexOf('AS dev'));
    expect(devStage).not.toContain('--env-file');
  });
});
