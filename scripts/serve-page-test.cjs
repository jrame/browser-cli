// Serve the standalone playground over HTTP for browsers that block file: URLs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = 4173;
const file = path.join(__dirname, '..', 'page-test.html');

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${host}`).pathname;
  if (pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname !== '/' && pathname !== '/page-test.html') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Page introuvable.');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  fs.readFile(file, (error, html) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Impossible de lire page-test.html.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Le port ${port} est déjà utilisé. Arrêtez le serveur existant avant de relancer.`
    : error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Page de test : http://${host}:${port}/page-test.html`);
  console.log('Arrêt : Ctrl+C');
});
