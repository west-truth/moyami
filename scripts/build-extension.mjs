import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { zipDirectory } from './zip.mjs';
const configuredOrigins = process.env.CONNECTOR_READER_ORIGINS || process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
if (!configuredOrigins) throw new Error('Set APP_URL or CONNECTOR_READER_ORIGINS to your reader origin before building connectors');
const origins = configuredOrigins.split(',').map(value => {
  const url = new URL(value.trim());
  if (url.origin !== value.trim() || (url.protocol !== 'https:' && !(process.env.CONNECTOR_DEV === '1' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid reader origin');
  return url.origin;
});
for (const target of ['chromium','firefox','safari']) {
  const dir = `.state/extension/${target}`; await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const manifest = { manifest_version: 3, name: 'moyami Browser Connector', version: '0.1.1',
    description: 'Connect moyami to source sites through your browser with per-site permission.',
    permissions: ['storage','scripting','declarativeNetRequestWithHostAccess'],
    host_permissions: origins.map(origin => { const u = new URL(origin); return u.protocol + '//' + u.hostname + '/*'; }), optional_host_permissions: ['https://*/*'],
    background: target === 'chromium' ? { service_worker: 'background.js' } : { scripts: ['background.js'], persistent: false },
    action: { default_popup: 'popup.html', default_title: 'Moya 연결' },
    content_scripts: [{ matches: origins.map(origin => { const u = new URL(origin); return u.protocol + '//' + u.hostname + '/*'; }), js: ['content.js'], run_at: 'document_start', all_frames: false }] };
  if (target === 'firefox') manifest.browser_specific_settings = { gecko: { id: 'moya-connector@moya.local', strict_min_version: '140.0', data_collection_permissions: { required: ['websiteContent', 'browsingActivity', 'searchTerms'] } }, gecko_android: { strict_min_version: '142.0' } };
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  for (const name of ['background','content','popup']) await build({ entryPoints: [`extension/${name}.js`], outfile: `${dir}/${name}.js`, bundle: true, format: 'iife', target: ['safari16.4','firefox128','chrome120'], define: { __READER_ORIGINS__: JSON.stringify(origins) } });
  await copyFile('extension/popup.html', `${dir}/popup.html`);
  await rm(`.state/extension/${target}.zip`, { force: true });
  if (process.env.CONNECTOR_SKIP_ZIP !== '1') await zipDirectory(dir, `${dir}.zip`);
  if (process.env.CONNECTOR_PUBLISH === '1') {
    if (process.env.CONNECTOR_DEV === '1' || process.env.CONNECTOR_SKIP_ZIP === '1') throw new Error('Only release ZIPs may be published');
    await mkdir('public/install', { recursive: true });
    await copyFile(`${dir}.zip`, `public/install/moya-connector-${target}.zip`);
  }
  console.log(`${target}: ${dir}.zip`);
}
