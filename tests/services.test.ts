import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const services: ChildProcess[] = [];

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Service on port ${port} did not become healthy.`);
}

beforeAll(async () => {
  services.push(
    spawn('node', ['apps/express/dist/server.js'], {
      cwd: root,
      env: { ...process.env, PORT: '3101', PEER_API_URL: 'http://localhost:3102' },
      stdio: 'ignore',
    }),
    spawn('node', ['apps/hono/dist/server.js'], {
      cwd: root,
      env: { ...process.env, PORT: '3102', PEER_API_URL: 'http://localhost:3101' },
      stdio: 'ignore',
    }),
  );
  await Promise.all([waitForHealth(3101), waitForHealth(3102)]);
});

afterAll(() => {
  services.forEach((service) => service.kill('SIGTERM'));
});

describe('service contract parity', () => {
  it.each([3101, 3102])('serves the shared frontend on %s', async (port) => {
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>TwinRoute — Express vs Hono</title>');
  });

  it('returns the same schema failure contract', async () => {
    const responses = await Promise.all([3101, 3102].map((port) => fetch(`http://localhost:${port}/api/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '' }),
    })));
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    expect(bodies.map(({ framework: _framework, ...body }) => body)).toEqual([
      { ok: false, code: 'INVALID_URL', message: 'Enter a URL' },
      { ok: false, code: 'INVALID_URL', message: 'Enter a URL' },
    ]);
  });

  it('returns the same malformed JSON contract', async () => {
    const responses = await Promise.all([3101, 3102].map((port) => fetch(`http://localhost:${port}/api/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })));
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    expect(bodies.map(({ framework: _framework, ...body }) => body)).toEqual([
      { ok: false, code: 'INVALID_URL', message: 'Send a JSON object containing a URL.' },
      { ok: false, code: 'INVALID_URL', message: 'Send a JSON object containing a URL.' },
    ]);
  });
});
