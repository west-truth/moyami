import { buildPwa } from './build-pwa.mjs';
import { build } from 'esbuild';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const dom = await readFile(join(dirname(require.resolve('linkedom')), '../worker.js'), 'utf8');
if (!/\nexport \{[^}]+\};\s*$/.test(dom) || dom.length > 1024 * 1024) throw new Error('DOM bundle changed');
const realmDom = '(function(){\n' + dom.replace(/\nexport \{[^}]+\};\s*$/, '\nglobalThis.__moyaParseHTML=parseHTML;') + '\n})();';
await mkdir('public/runtime', { recursive: true });
await copyFile(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'), 'public/runtime/quickjs.wasm');
await build({ entryPoints: ['client/source-worker.js'], outfile: 'public/runtime/source-worker.js',
  bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022',
  define: { __MOYA_DOM_SOURCE__: JSON.stringify(realmDom) }, logLevel: 'info' });

await build({ entryPoints: ['client/moya-ui.jsx'], outfile: 'public/moya-ui.js',
  bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022',
  inject: ['client/account-storage-inject.js'], external: ['/account-storage.js'],
  alias: { '@noveldesk/text-core': './vendor/moya-ui/packages/text-core' },
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });

// These build dependencies ship as code/WASM even though npm prunes them from the server.
const notices = ['Moya UI (d00dc7a2b2d94cc042951697ad447d7028a491fe)\n' + await readFile('vendor/moya-ui/LICENSE', 'utf8')];
for (const name of ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-ffi-types', '@noble/ciphers', 'linkedom', 'react', 'react-dom', 'scheduler', 'lucide-react', '@tanstack/react-virtual', '@tanstack/virtual-core', '@noble/hashes']) {
  notices.push(name + '\n' + await readFile(join('node_modules', name, 'LICENSE'), 'utf8'));
}
await writeFile('public/runtime/THIRD_PARTY_LICENSES.txt', notices.join('\n\n'));

const siteName = (process.env.SITE_NAME || 'moyami').slice(0,80);
const manifest = JSON.parse(await readFile('public/manifest.webmanifest','utf8'));
manifest.name=siteName;manifest.short_name=siteName.slice(0,24);manifest.description='확장 소스로 만화와 소설 읽기';
await writeFile('public/manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');
await mkdir('docs', {recursive:true});
await copyFile('public/deploy.html','docs/index.html');
await buildPwa('public');
