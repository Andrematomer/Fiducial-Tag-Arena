// Copies the website (repo root) into app/web-dist so the desktop app and the
// GitHub Pages site always run the same front-end code.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const out = resolve(here, '..', 'web-dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'js', 'css', 'vendor']) {
  const src = join(root, item);
  if (!existsSync(src)) throw new Error('missing ' + src);
  cpSync(src, join(out, item), { recursive: true });
}
console.log('web-dist synced from', root);
