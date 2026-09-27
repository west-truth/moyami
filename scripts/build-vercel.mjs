import { buildPwa } from './build-pwa.mjs';
import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}.state/vercel-app`;
execFileSync(process.execPath, ['scripts/build-client.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-extension.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, CONNECTOR_PUBLISH: '1', CONNECTOR_DEV: '0', CONNECTOR_SKIP_ZIP: '0' } });
await mkdir(`${output}/api`, { recursive: true });
await cp(`${root}public`, `${output}/public`, { recursive: true });
await writeFile(`${output}/public/host-config.js`, 'export const maximumRequestBytes = 4_400_000;\n');
await buildPwa(`${output}/public`);
await build({ entryPoints: [`${root}server/vercel.ts`], outfile: `${output}/api/index.js`, bundle: true,
  platform: 'node', format: 'esm', target: 'node22', logLevel: 'info',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
await writeFile(`${output}/package.json`, JSON.stringify({ private: true, type: 'module', engines: { node: '22.x' } }, null, 2));
await writeFile(`${output}/vercel.json`, JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
  buildCommand: '', installCommand: '', outputDirectory: 'public', regions: ['icn1'],
  functions: { 'api/index.js': { maxDuration: 120, supportsCancellation: true } },
  rewrites: [{ source: '/api/:path*', destination: '/api/index' }],
  headers: [
    { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    { source: '/sw.js', headers: [{key:'Cache-Control',value:'no-cache'}, {key:'Service-Worker-Allowed',value:'/'}] },
    { source: '/manifest.webmanifest', headers: [{key:'Content-Type',value:'application/manifest+json'}] },
    { source: '/runtime/(.*)', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" }] }
  ]
}, null, 2));
console.log(`Vercel application built in ${output}`);
