/**
 * DEUK Config — Centralized, type-safe configuration schemas and constants.
 *
 * Usage:
 *   import { DeukConfig, TierSchema, ModelSchema } from '@deuk/config';
 *   const cfg = DeukConfig.parse(process.env);
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const DEUK_VERSION = '0.2.0';

export const DEFAULTS = {
  ORCHESTRATOR_PORT: 7001,
  GATEWAY_PORT: 7100,
  DASHBOARD_PORT: 7000,
  DATABASE_URL: 'sqlite:///data/orchestrator.db',
  GATEWAY_URL: 'http://gateway:7100',
  ORCHESTRATOR_URL: 'http://orchestrator:7001',
  AWS_REGION: 'eu-west-1',
  DAILY_BUDGET_USD: 6.67,
  MONTHLY_BUDGET_USD: 200,
  HARD_BUDGET_USD: 300,
  RATE_LIMIT_RPM: 60,
  MAX_CONCURRENT_WORKERS: 3,
  TASK_BUDGET_USD: 2.50,
  TASK_BUDGET_TOKENS: 2_000_000,
  WORKSPACE: '/workspace',
} as const;

// ─────────────────────────────────────────────────────────────
// Enums / Unions
// ─────────────────────────────────────────────────────────────

export const Tier = z.enum([
  'orchestrator',
  'reviewer',
  'worker',
  'tester',
  'scout',
]);
export type Tier = z.infer<typeof Tier>;

export const Profile = z.enum([
  'readonly-scout',
  'default',
  'default-gleam',
  'default-ts',
  'deploy-staging',
]);
export type Profile = z.infer<typeof Profile>;

export const TaskStatus = z.enum([
  'queued',
  'running',
  'awaiting-human',
  'blocked',
  'done',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ─────────────────────────────────────────────────────────────
// Model Registry — Current as of 2026-05-02
// ─────────────────────────────────────────────────────────────

export const ALLOWED_MODELS = [
  // OpenAI — GPT-4.1 series (Apr 2025)
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  // OpenAI — GPT-4o series
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  // Anthropic — Claude 4 (May 2025)
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-opus-4-20250514',
  // Anthropic — Claude 3.7 Sonnet
  'anthropic/claude-3.7-sonnet',
  // Google — Gemini 2.5 series
  'google/gemini-2.5-pro-preview-03-25',
  'google/gemini-2.5-flash-preview-04-17',
  // Meta — Llama 4
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  // Mistral — Large 2
  'mistralai/mistral-large-2',
  // DeepSeek — V3
  'deepseek/deepseek-v3',
  // xAI — Grok 3
  'x-ai/grok-3-beta',
] as const;

export const ModelSchema = z.enum(ALLOWED_MODELS as unknown as [string, ...string[]]);
export type Model = z.infer<typeof ModelSchema>;

/** Cost per 1K tokens (input, output) in USD — updated 2026-05-02 */
export const MODEL_COSTS: Record<Model, { in: number; out: number }> = {
  'openai/gpt-4.1': { in: 0.002, out: 0.008 },
  'openai/gpt-4.1-mini': { in: 0.0004, out: 0.0016 },
  'openai/gpt-4.1-nano': { in: 0.0001, out: 0.0004 },
  'openai/gpt-4o': { in: 0.0025, out: 0.01 },
  'openai/gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'anthropic/claude-sonnet-4-20250514': { in: 0.003, out: 0.015 },
  'anthropic/claude-opus-4-20250514': { in: 0.015, out: 0.075 },
  'anthropic/claude-3.7-sonnet': { in: 0.003, out: 0.015 },
  'google/gemini-2.5-pro-preview-03-25': { in: 0.00125, out: 0.01 },
  'google/gemini-2.5-flash-preview-04-17': { in: 0.00015, out: 0.0006 },
  'meta-llama/llama-4-maverick': { in: 0.0002, out: 0.0008 },
  'meta-llama/llama-4-scout': { in: 0.00015, out: 0.0006 },
  'mistralai/mistral-large-2': { in: 0.002, out: 0.006 },
  'deepseek/deepseek-v3': { in: 0.00027, out: 0.0011 },
  'x-ai/grok-3-beta': { in: 0.003, out: 0.015 },
};

/** Tier → default model mapping */
export const TIER_DEFAULT_MODEL: Record<Tier, Model> = {
  orchestrator: 'anthropic/claude-opus-4-20250514',
  reviewer: 'anthropic/claude-sonnet-4-20250514',
  worker: 'openai/gpt-4.1-mini',
  tester: 'openai/gpt-4.1-nano',
  scout: 'openai/gpt-4.1-nano',
};

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

