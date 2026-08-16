const fs = require('fs');
const path = require('path');

const OPENAPI_FILE = path.join(__dirname, 'openapi.json');
let swaggerDistDir = null;
try {
  swaggerDistDir = path.dirname(require.resolve('swagger-ui-dist/package.json'));
} catch {
  swaggerDistDir = null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

async function serveOpenApiDocs(req, res, parsedUrl) {
  if (parsedUrl.pathname === '/api/openapi.json' && req.method === 'GET') {
    return sendFile(res, OPENAPI_FILE);
  }

  if (parsedUrl.pathname === '/api/docs' || parsedUrl.pathname === '/api/docs/') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Console OpenAPI</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script src="/api/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout'
    });
  </script>
</body>
</html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return true;
  }

  if (parsedUrl.pathname.startsWith('/api/docs/') && req.method === 'GET') {
    if (!swaggerDistDir) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('swagger-ui-dist is not installed');
      return true;
    }
    const relative = parsedUrl.pathname.replace(/^\/api\/docs\//, '');
    if (!relative || relative.includes('..')) {
      res.writeHead(404);
      res.end();
      return true;
    }
    const filePath = path.join(swaggerDistDir, relative);
    if (!filePath.startsWith(swaggerDistDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end();
      return true;
    }
    return sendFile(res, filePath);
  }

  return false;
}

module.exports = { serveOpenApiDocs };
