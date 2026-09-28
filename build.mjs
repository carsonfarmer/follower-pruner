import { copyFile, mkdir, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('manifest.json and package.json versions must match.');

const files = ['manifest.json', 'core.js', 'content.js', 'popup.html', 'popup.js', 'README.md', 'LICENSE'];
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
for (const file of files) {
  await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
}
console.log(`Load unpacked: ${new URL('dist/', import.meta.url).pathname}`);
