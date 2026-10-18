import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Dockerfile', () => {
  it('builds on the Node version of .node-version', () => {
    const image = /^ARG NODE_IMAGE=node:(\S+)-alpine$/m.exec(read('Dockerfile'))?.[1];
    expect(image).toBe(read('.node-version').trim());
  });

  it('runs as a non-root user with a health check', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK .*\n.*\/healthz/m);
  });
});
