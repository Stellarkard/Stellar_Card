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
});
