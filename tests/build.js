// Bundles the engine against the fake vscode module so tests can run in plain Node.
const esbuild = require('esbuild');
const fs = require('fs');
fs.mkdirSync('.test-build', { recursive: true });
fs.writeFileSync('.test-build/entry.ts', "export { Companion } from '../src/companion';\nexport { Store } from '../src/store';\nexport { Buddy } from '../src/buddy';\nexport * as fake from '../tests/fake-vscode';\n");
esbuild.buildSync({
  entryPoints: ['.test-build/entry.ts'],
  outfile: '.test-build/engine.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { vscode: './tests/fake-vscode.ts' },
  logLevel: 'error',
});
