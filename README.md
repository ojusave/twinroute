# TwinRoute

TwinRoute sends one webhook request through Express and Hono, then shows both
request paths and responses side by side. It is one Node application and one
Render service.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/ojusave/twinroute)

## What it demonstrates

The Express endpoint uses `req`, `res`, `next`, explicit schema parsing, and
error middleware. The Hono endpoint uses `Context`, validator-inferred input,
composed middleware, and a returned `Response`.

Both endpoints share the webhook schema and response contract. The native Node
server sends `/api/express/*` to Express and `/api/hono/*` to Hono, so neither
framework wraps the other's API route.

## Run locally

Requires Node.js 24.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

## Verify

```bash
npm test
npm run typecheck
render blueprints validate
```

The Render build uses `npm ci --include=dev` because TypeScript compiles the
application before production startup.

## API routes

- `POST /api/express/run`
- `POST /api/hono/run`
- `GET /api/examples`
- `GET /api/config`
- `GET /health`

## License

MIT
