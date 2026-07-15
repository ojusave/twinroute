import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { zValidator } from '@hono/zod-validator';
import { examples, inspectInputSchema, type ServiceConfig } from '@inspector/contract';
import { httpStatusFor, inspectUrl } from '@inspector/core';
import { uiDirectory } from '@inspector/ui';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

const app = new Hono();
const port = Number(process.env.PORT ?? 3002);
const repositoryUrl = process.env.REPOSITORY_URL
  || (process.env.RENDER_GIT_REPO_SLUG ? `https://github.com/${process.env.RENDER_GIT_REPO_SLUG}` : '');
const requests = new Map<string, { count: number; resetsAt: number }>();

const config: ServiceConfig = {
  framework: 'hono',
  peerApiUrl: process.env.PEER_API_URL || null,
  region: process.env.APP_REGION ?? 'local',
  serviceName: process.env.RENDER_SERVICE_NAME ?? 'twinroute-hono',
  repositoryUrl,
  deployUrl: repositoryUrl
    ? `https://dashboard.render.com/blueprint/new?repo=${encodeURIComponent(repositoryUrl)}`
    : '',
};

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST'] }));
app.use('/api/*', async (c, next) => {
  if (requests.size > 1_000) {
    const now = Date.now();
    for (const [key, value] of requests) {
      if (value.resetsAt <= now) requests.delete(key);
    }
    while (requests.size > 5_000) {
      const oldest = requests.keys().next().value;
      if (!oldest) break;
      requests.delete(oldest);
    }
  }
  const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous';
  const now = Date.now();
  const current = requests.get(key);
  const record = !current || current.resetsAt <= now
    ? { count: 1, resetsAt: now + 10 * 60 * 1000 }
    : { count: current.count + 1, resetsAt: current.resetsAt };
  requests.set(key, record);
  c.header('RateLimit-Limit', '20');
  c.header('RateLimit-Remaining', String(Math.max(0, 20 - record.count)));
  if (record.count > 20) {
    return c.json({
      ok: false,
      framework: 'hono',
      code: 'REMOTE_FAILURE',
      message: 'Rate limit reached. Try again in a few minutes.',
    }, 429);
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true, framework: 'hono' }));
app.get('/api/config', (c) => c.json(config));
app.get('/api/examples', (c) => c.json(examples));

app.post(
  '/api/inspect',
  zValidator('json', inspectInputSchema, (result, c) => {
    if (!result.success) {
      return c.json({
        ok: false,
        framework: 'hono' as const,
        code: 'INVALID_URL' as const,
        message: result.error.issues[0]?.message ?? 'Invalid request.',
      }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid('json');
    const result = await inspectUrl(input.url, 'hono');
    return c.json(result, httpStatusFor(result) as 200);
  },
);

app.onError((error, c) => {
  if (error instanceof SyntaxError || (error instanceof HTTPException && error.status === 400)) {
    return c.json({
      ok: false,
      framework: 'hono',
      code: 'INVALID_URL',
      message: 'Send a JSON object containing a URL.',
    }, 400);
  }
  console.error(error);
  return c.json({
    ok: false,
    framework: 'hono',
    code: 'INTERNAL_ERROR',
    message: 'The inspection failed unexpectedly.',
  }, 500);
});

app.use('/*', serveStatic({ root: uiDirectory }));
app.get('*', serveStatic({ path: `${uiDirectory}/index.html` }));

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Hono inspector listening on ${port}`);
});
