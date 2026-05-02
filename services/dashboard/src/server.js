/**
 * DEUK Dashboard — Tiny static file server
 * Serves the SPA and proxies /api to the orchestrator.
 * Uses centralized @deuk/config for all configuration.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { parseConfig, DEFAULTS } from '@deuk/config';

const cfg = parseConfig(process.env);

const PORT = cfg.DASHBOARD_PORT;
const ORCHESTRATOR_URL = cfg.ORCHESTRATOR_URL;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // Proxy /api to orchestrator
  if (req.url.startsWith('/api/')) {
    const targetUrl = `${ORCHESTRATOR_URL}${req.url.slice(4)}`;
    try {
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await proxyRes.text();
      res.writeHead(proxyRes.status, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Orchestrator unreachable', detail: err.message }));
    }
    return;
  }

  // Serve static files
  let filePath = path.join(process.cwd(), 'dist', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA routing
      fs.readFile(path.join(process.cwd(), 'dist', 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] Listening on http://0.0.0.0:${PORT}`);
});
