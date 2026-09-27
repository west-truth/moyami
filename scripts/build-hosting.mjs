import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { buildPwa } from './build-pwa.mjs';
execFileSync(process.execPath,['scripts/build-client.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/build-extension.mjs'],{stdio:'inherit',env:{...process.env,CONNECTOR_PUBLISH:'1',CONNECTOR_DEV:'0',CONNECTOR_SKIP_ZIP:'0'}});
await writeFile('public/host-config.js','export const maximumRequestBytes = 4_400_000;\n');
await buildPwa('public');
