/*
* Enumerate the HTML pages in a built site as URL paths.
*
*   index.html        -> /
*   about/index.html  -> /about/
*   contact.html      -> /contact.html
*
* Root first, then alphabetical. Hidden directories, node_modules and
* vendor trees are skipped.
*/

import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.github']);

async function walk(root, rel = '') {
  let entries = await readdir(path.join(root, rel), { withFileTypes: true });
  let files = [];
  for (let entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await walk(root, path.join(rel, entry.name)));
    } else if (/\.html?$/i.test(entry.name)) {
      files.push(path.join(rel, entry.name));
    }
  }
  return files;
}

export function fileToUrlPath(file) {
  let p = '/' + file.split(path.sep).join('/');
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  return p;
}

export async function enumeratePages(root) {
  let files = await walk(path.resolve(root));
  let paths = files.map(fileToUrlPath);
  return paths.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
}
