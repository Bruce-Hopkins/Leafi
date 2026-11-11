import fs from 'node:fs';
import path from 'node:path';
import { bundleServer, root, thirdPartyNotices } from './lib/bundle.mjs';

const outfile = path.join(root, 'hermes-plugin', 'dist', 'server.mjs');
const noticesFile = path.join(root, 'hermes-plugin', 'dist', 'THIRD_PARTY_NOTICES.md');

try {
  const metafile = await bundleServer(outfile);
  fs.writeFileSync(
    noticesFile,
    thirdPartyNotices([metafile], { root, generatedBy: 'scripts/build-hermes-plugin.mjs', bundles: '`server.mjs` bundles' }),
  );
  process.stderr.write(`Built ${path.relative(root, outfile)} and ${path.relative(root, noticesFile)}\n`);
} catch (error) {
  process.stderr.write(`Bundle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
