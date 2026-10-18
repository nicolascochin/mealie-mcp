const MAX_TOKEN_LENGTH = 4096;

/** Returns the token of an `Authorization: Bearer <token>` header, or undefined if absent or malformed. */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer[ ]+([^\s]+)[ ]*$/i.exec(header);
  const token = match?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) return undefined;
  return token;
}
