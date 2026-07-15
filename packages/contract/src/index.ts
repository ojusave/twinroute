import { z } from 'zod';

export const webhookInputSchema = z.object({
  event: z.string().trim().min(1, 'event is required'),
  payload: z.object({
    id: z.string().trim().min(1, 'payload.id is required'),
    amount: z.number().nonnegative('payload.amount must be zero or greater'),
    currency: z.string().trim().length(3, 'payload.currency must contain three letters'),
  }),
});

export type Framework = 'express' | 'hono';
export type TraceStatus = 'complete' | 'failed';

export interface TraceStep {
  id: 'parse' | 'middleware' | 'validation' | 'handler' | 'response' | 'error';
  label: string;
  detail: string;
  status: TraceStatus;
}

export interface RunSuccess {
  ok: true;
  framework: Framework;
  status: 202;
  durationMs: number;
  trace: TraceStep[];
  body: { accepted: true; event: string; id: string };
}

export interface RunFailure {
  ok: false;
  framework: Framework;
  status: 400;
  durationMs: number;
  trace: TraceStep[];
  body: { accepted: false; error: string };
}

export type RunResult = RunSuccess | RunFailure;

export interface ServiceConfig {
  region: string;
  serviceName: string;
  repositoryUrl: string;
  deployUrl: string;
}

export const examples = {
  valid: {
    event: 'invoice.paid',
    payload: { id: 'in_2048', amount: 4900, currency: 'USD' },
  },
  missingField: {
    event: 'invoice.paid',
    payload: { amount: 4900, currency: 'USD' },
  },
  wrongType: {
    event: 'invoice.paid',
    payload: { id: 'in_2048', amount: 'forty-nine dollars', currency: 'USD' },
  },
} as const;
