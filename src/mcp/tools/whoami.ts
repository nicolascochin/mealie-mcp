import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolDeps } from '../server.js';
import { runTool } from './result.js';

export function registerWhoami(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_whoami',
    {
      title: 'Current Mealie user',
      description: 'Return the connected Mealie user: name, household and group.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      runTool(logger, 'mealie_whoami', async () => {
        const user = await mealie.getSelf();
        return {
          username: user.username,
          fullName: user.fullName ?? null,
          household: user.household ?? null,
          group: user.group ?? null,
        };
      })
  );
}
