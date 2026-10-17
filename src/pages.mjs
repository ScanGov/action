/*
* Enumerate the HTML pages in a built site as URL paths, and choose which of
* them get a full Lighthouse pass.
*
*   index.html        -> /
*   about/index.html  -> /about/
*   contact.html      -> /contact.html
*
* Root first, then alphabetical. Hidden directories, node_modules and
* vendor trees are skipped, and so are .html files that are not documents
* (site-verification tokens, fragments): neither Lighthouse nor the HTML
* analysis has anything to say about them.
*/

import { readdir, readFile } from 'node:fs/promises';
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

async function isDocument(file) {
  let head = (await readFile(file, 'utf8')).slice(0, 8192);
  return /<html[\s>]/i.test(head) || /<!doctype\s+html/i.test(head);
}

/* Pages in the tree, plus the .html files that were skipped for not being documents. */
export async function enumerateSite(root) {
  root = path.resolve(root);
  let files = await walk(root);
  let pages = [];
  let skipped = [];
  for (let file of files) {
    (await isDocument(path.join(root, file)) ? pages : skipped).push(fileToUrlPath(file));
  }
  return { pages: sortPaths(pages), skipped: sortPaths(skipped) };
}

export async function enumeratePages(root) {
  return (await enumerateSite(root)).pages;
}

function sortPaths(paths) {
  return paths.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
}

/*
* Choose the pages that get a full Lighthouse pass. Deterministic, so two
* runs on the same tree audit the same pages, and ordered so the biggest
* templates are covered first:
*
*   1. the homepage, then the landing page of every top-level section,
*      largest section first (ties alphabetical);
*   2. the first inner page of every section in the same order, which is
*      usually the detail template behind the landing page;
*
* until `max` pages are chosen. Root-level files such as /contact.html form
* the root section together with the homepage.
*/
export function sampleLighthousePages(paths, { max = 10 } = {}) {
  let sections = new Map();
  for (let p of paths) {
    let name = sectionOf(p);
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(p);
  }
  for (let pages of sections.values()) pages.sort((a, b) => a.localeCompare(b));
  let ordered = [...sections.entries()].sort(([a, ap], [b, bp]) =>
    (a === '' ? -1 : b === '' ? 1 : 0) || bp.length - ap.length || a.localeCompare(b));

  let passes = [
    ordered.map(([name, pages]) => landingOf(name, pages)),
    ordered.map(([name, pages]) => pages.find(p => p !== landingOf(name, pages)))
  ];
  let picks = [];
  for (let pass of passes) {
    for (let p of pass) {
      if (picks.length >= max) return picks;
      if (p && !picks.includes(p)) picks.push(p);
    }
  }
  return picks;
}

function sectionOf(p) {
  let segments = p.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.length === 1 && /\.html?$/i.test(segments[0])) return '';
  return segments[0];
}

function landingOf(name, pages) {
  let index = name ? `/${name}/` : '/';
  return pages.includes(index) ? index : pages[0];
}
