import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };

describe('VERSION', () => {
  it('matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('has its release notes in CHANGELOG.md', () => {
    // The release workflow publishes this section as the notes of the release.
    expect(read('CHANGELOG.md').split('\n')).toContain(`## ${pkg.version}`);
  });
});
