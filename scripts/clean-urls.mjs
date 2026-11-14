// Clean URLs in the Vite dev server and `vite preview`, the same rules as the Node server and Apache:
//   /ide, /ide/, /ide.html -> /   (the workspace used to live under /ide/)
//   /index.html            -> /
//   /docs/index.html       -> /docs/
//   /docs                  -> /docs/   (a folder needs its trailing slash for relative paths)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function cleanUrls(root = process.cwd()) {
  const handle = (req, res, next) => {
    const url = new URL(req.url, 'http://local');
    const p = decodeURIComponent(url.pathname);
    const go = (to) => {
      res.statusCode = 301;
      res.setHeader('Location', to + url.search);
      res.end();
    };
    if (p.includes('/apps/') || p.startsWith('/@') || p.startsWith('/src/') || p.startsWith('/node_modules/')) return next();
    if (p === '/ide' || p === '/ide/' || p === '/ide.html') return go('/');
    const index = p.match(/^(.*\/)index\.html$/);
    if (index) return go(index[1]);
    const page = p.match(/^\/(.+)\.html$/);
    if (page && existsSync(resolve(root, page[1], 'index.html'))) return go(`/${page[1]}/`);
    if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p) && existsSync(resolve(root, p.slice(1), 'index.html'))) return go(`${p}/`);
    next();
  };
  return {
    name: 'workcraft-clean-urls',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
