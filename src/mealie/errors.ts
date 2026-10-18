/** Why a call to Mealie failed. `http` carries the status Mealie answered with. */
export type MealieErrorKind = 'http' | 'network' | 'timeout' | 'invalid_response';

export class MealieError extends Error {
  constructor(
    readonly kind: MealieErrorKind,
    message: string,
    readonly status?: number,
    /** Mealie's own explanation, from the `detail` field of its error body. */
    readonly detail?: string
  ) {
    super(message);
    this.name = 'MealieError';
  }
}

/** A slug or id that cannot be placed safely in a URL path. */
export class InvalidPathSegmentError extends Error {
  constructor(readonly value: string) {
    super(`Invalid path segment: ${JSON.stringify(value)}`);
    this.name = 'InvalidPathSegmentError';
  }
}

export interface ErrorHints {
  /** What the model should do when Mealie answers 404, e.g. which search tool to use. */
  notFound?: string;
}

/** Turns a failure into a message the model can act on. Never includes traces or tokens. */
export function describeError(err: unknown, hints: ErrorHints = {}): string {
  if (err instanceof InvalidPathSegmentError) {
    return `Invalid identifier ${JSON.stringify(err.value)}: use an id or slug returned by another tool.`;
  }
  if (!(err instanceof MealieError)) return 'Unexpected server error.';
  switch (err.kind) {
    case 'timeout':
      return 'Mealie did not answer in time. Try again later.';
    case 'network':
      return 'Mealie is unreachable. Try again later.';
    case 'invalid_response':
      return 'Mealie sent a response this server cannot read.';
    case 'http':
      return describeStatus(err.status ?? 0, err.detail, hints);
  }
}

function describeStatus(status: number, detail: string | undefined, hints: ErrorHints): string {
  const because = detail ? ` Mealie says: ${detail}` : '';
  if (status === 401) return 'Mealie rejected the API token (expired or revoked). Ask the user to update the token in the connector settings.';
  if (status === 403) return `The Mealie user is not allowed to do this.${because}`;
  if (status === 404) return `Not found in Mealie.${hints.notFound ? ` ${hints.notFound}` : ''}`;
  if (status === 409) return `Conflict with existing data in Mealie.${because}`;
  if (status === 429) return 'Mealie is rate limiting requests. Try again later.';
  if (status >= 500) return 'Mealie failed to handle the request. Try again later.';
  return `Mealie rejected the request (HTTP ${status}).${because}`;
}
