// MapLibre loads its tile worker from a separate file that the bundler cannot resolve on its own
// (the worker URL is built at runtime). Copying it under public/ serves it from our own origin,
// in a version-stamped folder so a cached worker can never outlive the bundle that asks for it.
// The files are published as .js because a module worker is rejected unless the server answers
// with a JavaScript MIME type, and .mjs is not in every static host's type map.
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { version } = require('maplibre-gl/package.json');
const sourceDir = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const publicDir = path.join(process.cwd(), 'public', 'maplibre');
const targetDir = path.join(publicDir, version);

await rm(publicDir, { force: true, recursive: true });
await mkdir(targetDir, { recursive: true });

for (const name of ['maplibre-gl-worker', 'maplibre-gl-shared']) {
  const source = await readFile(path.join(sourceDir, `${name}.mjs`), 'utf8');

  if (name === 'maplibre-gl-worker' && !source.includes('maplibre-gl-shared.mjs')) {
    throw new Error('The MapLibre worker no longer imports maplibre-gl-shared.mjs: update this script.');
  }

  await writeFile(
    path.join(targetDir, `${name}.js`),
    source.replaceAll('maplibre-gl-shared.mjs', 'maplibre-gl-shared.js'),
  );
}

console.log(`Copied the MapLibre ${version} worker to public/maplibre/${version}/`);
