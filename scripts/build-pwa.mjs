import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export async function buildPwa(directory) {
  const files = (await readdir(directory)).filter(name => /\.(js|css)$/.test(name) && name !== 'sw.js');
  files.push('index.html', 'manifest.webmanifest', 'branding/moya-wordmark.png',
    'icons/moya-32.png', 'icons/moya-192.png', 'icons/moya-512.png', 'runtime/source-worker.js', 'runtime/quickjs.wasm');
  files.sort();
  const hash = createHash('sha256');
  const template = await readFile(new URL('../client/service-worker.js', import.meta.url), 'utf8');
  hash.update(template);
  for (const file of files) { hash.update(file); hash.update(await readFile(join(directory, file))); }
  const version = hash.digest('hex').slice(0,20);
  await writeFile(join(directory,'sw.js'), template.replace('__MOYA_CACHE_VERSION__',version)
    .replace('__MOYA_SHELL_ASSETS__',JSON.stringify(files.map(file => file === 'index.html' ? '/' : `/${file}`))));
}
