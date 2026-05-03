/**
 * DEUK Config — Centralized, type-safe configuration for the DEUK Agents Platform.
 *
 * Design principles:
 *   1. All env vars validated with Zod at startup — invalid config = fast fail.
 *   2. Model costs are NOT hardcoded. They are fetched from the provider API at
 *      runtime via fetchModelPricing(). FALLBACK_MODEL_COSTS used only when unreachable.
 *   3. The LLM provider is abstracted behind LLMProviderConfig so we can swap
 *      OpenRouter for any OpenAI-compatible provider without touching service code.
 *   4. Services use @openrouter/ai-sdk-provider + Vercel AI SDK for all LLM calls.
 *      Do NOT hand-roll fetch() calls to OpenRouter.
 */
import { z } from 'zod';

export const DEUK_VERSION = '0.3.0';

export const DEFAULTS = {
  ORCHESTRATOR_PORT:      7001,
  GATEWAY_PORT:           7100,
  DASHBOARD_PORT:         7000,
  DATABASE_URL:           'sqlite:///data/orchestrator.db',
  GATEWAY_URL:            'http://gateway:7100',
  ORCHESTRATOR_URL:       'http://orchestrator:7001',
  AWS_REGION:             'eu-west-1',
  DAILY_BUDGET_USD:       6.67,
  MONTHLY_BUDGET_USD:     200,
  HARD_BUDGET_USD:        300,
  RATE_LIMIT_RPM:         60,
  MAX_CONCURRENT_WORKERS: 3,
  TASK_BUDGET_USD:        2.50,
  TASK_BUDGET_TOKENS:     2_000_000,
  WORKSPACE:              '/workspace',
} as const;

export const Tier = z.enum(['orchestrator', 'reviewer', 'worker', 'tester', 'scout']);
export type Tier = z.infer<typeof Tier>;

export const Profile = z.enum([
  'readonly-scout', 'default', 'default-gleam', 'default-ts', 'deploy-staging',
]);
export type Profile = z.infer<typeof Profile>;

export const TaskStatus = z.enum([
  'queued', 'running', 'awaiting-human', 'blocked', 'done', 'failed', 'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ── LLM Provider Abstraction ──────────────────────────────────────────────────

export const LLMProviderSchema = z.enum(['openrouter', 'openai', 'anthropic', 'custom']);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export interface LLMProviderConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  requireNoTrainingHeaders: boolean;
}

const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai:     'https://api.openai.com/v1',
  anthropic:  'https://api.anthropic.com/v1',
  custom:     'http://localhost:11434/v1',
};

export function buildProviderConfig(env: Record<string, string | undefined>): LLMProviderConfig {
  const provider = (env['DEUK_LLM_PROVIDER'] ?? 'openrouter') as LLMProvider;
  const apiKey =
    env['OPENROUTER_API_KEY'] ??
    env['OPENAI_API_KEY'] ??
    env['ANTHROPIC_API_KEY'] ??
    '';
  const baseUrl = env['DEUK_LLM_BASE_URL'] ?? PROVIDER_BASE_URLS[provider];
  const requireNoTrainingHeaders = env['REQUIRE_NO_TRAINING_HEADERS'] !== 'false';
  return { provider, baseUrl, apiKey, requireNoTrainingHeaders };
}

// ── Model Registry ────────────────────────────────────────────────────────────

export const ALLOWED_MODELS = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-haiku-4.5',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v3.2',
  'moonshotai/kimi-k2.6',
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'x-ai/grok-4.1-fast',
  'minimax/minimax-m2.7',
  'stepfun/step-3.5-flash',
] as const;

export const ModelSchema = z.enum(ALLOWED_MODELS as unknown as [string, ...string[]]);
export type Model = z.infer<typeof ModelSchema>;

/**
 * Fallback costs per 1K tokens (USD). Used ONLY when provider pricing API is unreachable.
 * Live costs are fetched from OpenRouter's /api/v1/models endpoint.
 * Source: OpenRouter model pages, verified 2026-05-03.
 */
export const FALLBACK_MODEL_COSTS: Record<Model, { in: number; out: number }> = {
  'anthropic/claude-sonnet-4.6':   { in: 0.003,    out: 0.015    },
  'anthropic/claude-opus-4.7':     { in: 0.005,    out: 0.025    },
  'anthropic/claude-opus-4.6':     { in: 0.005,    out: 0.025    },
  'anthropic/claude-haiku-4.5':    { in: 0.0008,   out: 0.004    },
  'deepseek/deepseek-v4-pro':      { in: 0.000435, out: 0.00087  },
  'deepseek/deepseek-v4-flash':    { in: 0.00014,  out: 0.00028  },
  'deepseek/deepseek-v3.2':        { in: 0.000252, out: 0.000378 },
  'moonshotai/kimi-k2.6':          { in: 0.00074,  out: 0.00349  },
  'google/gemini-3-flash-preview':  { in: 0.0005,   out: 0.003    },
  'google/gemini-2.5-flash':        { in: 0.0003,   out: 0.0025   },
  'google/gemini-2.5-flash-lite':   { in: 0.0001,   out: 0.0004   },
  'openai/gpt-4.1':                 { in: 0.002,    out: 0.008    },
  'openai/gpt-4.1-mini':            { in: 0.0004,   out: 0.0016   },
  'openai/gpt-4.1-nano':            { in: 0.0001,   out: 0.0004   },
  'x-ai/grok-4.1-fast':             { in: 0.0002,   out: 0.0005   },
  'minimax/minimax-m2.7':           { in: 0.0003,   out: 0.0012   },
  'stepfun/step-3.5-flash':         { in: 0.0001,   out: 0.0003   },
};

