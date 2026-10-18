import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { createMcpServer } from '../mcp/server.js';

export const MCP_PATH = '/mcp';
export const HEALTH_PATH = '/healthz';

export interface AppDeps {
  config: Config;
  logger: Logger;
}

export interface App {
  server: Server;
  /** Stops accepting connections and tears down in-flight MCP exchanges. */
  close(): Promise<void>;
}

/** Path only: query strings never reach the logs. */
function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function sendText(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function createApp({ logger }: AppDeps): App {
  const handler = createMcpHandler(() => createMcpServer(), {
    onerror: (err) => logger.warn('mcp request error', { err }),
  });
  const mcp = toNodeHandler(handler, {
    onerror: (err) => logger.error('mcp adapter error', { err }),
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const start = performance.now();
    const path = pathOf(req.url);
    res.on('finish', () => {
      const fields = { method: req.method, path, status: res.statusCode, ms: Math.round(performance.now() - start) };
      if (path === HEALTH_PATH) logger.debug('request', fields);
      else logger.info('request', fields);
    });

    if (path === HEALTH_PATH) {
      if (req.method === 'GET' || req.method === 'HEAD') return sendText(res, 200, 'ok');
      return sendText(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    }

    if (path === MCP_PATH) {
      mcp(req, res).catch((err: unknown) => {
        logger.error('unhandled mcp error', { err });
        if (!res.headersSent) sendText(res, 500, 'Internal server error');
        else res.end();
      });
      return;
    }

    sendText(res, 404, 'Not found');
  });

  return {
    server,
    async close() {
      await handler.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
