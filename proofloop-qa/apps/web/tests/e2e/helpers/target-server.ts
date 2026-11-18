import http from 'node:http';

/**
 * Local HTTP target for the API execution engine tests. 127.0.0.1:4999 is the ONLY address
 * the API may reach in tests (SSRF_ALLOWED_TARGETS in playwright.config.ts).
 */
export const TARGET = 'http://127.0.0.1:4999';

export function startTarget(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', TARGET);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      switch (url.pathname) {
        case '/json':
        case '/v1/json':
          // No content-length here: Node sends this response chunked. x-total-count = numeric header.
          return json(200, { id: 1, user: { name: 'Ada' }, active: false, count: 3, items: [{ id: 7 }] }, { 'x-request-id': 'abc-123', 'x-total-count': '3' });
        case '/echo':
          return json(200, { method: req.method, path: url.pathname, headers: req.headers, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null });
        case '/zero':
          return json(200, 0);
        case '/text':
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('plain text');
        case '/status/404':
          return json(404, { error: 'nope' });
        case '/big':
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('x'.repeat(2 * 1024 * 1024));
        case '/reset':
          return req.socket.destroy();
        case '/redirect-ok':
          res.writeHead(302, { location: '/json' });
          return res.end();
        case '/redirect-ip':
          res.writeHead(302, { location: 'http://127.0.0.1:4000/api/health' });
          return res.end();
        case '/redirect-host':
          res.writeHead(302, { location: 'http://localhost:4000/api/health' });
          return res.end();
        case '/redirect-file':
          res.writeHead(302, { location: 'file:///etc/passwd' });
          return res.end();
        default:
          return json(404, { error: 'unknown' });
      }
    });
  });
  return new Promise((resolve) => server.listen(4999, '127.0.0.1', () => resolve(server)));
}
