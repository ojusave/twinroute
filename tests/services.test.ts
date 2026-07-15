import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
let service: ChildProcess;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://localhost:3100/health');
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TwinRoute did not become healthy.');
}

async function run(framework: 'express' | 'hono', body: unknown) {
  const response = await fetch(`http://localhost:3100/api/${framework}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  service = spawn('node', ['apps/twinroute/dist/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: '3100' },
    stdio: 'ignore',
  });
  await waitForHealth();
});

afterAll(() => service.kill('SIGTERM'));

describe('one-app framework comparison', () => {
  it('serves the Request Lab', async () => {
    const response = await fetch('http://localhost:3100/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>TwinRoute — Express vs Hono Request Lab</title>');
  });

  it('returns the same accepted contract from both frameworks', async () => {
    const input = {
      event: 'invoice.paid',
      payload: { id: 'in_2048', amount: 4900, currency: 'USD' },
    };
    const [express, hono] = await Promise.all([run('express', input), run('hono', input)]);
    expect([express.status, hono.status]).toEqual([202, 202]);
    expect(express.body.body).toEqual(hono.body.body);
    expect(express.body.framework).toBe('express');
    expect(hono.body.framework).toBe('hono');
    expect(express.body.trace).toHaveLength(5);
    expect(hono.body.trace).toHaveLength(5);
  });

  it('shows different error paths for the same invalid request', async () => {
    const input = { event: 'invoice.paid', payload: { amount: 4900, currency: 'USD' } };
    const [express, hono] = await Promise.all([run('express', input), run('hono', input)]);
    expect([express.status, hono.status]).toEqual([400, 400]);
    expect(express.body.body).toEqual(hono.body.body);
    expect(express.body.trace.at(-1).detail).toContain('error middleware');
    expect(hono.body.trace.at(-1).detail).toContain('validator hook');
  });
});
