import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { bundlePiExtension, bundleServer, packageVersion, root, thirdPartyNotices } from './lib/bundle.mjs';

const pkgDir = path.join(root, 'pi-extension');
const dist = path.join(pkgDir, 'dist');
const PREFIX = 'leafi_';
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(pkgDir, 'skills', 'leafi'), { recursive: true });

try {
  const version = packageVersion();
  const serverMeta = await bundleServer(path.join(dist, 'server.mjs'));
  const extensionMeta = await bundlePiExtension(path.join(dist, 'index.js'));
  // index.js finds its own folder through this, as src/version.ts finds its version.
  const entry = path.join(dist, 'index.js');
  fs.writeFileSync(
    entry,
    "import { fileURLToPath as __piFileURLToPath } from 'node:url';\nconst __PI_DIR__ = __piFileURLToPath(new URL('.', import.meta.url));\n" +
      fs.readFileSync(entry, 'utf8'),
  );
  fs.writeFileSync(
    path.join(dist, 'THIRD_PARTY_NOTICES.md'),
    thirdPartyNotices([serverMeta, extensionMeta], {
      root,
      generatedBy: 'scripts/build-pi-extension.mjs',
      bundles: '`server.mjs` and `index.js` bundle',
    }),
  );

  // The tools come from the same list the server registers, so they cannot drift.
  const { TOOLS } = await import(pathToFileURL(path.join(root, 'dist', 'mcp', 'registry.js')).href);
  const names = TOOLS.map((tool) => tool.name);
  const namePattern = new RegExp(`\\b(${[...names].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');
  const tools = TOOLS.map((tool) => ({
    name: tool.name,
    description: piDescription(tool.name, tool.description, namePattern),
    inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }),
  }));
  fs.writeFileSync(path.join(dist, 'tools.json'), `${JSON.stringify({ version, tools }, null, 2)}\n`);

  fs.writeFileSync(path.join(pkgDir, 'skills', 'leafi', 'SKILL.md'), piSkill(tools.map((tool) => tool.name)));

  const manifestFile = path.join(pkgDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(pkgDir, 'LICENSE'));

  process.stderr.write(`Built ${path.relative(root, dist)} (${tools.length} tools + ${PREFIX}wait_run) and the Pi skill\n`);
} catch (error) {
  process.stderr.write(`Pi extension build failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}

/**
 * The Hermes skill with the Pi tool names, and the two places where Pi does
 * something different. Each replacement must match, so a change to the
 * Hermes skill that breaks this fails the build instead of shipping stale text.
 */
function piSkill(toolNames) {
  let text = fs.readFileSync(path.join(root, 'hermes-plugin', 'skills', 'leafi', 'SKILL.md'), 'utf8');

  for (const name of toolNames) {
    text = text.replaceAll(`\`${name}\``, `\`${PREFIX}${name}\``);
  }

  text = replaceOnce(text, 'through the leafi MCP tools', 'through the leafi tools');
  text = replaceOnce(
    text,
    '4. Poll `leafi_get_run` until the status is no longer `running`.',
    '4. Call `leafi_wait_run` with the run id right after `leafi_start_run`. It waits inside the extension, so it costs no model calls; do not poll `leafi_get_run` yourself.\n   If it reports the run is still going, call it again.',
  );
  text = replaceOnce(
    text,
    /If a flow needs a permission that is turned off[\s\S]*?Do not try to work around the policy\./,
    'If a flow needs a permission that is turned off (`bash`, `email_read` and\n' +
      '`mcp` are off by default), `leafi_start_run` asks the user for it directly in a\n' +
      'dialog. If they decline, or Pi has no UI (`-p` mode), the error names the permission:\n' +
      'explain why the flow needs it, and that they can allow it by running\n' +
      '`/leafi settings` and following the command it prints, then `/new`. Do not try to work\n' +
      'around the policy.',
  );

  const note =
    '<!-- Generated from hermes-plugin/skills/leafi/SKILL.md by scripts/build-pi-extension.mjs; do not edit by hand. -->\n';
  return replaceOnce(text, /^(---\n[\s\S]*?\n---\n)/, `$1${note}`);
}

function replaceOnce(text, pattern, replacement) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    throw new Error(`The Hermes skill no longer contains the text the Pi build rewrites: ${String(pattern).slice(0, 80)}`);
  }
  return next;
}

/** Tool descriptions name other tools; in Pi those carry the prefix, and waiting is leafi_wait_run. */
function piDescription(name, description, namePattern) {
  let text = description.replace(namePattern, `${PREFIX}$1`);
  if (name === 'start_run') {
    text = replaceOnce(
      text,
      `Poll ${PREFIX}get_run for status and outputs; use ${PREFIX}get_run_events for progress.`,
      `Then call ${PREFIX}wait_run with the run id; it waits without spending model calls.`,
    );
  }
  return text;
}
