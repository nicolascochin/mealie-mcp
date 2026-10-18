import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { parseBearer } from '../auth/bearer.js';
import type { FailureLimiter } from '../auth/limiter.js';
import type { TokenValidator } from '../auth/validator.js';
import type { Logger } from '../log.js';
import { clientIp } from './client-ip.js';

export interface AuthGateDeps {
  validator: TokenValidator;
  limiter: FailureLimiter;
  trustProxy: number;
  logger: Logger;
}

/** Answers the request itself when authentication fails; `undefined` then means: stop here. */
export type AuthGate = (req: IncomingMessage, res: ServerResponse) => Promise<AuthInfo | undefined>;

function reject(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): undefined {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
  return undefined;
}

/**
 * Requires `Authorization: Bearer <Mealie API token>` and checks the token with Mealie.
 * Only tokens Mealie refuses count as failures for the per-IP limit.
 */
export function createAuthGate({ validator, limiter, trustProxy, logger }: AuthGateDeps): AuthGate {
  return async (req, res) => {
    const token = parseBearer(req.headers.authorization);
    if (!token) {
      return reject(res, 401, 'Missing Mealie API token: send "Authorization: Bearer <token>".', {
        'www-authenticate': 'Bearer realm="mealie-mcp"',
      });
    }

    const ip = clientIp(req, trustProxy);
    const retryAfter = limiter.retryAfterSeconds(ip);
    if (retryAfter > 0) {
      logger.warn('auth blocked', { ip, retryAfter });
      return reject(res, 429, 'Too many failed authentication attempts. Try again later.', { 'retry-after': String(retryAfter) });
    }

    const result = await validator.validate(token);
    if (!result.ok && result.reason === 'invalid_token') {
      limiter.recordFailure(ip);
      logger.warn('auth rejected', { ip });
      return reject(res, 401, 'Invalid Mealie API token.', {
        'www-authenticate': 'Bearer realm="mealie-mcp", error="invalid_token"',
      });
    }
    if (!result.ok) {
      logger.error('auth unavailable', { err: result.error });
      return reject(res, 503, 'Mealie is unavailable. Try again later.', { 'retry-after': '30' });
    }

    return { token, clientId: 'mealie', scopes: [], extra: { userId: result.user.id } };
  };
}
