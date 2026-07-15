import { describe, expect, it } from 'vitest';
import { inspectInputSchema } from '@inspector/contract';
import { inspectUrl } from '@inspector/core';

describe('shared inspection boundary', () => {
  it('requires a URL value', () => {
    const parsed = inspectInputSchema.safeParse({ url: '' });
    expect(parsed.success).toBe(false);
  });

  it.each([
    'http://127.0.0.1',
    'http://localhost',
    'http://[::1]',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.0.1',
  ])('blocks non-public destination %s', async (url) => {
    const result = await inspectUrl(url, 'express');
    expect(result).toMatchObject({
      ok: false,
      framework: 'express',
      code: 'BLOCKED_DESTINATION',
    });
  });

  it('rejects credentials and nonstandard ports', async () => {
    const credentials = await inspectUrl('https://user:pass@example.com', 'hono');
    const port = await inspectUrl('https://example.com:8443', 'hono');
    expect(credentials).toMatchObject({ ok: false, code: 'INVALID_URL' });
    expect(port).toMatchObject({ ok: false, code: 'INVALID_URL' });
  });
});
