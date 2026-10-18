import { describe, expect, it } from 'vitest';
import { createLogger, type LogLevel } from '../src/log.js';

function capture(level: LogLevel) {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger(level, (line) => lines.push(JSON.parse(line) as Record<string, unknown>));
  return { logger, lines };
}

describe('createLogger', () => {
  it('writes one JSON object per line with time, level, msg and fields', () => {
    const { logger, lines } = capture('info');
    logger.info('hello', { path: '/mcp', status: 200 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', msg: 'hello', path: '/mcp', status: 200 });
    expect(typeof lines[0]!.time).toBe('string');
  });

  it('drops messages below the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines.map((l) => l.msg)).toEqual(['c', 'd']);
  });

  it('writes nothing when silent', () => {
    const { logger, lines } = capture('silent');
    logger.error('boom');
    expect(lines).toEqual([]);
  });

  it('redacts credentials wherever they appear', () => {
    const { logger, lines } = capture('info');
    logger.info('request', { headers: { Authorization: 'Bearer secret', Cookie: 'c=1', accept: 'json' }, token: 'secret' });
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('secret');
    expect(lines[0]).toMatchObject({ headers: { Authorization: '[redacted]', Cookie: '[redacted]', accept: 'json' }, token: '[redacted]' });
  });

  it('serializes errors as name and message', () => {
    const { logger, lines } = capture('info');
    logger.error('failed', { err: new TypeError('bad input') });
    expect(lines[0]).toMatchObject({ err: { name: 'TypeError', message: 'bad input' } });
  });
});
