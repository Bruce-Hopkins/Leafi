/** A small heuristic for turning an HTML body into readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Collapses a long tracking URL to its origin, which is all the text needs.
 * Alert mail is mostly click-tracking links; keeping them whole spends a
 * reader's attention and a node's context on a redirect target.
 */
export function compactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>()"']+/g, (url) => {
    if (url.length <= 80) {
      return url;
    }
    const origin = /^https?:\/\/[^/?#]+/.exec(url);
    return origin ? `${origin[0]}/\u2026` : url;
  });
}

/** Decodes Gmail's base64url bodies, tolerating the missing padding they use. */
export function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

export function requireString(args: Record<string, unknown>, key: string, options?: { allowEmpty?: boolean }): string {
  const value = args[key];
  if (typeof value !== 'string' || (!options?.allowEmpty && value.trim().length === 0)) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function optionalPositiveInt(
  args: Record<string, unknown>,
  key: string,
  options: { fallback: number; max: number },
): number {
  const value = args[key];
  if (value === undefined || value === null) {
    return options.fallback;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`"${key}" must be a positive number.`);
  }
  return Math.min(Math.trunc(parsed), options.max);
}

export function optionalStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`"${key}" must be a list of strings.`);
  }
  return value.flatMap((entry) => (typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim()] : []));
}
