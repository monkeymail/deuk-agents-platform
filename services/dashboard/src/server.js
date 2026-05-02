/**
 * DEUK Dashboard — Tiny static file server
 * Serves the SPA and proxies /api to the orchestrator.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.DASHBOARD_PORT || 7000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://orchestrator:7001';

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
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] Listening on http://0.0.0.0:${PORT}`);
});
