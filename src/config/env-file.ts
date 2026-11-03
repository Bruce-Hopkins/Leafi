/**
 * Sets each name in a dotenv text. An existing assignment (plain,
 * `export`-prefixed, or spaced around `=`) is replaced in place; a missing one
 * is appended, under `# <comment>` when one is given. Every other line is kept
 * as it was.
 */
export function setEnvValues(content: string, values: Readonly<Record<string, string>>, comment?: string): string {
  let result = content;
  const appended: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${quoteEnvValue(value)}`;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`, 'gm');
    let found = false;
    result = result.replace(pattern, () => {
      found = true;
      return line;
    });
    if (!found) {
      appended.push(line);
    }
  }
  if (appended.length === 0) {
    return result;
  }

  const block = [...(comment ? [`# ${comment}`] : []), ...appended].join('\n');
  const base = result.trimEnd();
  return base.length === 0 ? `${block}\n` : `${base}\n${comment ? '\n' : ''}${block}\n`;
}

/** Quotes a value only when dotenv would misread it: whitespace, `#` or quotes. */
function quoteEnvValue(value: string): string {
  if (!/[\s#"']/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