/** @deprecated Use FALLBACK_MODEL_COSTS. Live costs come from the gateway /models endpoint. */
export const MODEL_COSTS = FALLBACK_MODEL_COSTS;

export const TIER_DEFAULT_MODEL: Record<Tier, Model> = {
  orchestrator: 'anthropic/claude-opus-4.7',
  reviewer:     'anthropic/claude-sonnet-4.6',
  worker:       'deepseek/deepseek-v4-pro',
  tester:       'moonshotai/kimi-k2.6',
  scout:        'google/gemini-2.5-flash-lite',
};

// ── Live Pricing ──────────────────────────────────────────────────────────────

export interface ModelPricing {
  id: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  contextLength: number;
  fetchedAt: string;
}

export async function fetchModelPricing(
  apiKey?: string,
  baseUrl = 'https://openrouter.ai/api/v1',
): Promise<Map<string, ModelPricing>> {
  const result = new Map<string, ModelPricing>();
  const now = new Date().toISOString();

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as {
      data: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string };
        context_length?: number;
      }>;
    };

    for (const model of data.data ?? []) {
      const inputPer1k  = parseFloat(model.pricing?.prompt      ?? '0') * 1000;
      const outputPer1k = parseFloat(model.pricing?.completion  ?? '0') * 1000;
      result.set(model.id, {
        id:              model.id,
        inputCostPer1k:  inputPer1k,
        outputCostPer1k: outputPer1k,
        contextLength:   model.context_length ?? 0,
        fetchedAt:       now,
      });
    }
  } catch {
    for (const [id, costs] of Object.entries(FALLBACK_MODEL_COSTS)) {
      result.set(id, {
        id,
        inputCostPer1k:  costs.in,
        outputCostPer1k: costs.out,
        contextLength:   0,
        fetchedAt:       now,
      });
    }
  }

  return result;
}

export function getModelCost(
  modelId: string,
  livePricing?: Map<string, ModelPricing>,
): { in: number; out: number } {
  if (livePricing?.has(modelId)) {
    const p = livePricing.get(modelId)!;
    return { in: p.inputCostPer1k, out: p.outputCostPer1k };
  }
  return FALLBACK_MODEL_COSTS[modelId as Model] ?? { in: 0.003, out: 0.015 };
}

// ── Task Schemas ──────────────────────────────────────────────────────────────

