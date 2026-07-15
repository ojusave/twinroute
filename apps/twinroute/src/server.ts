import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import {
  examples,
  webhookInputSchema,
  type RunFailure,
  type RunSuccess,
  type ServiceConfig,
  type TraceStep,
} from '@inspector/contract';
import { uiDirectory } from '@inspector/ui';
import express, { type ErrorRequestHandler } from 'express';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';

const port = Number(process.env.PORT ?? 3000);
const repositoryUrl = process.env.REPOSITORY_URL
  || (process.env.RENDER_GIT_REPO_SLUG ? `https://github.com/${process.env.RENDER_GIT_REPO_SLUG}` : '');
const config: ServiceConfig = {
  region: process.env.APP_REGION ?? 'local',
  serviceName: process.env.RENDER_SERVICE_NAME ?? 'twinroute',
  repositoryUrl,
  deployUrl: repositoryUrl
    ? `https://dashboard.render.com/blueprint/new?repo=${encodeURIComponent(repositoryUrl)}`
    : '',
};

function success(
  framework: 'express' | 'hono',
  input: { event: string; payload: { id: string } },
  trace: TraceStep[],
  started: number,
): RunSuccess {
  trace.push({ id: 'handler', label: 'Handler ran', detail: `Read ${input.payload.id} from validated input`, status: 'complete' });
  trace.push({
    id: 'response',
    label: 'Response returned',
    detail: framework === 'express' ? 'res.status(202).json(...)' : 'return c.json(..., 202)',
    status: 'complete',
  });
  return {
    ok: true,
    framework,
    status: 202,
    durationMs: Math.max(1, Math.round(performance.now() - started)),
    trace,
    body: { accepted: true, event: input.event, id: input.payload.id },
  };
}

function failure(
  framework: 'express' | 'hono',
  message: string,
  trace: TraceStep[],
  started: number,
): RunFailure {
  trace.push({ id: 'validation', label: 'Validation failed', detail: message, status: 'failed' });
  trace.push({
    id: 'error',
    label: 'Error response returned',
    detail: framework === 'express' ? 'Express error middleware handled it' : 'The validator hook returned a Response',
    status: 'complete',
  });
  return {
    ok: false,
    framework,
    status: 400,
    durationMs: Math.max(1, Math.round(performance.now() - started)),
    trace,
    body: { accepted: false, error: message },
  };
}

const expressApp = express();
expressApp.disable('x-powered-by');
expressApp.use(express.json({ limit: '8kb' }));
expressApp.use('/api/express/run', (_req, res, next) => {
  res.locals.started = performance.now();
  res.locals.trace = [
    { id: 'parse', label: 'JSON parsed', detail: 'express.json() populated req.body', status: 'complete' },
    { id: 'middleware', label: 'Middleware ran', detail: 'Express called middleware in registration order', status: 'complete' },
  ] satisfies TraceStep[];
  next();
});

expressApp.post('/api/express/run', async (req, res, next) => {
  try {
    const input = webhookInputSchema.parse(req.body);
    const trace = res.locals.trace as TraceStep[];
    trace.push({ id: 'validation', label: 'Input validated', detail: 'schema.parse(req.body)', status: 'complete' });
    res.status(202).json(success('express', input, trace, res.locals.started));
  } catch (error) {
    next(error);
  }
});

expressApp.get('/health', (_req, res) => res.json({ ok: true, app: 'twinroute' }));
expressApp.get('/api/config', (_req, res) => res.json(config));
expressApp.get('/api/examples', (_req, res) => res.json(examples));
expressApp.use(express.static(uiDirectory, { etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
expressApp.get('*splat', (_req, res) => res.sendFile('index.html', { root: uiDirectory }));

const expressErrors: ErrorRequestHandler = (error, _req, res, _next) => {
  const started = res.locals.started ?? performance.now();
  const trace = (res.locals.trace ?? []) as TraceStep[];
  if (error?.name === 'ZodError') {
    const message = error.issues?.[0]?.message ?? 'Invalid request';
    res.status(400).json(failure('express', message, trace, started));
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json(failure('express', 'Request body must be valid JSON', trace, started));
    return;
  }
  console.error(error);
  res.status(500).json({ ok: false, framework: 'express', status: 500, body: { accepted: false, error: 'Unexpected error' } });
};
expressApp.use(expressErrors);

type HonoVariables = { Variables: { trace: TraceStep[]; started: number } };
const honoApp = new Hono<HonoVariables>();
honoApp.use('/api/hono/*', bodyLimit({ maxSize: 8 * 1024 }));
honoApp.use('/api/hono/*', async (c, next) => {
  c.set('started', performance.now());
  c.set('trace', [
    { id: 'parse', label: 'JSON parsed', detail: 'The validator read the standard Request body', status: 'complete' },
    { id: 'middleware', label: 'Middleware ran', detail: 'Hono composed middleware around the handler', status: 'complete' },
  ]);
  await next();
});

honoApp.post(
  '/api/hono/run',
  zValidator('json', webhookInputSchema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid request';
      const state = c.var as Partial<HonoVariables['Variables']>;
      return c.json(failure('hono', message, state.trace ?? [], state.started ?? performance.now()), 400);
    }
  }),
  async (c) => {
    const input = c.req.valid('json');
    const trace = c.get('trace');
    trace.push({ id: 'validation', label: 'Input validated', detail: "c.req.valid('json') is inferred", status: 'complete' });
    return c.json(success('hono', input, trace, c.get('started')), 202);
  },
);

honoApp.onError((error, c) => {
  const state = c.var as Partial<HonoVariables['Variables']>;
  const trace = state.trace ?? [];
  const started = state.started ?? performance.now();
  if (error instanceof SyntaxError || (error instanceof HTTPException && error.status === 400)) {
    return c.json(failure('hono', 'Request body must be valid JSON', trace, started), 400);
  }
  console.error(error);
  return c.json({ ok: false, framework: 'hono', status: 500, body: { accepted: false, error: 'Unexpected error' } }, 500);
});

const honoListener = getRequestListener(honoApp.fetch);
const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/hono/')) {
    void honoListener(request, response);
    return;
  }
  expressApp(request, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`TwinRoute listening on ${port}`);
});
