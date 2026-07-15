# TwinRoute: Express vs Hono

TwinRoute runs the same URL inspection through Express and Hono. The two
services share the URL-safety code, metadata parser, response contract, tests,
and frontend. Only the framework boundary changes.

This is a comparison you can use, not a hello-world benchmark.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/ojusave/twinroute)

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm run dev:express
```

In a second terminal:

```bash
npm run dev:hono
```

Open `http://localhost:3001` or `http://localhost:3002`. Compare mode calls the
other local service.

## What is shared

- DNS and IP validation
- Manual redirect handling
- Time and response-size limits
- HTML metadata extraction
- TypeScript response contract
- Security tests
- The complete frontend artifact

## What differs

The Express adapter uses `req`, `res`, `next`, ordered middleware, explicit
schema parsing, and an error-handling middleware. The Hono adapter uses
`Context`, composed middleware, validator inference, and handlers that return a
web-standard response.

## Security boundary

The inspector accepts public HTTP and HTTPS URLs on standard ports. It resolves
every hostname, rejects any private or reserved answer, pins the outbound
connection to a validated address, validates every redirect, limits redirects,
times out slow requests, truncates large responses, and never returns a remote
HTML body to the browser.

It does not accept cookies, authorization headers, arbitrary methods, request
bodies, private pages, or browser execution.

## Deploy on Render

The repository includes one `render.yaml` Blueprint that creates two free Node
web services in the same region. Each service receives the other service's
public Render hostname, so Compare mode also works on free instances. Render's
`RENDER_GIT_REPO_SLUG` powers the **View source** and **Deploy both on Render**
links without asking for another environment variable.

Before making a public deployment, run:

```bash
npm test
npm run typecheck
render blueprints validate
```
