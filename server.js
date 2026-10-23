/**
 * SonicForge Studio - Local-First Offline Server
 * 
 * Runs 100% locally on your machine with zero external network connectivity.
 * Serves with Cross-Origin Isolation headers (COOP/COEP) for full WebAssembly
 * and AudioWorklet hardware acceleration.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5173;
const ROOT_DIR = fs.existsSync(path.join(__dirname, 'dist')) 
  ? path.join(__dirname, 'dist') 
  : __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const server = http.createServer((req, res) => {
  // Required Cross-Origin Isolation Headers for WebAssembly & SharedArrayBuffer
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let safePath = decodeURIComponent(req.url.split('?')[0]);
  if (safePath === '/') safePath = '/index.html';

  let filePath = path.join(ROOT_DIR, safePath);

  // Fallback to public folder if asset not found in dist
  if (!fs.existsSync(filePath)) {
    const publicPath = path.join(__dirname, 'public', safePath);
    if (fs.existsSync(publicPath)) {
      filePath = publicPath;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Single Page Application fallback to index.html
      const indexPath = path.join(ROOT_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found: ' + safePath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('===========================================================');
  console.log('       SONICFORGE STUDIO — OFFLINE WORKSTATION');
  console.log('===========================================================');
  console.log(` Running locally at: ${url}`);
  console.log(' [✓] 100% Offline: Zero data sent to the internet');
  console.log(' [✓] Local Hardware: Files stay strictly on your laptop');
  console.log(' [✓] Cross-Origin Isolation: Active (COOP & COEP enabled)');
  console.log('===========================================================');
  console.log(' Press Ctrl+C in this terminal to stop the application.');
  console.log('');

  // Auto-launch default browser on Windows
  if (process.platform === 'win32') {
    exec(`start ${url}`);
  }
});
