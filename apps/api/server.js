const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const webRoot = path.resolve(__dirname, '..', 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function resolveFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const safePath = decoded.replace(/\0/g, '');
  const joined = path.join(webRoot, safePath);
  const normalized = path.normalize(joined);
  if (!normalized.startsWith(webRoot)) {
    return null;
  }
  return normalized;
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  let filePath = resolveFilePath(urlPath);
  if (!filePath) {
    sendText(res, 400, 'Bad request');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 500, 'Failed to read static file');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.stat(filePath, (statErr, fileStats) => {
      if (statErr || !fileStats.isFile()) {
        if (statErr && statErr.code === 'ENOENT') {
          sendText(res, 404, 'Not found');
          return;
        }
        sendText(res, 500, 'Failed to read static file');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileStats.size,
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          sendText(res, 500, 'Failed to stream static file');
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
