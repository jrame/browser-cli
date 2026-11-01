export const findUsage = 'Use browser find <session> "Sign in" or browser find <session> --regex "Sign (in|up)".';
export const regexValueError = '--regex requires exactly one pattern value (it is not a boolean flag). Example: browser find <session> --regex "Sign (in|up)".';

export function compileFindRegex(source: string): RegExp {
  const literal = /^\/(.*)\/([a-z]*)$/.exec(source);
  const pattern = literal ? literal[1] : source;
  const flags = literal ? literal[2].replace(/g/g, '') : '';
  return new RegExp(pattern, flags);
}

// Shared by the client, daemon and backend so malformed queries never become text searches.
export function findQueryError(text: string | undefined, regex: unknown): string | undefined {
  if (regex !== undefined && typeof regex !== 'string')
    return regexValueError;
  if (!text && !regex)
    return `Provide a nonempty text argument or a --regex pattern. ${findUsage}`;
  if (text && regex)
    return `Provide either a text argument or --regex with its pattern, not both. ${findUsage}`;
  if (typeof regex === 'string' && regex) {
    try {
      compileFindRegex(regex);
    } catch (error) {
      return `Invalid regular expression ${JSON.stringify(regex)}: ${(error as Error).message}. ${findUsage}`;
    }
  }
}

export function validateFindQuery(text: string | undefined, regex: unknown): void {
  const error = findQueryError(text, regex);
  if (error)
    throw new Error(error);
}
