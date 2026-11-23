/* Budget — tiny zero-dependency local static server.
 * Only used by start-budget.bat when Python is not installed.
 * Serves this folder on http://localhost:8765 so the app can use a real
 * localhost origin (needed for the installable/offline behaviour).
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 8765);

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var pathname = decodeURIComponent(url.parse(req.url).pathname);

  // Serve the app for "/" and any unknown path (single-page app).
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  var target = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[\/\\])+/, ''));

  // Never serve outside the project folder.
  if (target.indexOf(ROOT) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(target, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }
    var type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log(' Port ' + PORT + ' is already in use.');
    console.log(' The app may already be running - open http://localhost:' + PORT + '/');
    console.log(' Or set a different port:  set PORT=9000 && node server.js');
    console.log('');
  } else {
    console.error(' Server error:', err.message);
  }
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log(' Budget is running at http://localhost:' + PORT + '/');
  console.log(' Press Ctrl+C to stop.');
  console.log('');
});
