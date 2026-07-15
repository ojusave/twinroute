import { z } from 'zod';

export const inspectInputSchema = z.object({
  url: z.string().trim().min(1, 'Enter a URL').max(2048, 'URL is too long'),
});

export type InspectInput = z.infer<typeof inspectInputSchema>;

export type Framework = 'express' | 'hono';

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface PageMetadata {
  title: string | null;
  description: string | null;
  canonical: string | null;
  favicon: string | null;
  language: string | null;
  viewport: string | null;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
    url: string | null;
  };
  twitter: {
    card: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
  };
}

export interface InspectSuccess {
  ok: true;
  framework: Framework;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  size: number;
  durationMs: number;
  inspectedAt: string;
  contentHash: string;
  truncated: boolean;
  redirects: RedirectHop[];
  headers: Record<string, string | null>;
  metadata: PageMetadata;
}

export type InspectErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_DESTINATION'
  | 'TOO_MANY_REDIRECTS'
  | 'UNSUPPORTED_CONTENT'
  | 'TIMEOUT'
  | 'REMOTE_FAILURE'
  | 'INTERNAL_ERROR';

export interface InspectFailure {
  ok: false;
  framework: Framework;
  code: InspectErrorCode;
  message: string;
}

export type InspectResult = InspectSuccess | InspectFailure;

export interface ServiceConfig {
  framework: Framework;
  peerApiUrl: string | null;
  region: string;
  serviceName: string;
  repositoryUrl: string;
  deployUrl: string;
}

export const examples = [
  { label: 'Example', url: 'https://example.com' },
  { label: 'Render', url: 'https://render.com' },
  { label: 'Hono', url: 'https://hono.dev' },
];
