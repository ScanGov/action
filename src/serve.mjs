/*
* Minimal static file server bound to 127.0.0.1 on a random port.
*
* Serves `dir` under `basePath` so a project site published at
* https://org.github.io/repo/ can be audited at http://127.0.0.1:PORT/repo/
* with the same absolute links. Directory requests resolve to index.html,
* extensionless paths try `path.html` then `path/index.html`. Anything else
* is a 404 with no body, the same shape a static host would give.
*/

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json'
};

async function fileIfExists(candidate) {
  try {
    let s = await stat(candidate);
    return s.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  let target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(root)) return null;

  if (urlPath.endsWith('/')) {
    return fileIfExists(path.join(target, 'index.html'));
  }
  let direct = await fileIfExists(target);
  if (direct) return direct;
  if (!path.extname(target)) {
    return (await fileIfExists(target + '.html')) || (await fileIfExists(path.join(target, 'index.html')));
  }
  return null;
}

export async function serve({ dir, basePath = '/' }) {
  let root = path.resolve(dir);
  let server = http.createServer(async (req, res) => {
    let url = new URL(req.url, 'http://127.0.0.1');
    let pathname = url.pathname;
    if (basePath !== '/') {
      let trimmed = basePath.slice(0, -1);
      if (pathname === trimmed) {
        res.writeHead(301, { Location: basePath });
        return res.end();
      }
      if (!pathname.startsWith(basePath)) {
        res.writeHead(404);
        return res.end();
      }
      pathname = pathname.slice(basePath.length - 1);
    }
    let file = await resolveFile(root, pathname);
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
