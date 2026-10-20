import { readdir, mkdir, rm, copyFile, cp } from 'node:fs/promises';
// Both hosts publish only the public site. Functions, tests and instructions stay outside it.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|webp|mp4|ico|png|jpe?g|svg|txt)$/.test(entry.name)) await copyFile(entry.name, `dist/${entry.name}`);
}
await cp('assets', 'dist/assets', { recursive: true });
console.log('Static site prepared in dist/');
