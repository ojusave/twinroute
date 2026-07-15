import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { examples, inspectInputSchema, type ServiceConfig } from '@inspector/contract';
import { httpStatusFor, inspectUrl } from '@inspector/core';
import { uiDirectory } from '@inspector/ui';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const repositoryUrl = process.env.REPOSITORY_URL
  || (process.env.RENDER_GIT_REPO_SLUG ? `https://github.com/${process.env.RENDER_GIT_REPO_SLUG}` : '');

const config: ServiceConfig = {
  framework: 'express',
  peerApiUrl: process.env.PEER_API_URL || null,
  region: process.env.APP_REGION ?? 'local',
  serviceName: process.env.RENDER_SERVICE_NAME ?? 'twinroute-express',
  repositoryUrl,
  deployUrl: repositoryUrl
    ? `https://dashboard.render.com/blueprint/new?repo=${encodeURIComponent(repositoryUrl)}`
    : '',
};

app.disable('x-powered-by');
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '4kb' }));
app.use('/api', rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, framework: 'express' });
});

app.get('/api/config', (_req, res) => {
  res.json(config);
});

app.get('/api/examples', (_req, res) => {
  res.json(examples);
});

app.post('/api/inspect', async (req, res, next) => {
  try {
    const input = inspectInputSchema.parse(req.body);
    const result = await inspectUrl(input.url, 'express');
    res.status(httpStatusFor(result)).json(result);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(uiDirectory, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('*splat', (_req, res) => {
  res.sendFile('index.html', { root: uiDirectory });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (
    error?.name === 'ZodError'
    || (error instanceof SyntaxError && (error as SyntaxError & { status?: number }).status === 400)
  ) {
    res.status(400).json({
      ok: false,
      framework: 'express',
      code: 'INVALID_URL',
      message: error.issues?.[0]?.message ?? 'Send a JSON object containing a URL.',
    });
    return;
  }
  console.error(error);
  res.status(500).json({
    ok: false,
    framework: 'express',
    code: 'INTERNAL_ERROR',
    message: 'The inspection failed unexpectedly.',
  });
};

app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`Express inspector listening on ${port}`);
});