export const TaskCreateSchema = z.object({
  repo:          z.string().min(1, 'repo is required'),
  issue:         z.number().int().positive().optional(),
  goal:          z.string().min(1, 'goal is required'),
  tier:          Tier.default('worker'),
  profile:       Profile.default('default'),
  budget_usd:    z.number().positive().default(DEFAULTS.TASK_BUDGET_USD),
  budget_tokens: z.number().int().positive().default(DEFAULTS.TASK_BUDGET_TOKENS),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskSchema = z.object({
  id:            z.string(),
  repo:          z.string(),
  issue:         z.number().int().nullable(),
  goal:          z.string(),
  status:        TaskStatus,
  tier:          Tier,
  profile:       Profile,
  budget_usd:    z.number(),
  budget_tokens: z.number(),
  spent_usd:     z.number().default(0),
  spent_tokens:  z.number().int().default(0),
  created_at:    z.string().datetime(),
  updated_at:    z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

export const EventSchema = z.object({
  id:         z.number().int(),
  task_id:    z.string(),
  event_type: z.string(),
  payload:    z.string().nullable(),
  created_at: z.string().datetime(),
});
export type Event = z.infer<typeof EventSchema>;

// ── Environment Config ────────────────────────────────────────────────────────

export const DeukConfigSchema = z.object({
  DEUK_ENV:        z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
  PORT:            z.coerce.number().int().positive().optional(),
  GATEWAY_PORT:    z.coerce.number().int().positive().default(DEFAULTS.GATEWAY_PORT),
  DASHBOARD_PORT:  z.coerce.number().int().positive().default(DEFAULTS.DASHBOARD_PORT),
  DATABASE_URL:    z.string().default(DEFAULTS.DATABASE_URL),
  GATEWAY_URL:     z.string().url().default(DEFAULTS.GATEWAY_URL),
  ORCHESTRATOR_URL: z.string().url().default(DEFAULTS.ORCHESTRATOR_URL),

  DEUK_LLM_PROVIDER: LLMProviderSchema.default('openrouter'),
  DEUK_LLM_BASE_URL: z.string().optional().transform(v => (!v || v === '') ? undefined : v),
  OPENROUTER_API_KEY: z.string().optional().or(z.literal('')),
  OPENAI_API_KEY:     z.string().optional().or(z.literal('')),
  ANTHROPIC_API_KEY:  z.string().optional().or(z.literal('')),

  DAILY_BUDGET_USD:   z.coerce.number().positive().default(DEFAULTS.DAILY_BUDGET_USD),
  MONTHLY_BUDGET_USD: z.coerce.number().positive().default(DEFAULTS.MONTHLY_BUDGET_USD),
  HARD_BUDGET_USD:    z.coerce.number().positive().default(DEFAULTS.HARD_BUDGET_USD),

  ALLOWED_MODELS: z.string()
    .transform((s) => s.split(',').map((m) => m.trim()).filter(Boolean))
    .default(ALLOWED_MODELS.join(',')),

  RATE_LIMIT_RPM:              z.coerce.number().int().positive().default(DEFAULTS.RATE_LIMIT_RPM),
  REQUIRE_NO_TRAINING_HEADERS: z.string().optional().transform(
    (v) => v === undefined ? true : (v !== 'false' && v !== '0' && v !== 'no'),
  ),
  SCRUBBER_PATTERNS:           z.string().default('credit_card,ssn,api_key,email'),

  MAX_CONCURRENT_WORKERS: z.coerce.number().int().positive().default(DEFAULTS.MAX_CONCURRENT_WORKERS),
  TASKS_DIR:              z.string().default('/data/tasks'),

  AWS_REGION:         z.string().default(DEFAULTS.AWS_REGION),
  AWS_DEFAULT_REGION: z.string().default(DEFAULTS.AWS_REGION),
  S3_AUDIT_BUCKET:    z.string().default('deuk-audit-local'),

  GH_TOKEN: z.string().optional(),
  GH_ORG:   z.string().default('deuk-agents'),
  GH_REPO:  z.string().default('deuk-agents-platform'),

  DOCKER_SOCK: z.string().default('/var/run/docker.sock'),
}).superRefine((data, ctx) => {
  if (data.DEUK_ENV !== 'local') {
    const hasKey = data.OPENROUTER_API_KEY || data.OPENAI_API_KEY || data.ANTHROPIC_API_KEY;
    if (!hasKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'An LLM API key (OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY) ' +
          'is required in non-local environments',
        path: ['OPENROUTER_API_KEY'],
      });
    }
  }
});

export type DeukConfig = z.infer<typeof DeukConfigSchema>;

export function parseConfig(env: Record<string, string | undefined> = process.env): DeukConfig {
  return DeukConfigSchema.parse(env);
}

export function safeParseConfig(env: Record<string, string | undefined> = process.env) {
  return DeukConfigSchema.safeParse(env);
}

export function getProviderConfig(cfg: DeukConfig): LLMProviderConfig {
  return buildProviderConfig({
    DEUK_LLM_PROVIDER:           cfg.DEUK_LLM_PROVIDER,
    DEUK_LLM_BASE_URL:           cfg.DEUK_LLM_BASE_URL,
    OPENROUTER_API_KEY:          cfg.OPENROUTER_API_KEY,
    OPENAI_API_KEY:              cfg.OPENAI_API_KEY,
    ANTHROPIC_API_KEY:           cfg.ANTHROPIC_API_KEY,
    REQUIRE_NO_TRAINING_HEADERS: String(cfg.REQUIRE_NO_TRAINING_HEADERS),
  });
}

// ── Sandbox Profiles ──────────────────────────────────────────────────────────

export const SandboxProfileSchema = z.object({
  name:             z.string(),
  read_only:        z.boolean().default(false),
  cap_drop:         z.array(z.string()).default(['ALL']),
  security_opt:     z.array(z.string()).default(['no-new-privileges:true']),
  tmpfs:            z.array(z.string()).default(['/tmp:noexec,nosuid,size=100m']),
  allowed_networks: z.array(z.string()).default(['deuk-internal']),
  allowed_models:   z.array(ModelSchema).optional(),
  max_budget_usd:   z.number().positive().optional(),
});
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

export const SANDBOX_PROFILES: Record<Profile, SandboxProfile> = {
  'readonly-scout': {
    name: 'readonly-scout', read_only: true,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=50m'], allowed_networks: ['deuk-internal'],
    allowed_models: ['google/gemini-2.5-flash-lite'], max_budget_usd: 0.50,
  },
  default: {
    name: 'default', read_only: false,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'], allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'default-gleam': {
    name: 'default-gleam', read_only: false,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'], allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'default-ts': {
    name: 'default-ts', read_only: false,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'], allowed_networks: ['deuk-internal'],
    max_budget_usd: 2.50,
  },
  'deploy-staging': {
    name: 'deploy-staging', read_only: false,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m'], allowed_networks: ['deuk-internal'],
    max_budget_usd: 5.00,
  },
};

export { z };
