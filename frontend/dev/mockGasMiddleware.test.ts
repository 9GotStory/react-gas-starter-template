// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_MOCK_ITEMS,
  LEADING_ZERO_CREATE_FIXTURE,
  MOCK_GAS_API_PATH,
} from '../../tests/fixtures/items';
import { createMockGasApiPlugin, createMockGasMiddleware } from './mockGasMiddleware';

interface MockResponseCapture {
  res: ServerResponse;
  getStatus: () => number;
  getHeader: (name: string) => string | undefined;
  getBody: () => string;
}

function createFakeRequest(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = {};

  queueMicrotask(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(body, 'utf8'));
    }
    req.emit('end');
  });

  return req;
}

function createFakeResponse(): MockResponseCapture {
  let status = 200;
  const headers = new Map<string, string>();
  let body = '';
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(code: number) {
      status = code;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        body += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      }
      resolveDone();
      return this;
    },
    __done: done,
  } as unknown as ServerResponse & { __done: Promise<void> };

  return {
    res,
    getStatus: () => status,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    getBody: () => body,
  };
}

async function invokeMiddleware(
  middleware: ReturnType<typeof createMockGasMiddleware>,
  method: string,
  url: string,
  body?: string,
) {
  const req = createFakeRequest(method, url, body);
  const capture = createFakeResponse();
  let nextCalled = false;

  await new Promise<void>((resolve, reject) => {
    middleware(req, capture.res, (err?: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      nextCalled = true;
      resolve();
    });
    void (capture.res as unknown as { __done: Promise<void> }).__done.then(() => resolve());
  });

  return {
    nextCalled,
    status: capture.getStatus(),
    contentType: capture.getHeader('content-type'),
    body: capture.getBody(),
  };
}

describe('dev-only Vite mock GAS middleware', () => {
  it('registers the Vite plugin strictly for dev serve mode (never build)', () => {
    const plugin = createMockGasApiPlugin();
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('passes unrelated routes through to next()', async () => {
    const middleware = createMockGasMiddleware({ apiPath: MOCK_GAS_API_PATH });
    const result = await invokeMiddleware(middleware, 'GET', '/src/main.tsx');
    expect(result.nextCalled).toBe(true);
  });

  it('serves shared initial Item fixtures on GET and persists created leading-zero items on POST', async () => {
    const middleware = createMockGasMiddleware({ apiPath: MOCK_GAS_API_PATH });

    const initialGet = await invokeMiddleware(
      middleware,
      'GET',
      `${MOCK_GAS_API_PATH}?action=listItems`,
    );
    expect(initialGet.nextCalled).toBe(false);
    expect(initialGet.status).toBe(200);
    expect(initialGet.contentType).toContain('application/json');
    expect(JSON.parse(initialGet.body)).toEqual({
      ok: true,
      data: INITIAL_MOCK_ITEMS,
    });

    const createPost = await invokeMiddleware(
      middleware,
      'POST',
      MOCK_GAS_API_PATH,
      JSON.stringify({
        action: 'createItem',
        payload: LEADING_ZERO_CREATE_FIXTURE,
      }),
    );
    expect(createPost.status).toBe(200);
    const createdEnvelope = JSON.parse(createPost.body) as {
      ok: true;
      data: { id: string; code: string; name: string; createdAt: string };
    };
    expect(createdEnvelope.ok).toBe(true);
    expect(createdEnvelope.data.code).toBe('00123');
    expect(createdEnvelope.data.name).toBe(LEADING_ZERO_CREATE_FIXTURE.name);

    const updatedGet = await invokeMiddleware(
      middleware,
      'GET',
      `${MOCK_GAS_API_PATH}?action=listItems`,
    );
    const updatedEnvelope = JSON.parse(updatedGet.body) as {
      ok: true;
      data: Array<{ code: string }>;
    };
    expect(updatedEnvelope.data).toHaveLength(INITIAL_MOCK_ITEMS.length + 1);
    expect(updatedEnvelope.data.at(-1)?.code).toBe('00123');
  });

  it('returns canonical INVALID_ACTION, INVALID_JSON, and VALIDATION_ERROR envelopes matching backend semantics', async () => {
    const middleware = createMockGasMiddleware({ apiPath: MOCK_GAS_API_PATH });

    const missingGetAction = await invokeMiddleware(middleware, 'GET', MOCK_GAS_API_PATH);
    expect(missingGetAction.status).toBe(200);
    expect(JSON.parse(missingGetAction.body)).toEqual({
      ok: false,
      error: { code: 'INVALID_ACTION', message: 'Unsupported GET action' },
    });

    const invalidJson = await invokeMiddleware(middleware, 'POST', MOCK_GAS_API_PATH, '{bad-json');
    expect(invalidJson.status).toBe(200);
    expect(JSON.parse(invalidJson.body)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });

    const nonObjectPost = await invokeMiddleware(middleware, 'POST', MOCK_GAS_API_PATH, '[]');
    expect(nonObjectPost.status).toBe(200);
    expect(JSON.parse(nonObjectPost.body)).toEqual({
      ok: false,
      error: { code: 'INVALID_ACTION', message: 'Unsupported POST action' },
    });

    const invalidPayload = await invokeMiddleware(
      middleware,
      'POST',
      MOCK_GAS_API_PATH,
      JSON.stringify({ action: 'createItem', payload: { code: '   ', name: 'Test' } }),
    );
    expect(invalidPayload.status).toBe(200);
    expect(JSON.parse(invalidPayload.body)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });
});
