import type { IncomingMessage } from 'node:http';

/**
 * The client address, as Express computes it with `trust proxy` set to a hop count: with
 * `trustedHops` = 0 the socket address; with n > 0 the n-th address from the right of
 * `X-Forwarded-For`, or the leftmost one when the header holds fewer.
 */
export function clientIp(req: IncomingMessage, trustedHops: number): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (trustedHops === 0) return socketIp;
  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const chain = [socketIp, ...forwarded.reverse()];
  return chain[Math.min(trustedHops, chain.length - 1)]!;
}
