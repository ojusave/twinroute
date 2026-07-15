import { createHash } from 'node:crypto';
import { resolve4, resolve6 } from 'node:dns/promises';
import { load } from 'cheerio';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import type {
  Framework,
  InspectErrorCode,
  InspectResult,
  InspectSuccess,
  PageMetadata,
  RedirectHop,
} from '@inspector/contract';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 8_000;

const selectedHeaders = [
  'cache-control',
  'age',
  'etag',
  'last-modified',
  'vary',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'strict-transport-security',
  'referrer-policy',
  'permissions-policy',
  'x-content-type-options',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'cross-origin-embedder-policy',
  'x-robots-tag',
  'server',
] as const;

class InspectionError extends Error {
  constructor(
    readonly code: InspectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function normalizeUrl(input: string): URL {
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input)
    ? input
    : `https://${input}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new InspectionError('INVALID_URL', 'Enter a valid public HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InspectionError('INVALID_URL', 'Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username || url.password) {
    throw new InspectionError('INVALID_URL', 'URLs containing credentials are not supported.');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new InspectionError('INVALID_URL', 'Only standard HTTP and HTTPS ports are supported.');
  }
  url.hash = '';
  return url;
}

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().range() === 'unicast';
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === 'localhost'
    || lowerHost.endsWith('.localhost')
    || lowerHost.endsWith('.local')
    || lowerHost.endsWith('.internal')
  ) {
    throw new InspectionError('BLOCKED_DESTINATION', 'That destination is private or reserved.');
  }
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) {
      throw new InspectionError('BLOCKED_DESTINATION', 'That destination is private or reserved.');
    }
    return { address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 };
  }

  const [v4, v6] = await Promise.all([
    resolve4(host).catch(() => []),
    resolve6(host).catch(() => []),
  ]);
  const answers = [
    ...v4.map((address) => ({ address, family: 4 as const })),
    ...v6.map((address) => ({ address, family: 6 as const })),
  ];

  if (answers.length === 0) {
    throw new InspectionError('REMOTE_FAILURE', 'The hostname did not resolve.');
  }
  if (answers.some(({ address }) => !isPublicAddress(address))) {
    throw new InspectionError('BLOCKED_DESTINATION', 'The hostname resolves to a private or reserved address.');
  }
  return answers[0];
}

function pinnedAgent(address: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      },
    },
  });
}

async function readLimitedBody(response: Response): Promise<{ body: Buffer; truncated: boolean }> {
  if (!response.body) return { body: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = MAX_BODY_BYTES - size;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }

  return { body: Buffer.concat(chunks), truncated };
}

function absolute(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractMetadata(html: string, base: string): PageMetadata {
  const $ = load(html);
  const attr = (selector: string, name = 'content') => $(selector).first().attr(name)?.trim() || null;
  const text = (selector: string) => $(selector).first().text().trim() || null;

  return {
    title: text('title'),
    description: attr('meta[name="description" i]'),
    canonical: absolute(attr('link[rel="canonical" i]', 'href') ?? undefined, base),
    favicon: absolute(attr('link[rel~="icon" i]', 'href') ?? '/favicon.ico', base),
    language: $('html').attr('lang')?.trim() || null,
    viewport: attr('meta[name="viewport" i]'),
    openGraph: {
      title: attr('meta[property="og:title" i]'),
      description: attr('meta[property="og:description" i]'),
      image: absolute(attr('meta[property="og:image" i]') ?? undefined, base),
      url: absolute(attr('meta[property="og:url" i]') ?? undefined, base),
    },
    twitter: {
      card: attr('meta[name="twitter:card" i]'),
      title: attr('meta[name="twitter:title" i]'),
      description: attr('meta[name="twitter:description" i]'),
      image: absolute(attr('meta[name="twitter:image" i]') ?? undefined, base),
    },
  };
}

function emptyMetadata(): PageMetadata {
  return {
    title: null,
    description: null,
    canonical: null,
    favicon: null,
    language: null,
    viewport: null,
    openGraph: { title: null, description: null, image: null, url: null },
    twitter: { card: null, title: null, description: null, image: null },
  };
}

function failure(framework: Framework, error: unknown): InspectResult {
  if (error instanceof InspectionError) {
    return { ok: false, framework, code: error.code, message: error.message };
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { ok: false, framework, code: 'TIMEOUT', message: 'The remote server took too long to respond.' };
  }
  const message = error instanceof Error ? error.message : '';
  if (/timeout|aborted/i.test(message)) {
    return { ok: false, framework, code: 'TIMEOUT', message: 'The remote server took too long to respond.' };
  }
  return { ok: false, framework, code: 'REMOTE_FAILURE', message: 'The remote server could not be inspected.' };
}

export async function inspectUrl(input: string, framework: Framework): Promise<InspectResult> {
  const started = performance.now();
  try {
    const requested = normalizeUrl(input);
    let current = requested;
    const redirects: RedirectHop[] = [];

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const resolved = await resolvePublicAddress(current.hostname);
      const dispatcher = pinnedAgent(resolved.address, resolved.family);
      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await fetch(current, {
          dispatcher,
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'user-agent': 'Render-Framework-Lab/1.0 (+https://render.com)',
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new InspectionError('REMOTE_FAILURE', 'The redirect did not include a destination.');
          if (hop === MAX_REDIRECTS) {
            throw new InspectionError('TOO_MANY_REDIRECTS', 'The URL exceeded the redirect limit.');
          }
          const next = normalizeUrl(new URL(location, current).toString());
          redirects.push({ url: current.toString(), status: response.status, location: next.toString() });
          current = next;
          continue;
        }

        const contentType = response.headers.get('content-type') ?? 'unknown';
        const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
        const { body, truncated } = await readLimitedBody(response as unknown as Response);
        const html = isHtml ? body.toString('utf8') : '';
        const headers = Object.fromEntries(
          selectedHeaders.map((name) => [name, response.headers.get(name)]),
        );

        const result: InspectSuccess = {
          ok: true,
          framework,
          requestedUrl: requested.toString(),
          finalUrl: current.toString(),
          status: response.status,
          contentType,
          size: body.byteLength,
          durationMs: Math.round(performance.now() - started),
          inspectedAt: new Date().toISOString(),
          contentHash: createHash('sha256').update(body).digest('hex').slice(0, 16),
          truncated,
          redirects,
          headers,
          metadata: isHtml ? extractMetadata(html, current.toString()) : emptyMetadata(),
        };
        return result;
      } finally {
        await dispatcher.close();
      }
    }
    throw new InspectionError('TOO_MANY_REDIRECTS', 'The URL exceeded the redirect limit.');
  } catch (error) {
    return failure(framework, error);
  }
}

export function httpStatusFor(result: InspectResult): number {
  if (result.ok) return 200;
  if (result.code === 'INVALID_URL') return 400;
  if (result.code === 'BLOCKED_DESTINATION') return 403;
  if (result.code === 'TIMEOUT') return 504;
  return 502;
}
