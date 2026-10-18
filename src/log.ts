export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Keys whose values never reach the logs, wherever they appear. The server never logs request
 * headers on purpose; this is a second line of defense against a token slipping into a log line.
 */
const REDACTED_KEYS = new Set(['authorization', 'cookie', 'set-cookie', 'token', 'mealietoken', 'apikey', 'api_key', 'password']);

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

/** JSON-lines logger: one object per line with time, level and msg, then the extra fields. */
export function createLogger(level: LogLevel, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const threshold = RANK[level];
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields) => {
    if (RANK[lvl] < threshold) return;
    const extra = fields ? (sanitize(fields) as LogFields) : {};
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...extra }));
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