export const TaskCreateSchema = z.object({
  repo: z.string().min(1, 'repo is required'),
  issue: z.number().int().positive().optional(),
  goal: z.string().min(1, 'goal is required'),
  tier: Tier.default('worker'),
  profile: Profile.default('default'),
  budget_usd: z.number().positive().default(DEFAULTS.TASK_BUDGET_USD),
  budget_tokens: z.number().int().positive().default(DEFAULTS.TASK_BUDGET_TOKENS),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  repo: z.string(),
  issue: z.number().int().nullable(),
  goal: z.string(),
  status: TaskStatus,
  tier: Tier,
  profile: Profile,
  budget_usd: z.number(),
  budget_tokens: z.number(),
  spent_usd: z.number().default(0),
  spent_tokens: z.number().int().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

export const EventSchema = z.object({
  id: z.number().int(),
  task_id: z.string(),
  event_type: z.string(),
  payload: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type Event = z.infer<typeof EventSchema>;

// ─────────────────────────────────────────────────────────────
// Environment Config
// ─────────────────────────────────────────────────────────────

export const DeukConfigSchema = z.object({
  DEUK_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().optional(),
  GATEWAY_PORT: z.coerce.number().int().positive().default(DEFAULTS.GATEWAY_PORT),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(DEFAULTS.DASHBOARD_PORT),
  DATABASE_URL: z.string().default(DEFAULTS.DATABASE_URL),
  GATEWAY_URL: z.string().url().default(DEFAULTS.GATEWAY_URL),
  ORCHESTRATOR_URL: z.string().url().default(DEFAULTS.ORCHESTRATOR_URL),
  OPENROUTER_API_KEY: z.string().min(1).optional().or(z.literal('')),
  AWS_REGION: z.string().default(DEFAULTS.AWS_REGION),
  AWS_DEFAULT_REGION: z.string().default(DEFAULTS.AWS_REGION),
  DAILY_BUDGET_USD: z.coerce.number().positive().default(DEFAULTS.DAILY_BUDGET_USD),
  MONTHLY_BUDGET_USD: z.coerce.number().positive().default(DEFAULTS.MONTHLY_BUDGET_USD),
  HARD_BUDGET_USD: z.coerce.number().positive().default(DEFAULTS.HARD_BUDGET_USD),
  ALLOWED_MODELS: z.string().transform((s) => s.split(',').map((m) => m.trim())).default(ALLOWED_MODELS.join(',')),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(DEFAULTS.RATE_LIMIT_RPM),
  REQUIRE_NO_TRAINING_HEADERS: z.coerce.boolean().default(true),
  SCRUBBER_PATTERNS: z.string().default('credit_card,ssn,api_key'),
  MAX_CONCURRENT_WORKERS: z.coerce.number().int().positive().default(DEFAULTS.MAX_CONCURRENT_WORKERS),
  S3_AUDIT_BUCKET: z.string().default('deuk-audit-local'),
  GH_TOKEN: z.string().optional(),
  GH_ORG: z.string().default('deuk-agents'),
  GH_REPO: z.string().default('deuk-agents-platform'),
  DOCKER_SOCK: z.string().default('/var/run/docker.sock'),
  TASKS_DIR: z.string().default('/data/tasks'),
});

export type DeukConfig = z.infer<typeof DeukConfigSchema>;

/** Parse and validate environment variables. Throws on invalid config. */
export function parseConfig(env: Record<string, string | undefined> = process.env): DeukConfig {
  return DeukConfigSchema.parse(env);
}

/** Safe parse — returns { success, data?, error? } */
export function safeParseConfig(env: Record<string, string | undefined> = process.env) {
  return DeukConfigSchema.safeParse(env);
}

// ─────────────────────────────────────────────────────────────
// Sandbox Profiles
// ─────────────────────────────────────────────────────────────

export const SandboxProfileSchema = z.object({
  name: z.string(),
  read_only: z.boolean().default(false),
  cap_drop: z.array(z.string()).default(['ALL']),
  security_opt: z.array(z.string()).default(['no-new-privileges:true']),
  tmpfs: z.array(z.string()).default(['/tmp:noexec,nosuid,size=100m']),
  allowed_networks: z.array(z.string()).default(['deuk-internal']),
  allowed_models: z.array(ModelSchema).optional(),
  max_budget_usd: z.number().positive().optional(),
});
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

export const SANDBOX_PROFILES: Record<Profile, SandboxProfile> = {
  'readonly-scout': {
    name: 'readonly-scout',
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=50m'],
    allowed_networks: ['deuk-internal'],
    allowed_models: ['openai/gpt-4.1-nano'],
    max_budget_usd: 0.50,
  },
  default: {
    name: 'default',
    read_only: false,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'],
    allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'default-gleam': {
    name: 'default-gleam',
    read_only: false,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'],
    allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'default-ts': {
    name: 'default-ts',
    read_only: false,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'],
    allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'deploy-staging': {
    name: 'deploy-staging',
    read_only: false,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'],
    allowed_networks: ['deuk-internal'],
    max_budget_usd: 5.00,
  },
};

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────
export { z };
