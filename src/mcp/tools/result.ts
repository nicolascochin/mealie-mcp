import type { CallToolResult } from '@modelcontextprotocol/server';
import { describeError, InvalidPathSegmentError, MealieError, type ErrorHints } from '../../mealie/errors.js';
import type { Logger } from '../../log.js';

/** Runs a tool body and returns its value as compact JSON, or an actionable error message. */
export async function runTool(logger: Logger, tool: string, body: () => Promise<unknown>, hints?: ErrorHints): Promise<CallToolResult> {
  try {
    const value = await body();
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (err) {
    if (err instanceof MealieError) logger.warn('mealie call failed', { tool, kind: err.kind, status: err.status });
    else if (!(err instanceof InvalidPathSegmentError)) logger.error('tool failed', { tool, err });
    return { isError: true, content: [{ type: 'text', text: describeError(err, hints) }] };
  }
}
