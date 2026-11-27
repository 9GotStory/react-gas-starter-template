import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  createMockGasController,
  MOCK_GAS_API_PATH,
  type MockItemFixture,
} from '../../tests/fixtures/items';

export interface MockGasMiddlewareOptions {
  apiPath?: string;
  initialItems?: readonly MockItemFixture[];
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendResponse(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

/**
 * Creates a dev-only Connect middleware serving the offline mock GAS endpoint
 * backed by the shared plain `Item` fixtures (ADR-0004).
 */
export function createMockGasMiddleware(
  options: MockGasMiddlewareOptions = {},
): Connect.NextHandleFunction {
  const apiPath = options.apiPath ?? MOCK_GAS_API_PATH;
  const controller = createMockGasController(options.initialItems);

  return (req, res, next) => {
    const rawUrl = req.url ?? '';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    if (parsedUrl.pathname !== apiPath) {
      next();
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET') {
      const result = controller.handleGet(parsedUrl.searchParams);
      sendResponse(res, result.status, result.contentType, result.body);
      return;
    }

    if (method === 'POST') {
      void readRequestBody(req)
        .then((body) => {
          const result = controller.handlePost(body);
          sendResponse(res, result.status, result.contentType, result.body);
        })
        .catch(() => {
          sendResponse(
            res,
            200,
            'application/json; charset=utf-8',
            JSON.stringify({
              ok: false,
              error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred' },
            }),
          );
        });
      return;
    }

    sendResponse(
      res,
      405,
      'application/json; charset=utf-8',
      JSON.stringify({
        ok: false,
        error: { code: 'INVALID_ACTION', message: `Unsupported HTTP method: ${method}` },
      }),
    );
  };
}

/**
 * Strictly dev-only (`apply: 'serve'`) Vite plugin mounting the offline mock
 * GAS API middleware. Never runs during `vite build` or `vite preview` and is
 * never bundled into `frontend/dist/`.
 */
export function createMockGasApiPlugin(options: MockGasMiddlewareOptions = {}): Plugin {
  return {
    name: 'react-gas-dev-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createMockGasMiddleware(options));
    },
  };
}
