import { isLogLevel, LOG_LEVELS, type LogLevel } from './log.js';

export interface Config {
  /** Mealie as this server reaches it, e.g. http://mealie:9000 on the Docker network. No trailing slash. */
  mealieUrl: string;
  port: number;
  logLevel: LogLevel;
  /** Number of reverse proxies in front of the server whose X-Forwarded-For is trusted. */
  trustProxy: number;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const mealieUrl = parseMealieUrl(env.MEALIE_URL, problems);
  const port = parsePort(env.PORT, problems);
  const logLevel = parseLogLevel(env.LOG_LEVEL, problems);
  const trustProxy = parseTrustProxy(env.TRUST_PROXY, problems);
  if (problems.length > 0 || mealieUrl === undefined) throw new ConfigError(problems);
  return { mealieUrl, port, logLevel, trustProxy };
}

function parseMealieUrl(value: string | undefined, problems: string[]): string | undefined {
  if (!value) {
    problems.push('MEALIE_URL is required, e.g. http://mealie:9000');
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`MEALIE_URL is not a valid URL: ${value}`);
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push('MEALIE_URL must start with http:// or https://');
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push('MEALIE_URL must not contain credentials, a query string or a fragment');
    return undefined;
  }
  return url.href.replace(/\/+$/, '');
}

function parsePort(value: string | undefined, problems: string[]): number {
  if (value === undefined || value === '') return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535, got: ${value}`);
    return 8080;
  }
  return port;
}

function parseLogLevel(value: string | undefined, problems: string[]): LogLevel {
  if (value === undefined || value === '') return 'info';
  const level = value.toLowerCase();
  if (!isLogLevel(level)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got: ${value}`);
    return 'info';
  }
  return level;
}

function parseTrustProxy(value: string | undefined, problems: string[]): number {
  if (value === undefined || value === '') return 0;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    problems.push(`TRUST_PROXY must be the number of trusted reverse proxies, from 0 to 10, got: ${value}`);
    return 0;
  }
  return hops;
}
