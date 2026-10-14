#!/usr/bin/env node
// Point every `ScanGov/action@v…` reference in the docs, examples and the
// reusable workflow at one exact release tag, and set package.json to match.
// The release workflow runs this before tagging, so the files inside a tag
// reference that same tag and readers who copy an example get a pinned
// version that is the latest one.
//
//   node scripts/set-version.mjs 1.2.3

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const version = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch>');
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');
const files = [
  'README.md',
  '.github/workflows/pages.yml',
  ...readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ...readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.yml')).map((f) => `examples/${f}`),
];

// Matches ScanGov/action@v1, @v1.2, @v1.2.3 and the reusable workflow path.
const ref = /(ScanGov\/action(?:\/\.github\/workflows\/[\w.-]+\.yml)?@)v\d+(?:\.\d+){0,2}\b/g;

let changed = 0;
for (const file of files) {
  const full = path.join(root, file);
  const before = readFileSync(full, 'utf8');
  const after = before.replace(ref, `$1v${version}`);
  if (after !== before) {
    writeFileSync(full, after);
    changed++;
    console.log(`updated ${file}`);
  }
}

execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { cwd: root, stdio: 'inherit' });
console.log(`${changed} file(s) now reference ScanGov/action@v${version}`);
