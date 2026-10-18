import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('applies defaults when only MEALIE_URL is set', () => {
    expect(loadConfig({ MEALIE_URL: 'http://mealie:9000' })).toEqual({ mealieUrl: 'http://mealie:9000', port: 8080, logLevel: 'info', trustProxy: 0 });
  });

  it('strips trailing slashes and keeps a base path', () => {
    expect(loadConfig({ MEALIE_URL: 'https://example.com/mealie/' }).mealieUrl).toBe('https://example.com/mealie');
  });

  it('reads PORT and LOG_LEVEL', () => {
    expect(loadConfig({ MEALIE_URL: 'http://mealie:9000', PORT: '3000', LOG_LEVEL: 'DEBUG' })).toMatchObject({ port: 3000, logLevel: 'debug' });
  });

  it('reads TRUST_PROXY as a hop count', () => {
    expect(loadConfig({ MEALIE_URL: 'http://mealie:9000', TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(problemsOf({ MEALIE_URL: 'http://mealie:9000', TRUST_PROXY: 'true' })).toEqual([expect.stringContaining('TRUST_PROXY')]);
  });

  it('requires MEALIE_URL', () => {
    expect(problemsOf({})).toEqual([expect.stringContaining('MEALIE_URL is required')]);
  });

  it.each([
    ['not a url', 'not a valid URL'],
    ['ftp://mealie', 'http:// or https://'],
    ['http://user:secret@mealie:9000', 'must not contain'],
    ['http://mealie:9000/?x=1', 'must not contain'],
  ])('rejects MEALIE_URL=%s', (value, message) => {
    expect(problemsOf({ MEALIE_URL: value })).toEqual([expect.stringContaining(message)]);
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({ PORT: '99999', LOG_LEVEL: 'loud' });
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/MEALIE_URL[\s\S]*PORT[\s\S]*LOG_LEVEL/);
  });
});
