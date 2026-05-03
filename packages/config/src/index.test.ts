/**
 * @deuk/config — Comprehensive test suite
 *
 * Tests cover:
 *   - Config parsing and validation
 *   - Provider abstraction
 *   - Model registry integrity
 *   - Live pricing fetch (mocked)
 *   - Task schemas
 *   - Sandbox profiles
 *   - Staging/prod key requirement
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseConfig,
  safeParseConfig,
  getProviderConfig,
  buildProviderConfig,
  fetchModelPricing,
  getModelCost,
  ALLOWED_MODELS,
  FALLBACK_MODEL_COSTS,
  TIER_DEFAULT_MODEL,
  SANDBOX_PROFILES,
  DEFAULTS,
  TaskCreateSchema,
  Tier,
  Profile,
  TaskStatus,
  DEUK_VERSION,
  type ModelPricing,
} from './index.js';

// ─────────────────────────────────────────────────────────────
// Config parsing
// ─────────────────────────────────────────────────────────────

describe('parseConfig', () => {
  it('parses with all defaults when env is empty', () => {
    const cfg = parseConfig({});
    expect(cfg.DEUK_ENV).toBe('local');
    expect(cfg.GATEWAY_PORT).toBe(DEFAULTS.GATEWAY_PORT);
    expect(cfg.DASHBOARD_PORT).toBe(DEFAULTS.DASHBOARD_PORT);
    expect(cfg.DAILY_BUDGET_USD).toBe(DEFAULTS.DAILY_BUDGET_USD);
    expect(cfg.MONTHLY_BUDGET_USD).toBe(DEFAULTS.MONTHLY_BUDGET_USD);
    expect(cfg.HARD_BUDGET_USD).toBe(DEFAULTS.HARD_BUDGET_USD);
    expect(cfg.RATE_LIMIT_RPM).toBe(DEFAULTS.RATE_LIMIT_RPM);
    expect(cfg.MAX_CONCURRENT_WORKERS).toBe(DEFAULTS.MAX_CONCURRENT_WORKERS);
    expect(cfg.DEUK_LLM_PROVIDER).toBe('openrouter');
    expect(cfg.REQUIRE_NO_TRAINING_HEADERS).toBe(true);
    expect(cfg.AWS_REGION).toBe('eu-west-1');
  });

  it('parses custom numeric env vars with coercion', () => {
    const cfg = parseConfig({
      DAILY_BUDGET_USD:   '10.00',
      RATE_LIMIT_RPM:     '120',
      GATEWAY_PORT:       '8100',
      MAX_CONCURRENT_WORKERS: '5',
    });
    expect(cfg.DAILY_BUDGET_USD).toBe(10.00);
    expect(cfg.RATE_LIMIT_RPM).toBe(120);
    expect(cfg.GATEWAY_PORT).toBe(8100);
    expect(cfg.MAX_CONCURRENT_WORKERS).toBe(5);
  });

  it('parses all valid DEUK_ENV values', () => {
    for (const env of ['local', 'dev', 'staging', 'prod'] as const) {
      const cfg = parseConfig({ DEUK_ENV: env, OPENROUTER_API_KEY: 'sk-test' });
      expect(cfg.DEUK_ENV).toBe(env);
    }
  });

  it('rejects invalid DEUK_ENV', () => {
    const result = safeParseConfig({ DEUK_ENV: 'production' });
    expect(result.success).toBe(false);
  });

  it('allows empty OPENROUTER_API_KEY in local env', () => {
    const cfg = parseConfig({ OPENROUTER_API_KEY: '' });
    expect(cfg.OPENROUTER_API_KEY).toBe('');
  });

  it('allows missing API key in local env', () => {
    const cfg = parseConfig({ DEUK_ENV: 'local' });
    expect(cfg.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('requires API key in staging env', () => {
    const result = safeParseConfig({ DEUK_ENV: 'staging' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('API key');
    }
  });

  it('accepts OPENAI_API_KEY as alternative in staging', () => {
    const cfg = parseConfig({ DEUK_ENV: 'staging', OPENAI_API_KEY: 'sk-openai-test' });
    expect(cfg.OPENAI_API_KEY).toBe('sk-openai-test');
  });

  it('accepts ANTHROPIC_API_KEY as alternative in prod', () => {
    const cfg = parseConfig({ DEUK_ENV: 'prod', ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(cfg.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('parses ALLOWED_MODELS from comma-separated string', () => {
    const cfg = parseConfig({
      ALLOWED_MODELS: 'openai/gpt-4.1,deepseek/deepseek-v4-pro',
    });
    expect(cfg.ALLOWED_MODELS).toEqual(['openai/gpt-4.1', 'deepseek/deepseek-v4-pro']);
  });

  it('trims whitespace from ALLOWED_MODELS', () => {
    const cfg = parseConfig({
      ALLOWED_MODELS: ' openai/gpt-4.1 , deepseek/deepseek-v4-pro ',
    });
    expect(cfg.ALLOWED_MODELS).toEqual(['openai/gpt-4.1', 'deepseek/deepseek-v4-pro']);
  });

  it('parses REQUIRE_NO_TRAINING_HEADERS as boolean', () => {
    expect(parseConfig({ REQUIRE_NO_TRAINING_HEADERS: 'true' }).REQUIRE_NO_TRAINING_HEADERS).toBe(true);
    expect(parseConfig({ REQUIRE_NO_TRAINING_HEADERS: 'false' }).REQUIRE_NO_TRAINING_HEADERS).toBe(false);
    expect(parseConfig({ REQUIRE_NO_TRAINING_HEADERS: '0' }).REQUIRE_NO_TRAINING_HEADERS).toBe(false);
    expect(parseConfig({ REQUIRE_NO_TRAINING_HEADERS: 'no' }).REQUIRE_NO_TRAINING_HEADERS).toBe(false);
    expect(parseConfig({ REQUIRE_NO_TRAINING_HEADERS: '1' }).REQUIRE_NO_TRAINING_HEADERS).toBe(true);
    expect(parseConfig({}).REQUIRE_NO_TRAINING_HEADERS).toBe(true);
  });

  it('parses all LLM provider values', () => {
    for (const provider of ['openrouter', 'openai', 'anthropic', 'custom'] as const) {
      const cfg = parseConfig({ DEUK_LLM_PROVIDER: provider, OPENROUTER_API_KEY: 'key' });
      expect(cfg.DEUK_LLM_PROVIDER).toBe(provider);
    }
  });

  it('rejects invalid LLM provider', () => {
    const result = safeParseConfig({ DEUK_LLM_PROVIDER: 'cohere' });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Provider abstraction
// ─────────────────────────────────────────────────────────────

describe('buildProviderConfig', () => {
  it('defaults to openrouter with correct base URL', () => {
    const p = buildProviderConfig({ OPENROUTER_API_KEY: 'sk-or-test' });
    expect(p.provider).toBe('openrouter');
    expect(p.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(p.apiKey).toBe('sk-or-test');
    expect(p.requireNoTrainingHeaders).toBe(true);
  });

  it('uses OPENAI_API_KEY when provider is openai', () => {
    const p = buildProviderConfig({
      DEUK_LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-openai-test',
    });
    expect(p.provider).toBe('openai');
    expect(p.baseUrl).toBe('https://api.openai.com/v1');
    expect(p.apiKey).toBe('sk-openai-test');
  });

  it('uses ANTHROPIC_API_KEY when provider is anthropic', () => {
    const p = buildProviderConfig({
      DEUK_LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(p.provider).toBe('anthropic');
    expect(p.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(p.apiKey).toBe('sk-ant-test');
  });

  it('uses custom base URL when DEUK_LLM_BASE_URL is set', () => {
    const p = buildProviderConfig({
      DEUK_LLM_PROVIDER: 'custom',
      DEUK_LLM_BASE_URL: 'http://localhost:11434/v1',
    });
    expect(p.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('overrides base URL for any provider', () => {
    const p = buildProviderConfig({
      DEUK_LLM_PROVIDER: 'openrouter',
      DEUK_LLM_BASE_URL: 'https://my-proxy.example.com/v1',
      OPENROUTER_API_KEY: 'sk-test',
    });
    expect(p.baseUrl).toBe('https://my-proxy.example.com/v1');
  });

  it('disables no-training headers when explicitly set to false', () => {
    const p = buildProviderConfig({
      REQUIRE_NO_TRAINING_HEADERS: 'false',
    });
    expect(p.requireNoTrainingHeaders).toBe(false);
  });

  it('prefers OPENROUTER_API_KEY over OPENAI_API_KEY', () => {
    const p = buildProviderConfig({
      OPENROUTER_API_KEY: 'sk-or-first',
      OPENAI_API_KEY: 'sk-openai-second',
    });
    expect(p.apiKey).toBe('sk-or-first');
  });
});

describe('getProviderConfig', () => {
  it('returns correct provider config from parsed DeukConfig', () => {
    const cfg = parseConfig({ OPENROUTER_API_KEY: 'sk-or-test' });
    const p = getProviderConfig(cfg);
    expect(p.provider).toBe('openrouter');
    expect(p.apiKey).toBe('sk-or-test');
    expect(p.requireNoTrainingHeaders).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Model registry integrity
// ─────────────────────────────────────────────────────────────

describe('Model Registry', () => {
  it('has no duplicate model IDs', () => {
    const ids = [...ALLOWED_MODELS];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every allowed model has a fallback cost entry', () => {
    for (const model of ALLOWED_MODELS) {
      expect(FALLBACK_MODEL_COSTS[model], `Missing fallback cost for ${model}`).toBeDefined();
      expect(FALLBACK_MODEL_COSTS[model].in, `Zero input cost for ${model}`).toBeGreaterThan(0);
      expect(FALLBACK_MODEL_COSTS[model].out, `Zero output cost for ${model}`).toBeGreaterThan(0);
      // Output should always cost more than input (standard pricing)
      expect(
        FALLBACK_MODEL_COSTS[model].out,
        `Output cost should be >= input cost for ${model}`,
      ).toBeGreaterThanOrEqual(FALLBACK_MODEL_COSTS[model].in);
    }
  });

  it('every tier has a default model in the allowlist', () => {
    for (const tier of Tier.options) {
      const model = TIER_DEFAULT_MODEL[tier];
      expect(model, `No default model for tier ${tier}`).toBeDefined();
      expect(
        (ALLOWED_MODELS as readonly string[]).includes(model),
        `Default model ${model} for tier ${tier} not in ALLOWED_MODELS`,
      ).toBe(true);
    }
  });

  it('FALLBACK_MODEL_COSTS has no extra entries beyond ALLOWED_MODELS', () => {
    const allowedSet = new Set(ALLOWED_MODELS);
    for (const id of Object.keys(FALLBACK_MODEL_COSTS)) {
      expect(allowedSet.has(id), `Extra cost entry for unknown model: ${id}`).toBe(true);
    }
  });

  it('all model IDs follow provider/model-name format', () => {
    for (const model of ALLOWED_MODELS) {
      expect(model, `Model ID should contain a slash: ${model}`).toContain('/');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Live pricing fetch
// ─────────────────────────────────────────────────────────────

describe('fetchModelPricing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses OpenRouter pricing response correctly', async () => {
    const mockResponse = {
      data: [
        {
          id: 'anthropic/claude-sonnet-4.6',
          pricing: { prompt: '0.000003', completion: '0.000015' },
          context_length: 1_000_000,
        },
        {
          id: 'deepseek/deepseek-v4-pro',
          pricing: { prompt: '0.000000435', completion: '0.00000087' },
          context_length: 1_048_576,
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const pricing = await fetchModelPricing('sk-test');

    expect(pricing.has('anthropic/claude-sonnet-4.6')).toBe(true);
    const sonnet = pricing.get('anthropic/claude-sonnet-4.6')!;
    // 0.000003 per token * 1000 = 0.003 per 1K tokens
    expect(sonnet.inputCostPer1k).toBeCloseTo(0.003, 6);
    expect(sonnet.outputCostPer1k).toBeCloseTo(0.015, 6);
    expect(sonnet.contextLength).toBe(1_000_000);
    expect(sonnet.fetchedAt).toBeTruthy();

    const deepseek = pricing.get('deepseek/deepseek-v4-pro')!;
    expect(deepseek.inputCostPer1k).toBeCloseTo(0.000435, 6);
  });

  it('falls back to FALLBACK_MODEL_COSTS on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const pricing = await fetchModelPricing('sk-test');

    // Should have fallback entries for all ALLOWED_MODELS
    for (const model of ALLOWED_MODELS) {
      expect(pricing.has(model), `Missing fallback for ${model}`).toBe(true);
    }
  });

  it('falls back on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const pricing = await fetchModelPricing('sk-test');
    expect(pricing.size).toBeGreaterThan(0);
    // Fallback values should match FALLBACK_MODEL_COSTS
    const sonnet = pricing.get('anthropic/claude-sonnet-4.6');
    expect(sonnet?.inputCostPer1k).toBe(FALLBACK_MODEL_COSTS['anthropic/claude-sonnet-4.6'].in);
  });

  it('works without an API key (public endpoint)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    await fetchModelPricing();
    // No API key → should still call fetch without Authorization header
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/models'),
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) }),
    );
  });
});

describe('getModelCost', () => {
  it('returns live pricing when available', () => {
    const livePricing = new Map<string, ModelPricing>([
      ['openai/gpt-4.1', {
        id: 'openai/gpt-4.1',
        inputCostPer1k: 0.001,  // cheaper than fallback
        outputCostPer1k: 0.004,
        contextLength: 1_000_000,
        fetchedAt: new Date().toISOString(),
      }],
    ]);

    const cost = getModelCost('openai/gpt-4.1', livePricing);
    expect(cost.in).toBe(0.001);
    expect(cost.out).toBe(0.004);
  });

  it('falls back to FALLBACK_MODEL_COSTS when no live pricing', () => {
    const cost = getModelCost('openai/gpt-4.1');
    expect(cost.in).toBe(FALLBACK_MODEL_COSTS['openai/gpt-4.1'].in);
    expect(cost.out).toBe(FALLBACK_MODEL_COSTS['openai/gpt-4.1'].out);
  });

  it('returns safe default for unknown model', () => {
    const cost = getModelCost('unknown/model-xyz');
    expect(cost.in).toBe(0.003);
    expect(cost.out).toBe(0.015);
  });
});

// ─────────────────────────────────────────────────────────────
// Task schemas
// ─────────────────────────────────────────────────────────────

describe('TaskCreateSchema', () => {
  it('validates minimal task with defaults', () => {
    const result = TaskCreateSchema.safeParse({
      repo: 'deuk-agents/platform',
      goal: 'Fix the bug',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBe('worker');
      expect(result.data.profile).toBe('default');
      expect(result.data.budget_usd).toBe(DEFAULTS.TASK_BUDGET_USD);
      expect(result.data.budget_tokens).toBe(DEFAULTS.TASK_BUDGET_TOKENS);
    }
  });

  it('validates full task', () => {
    const result = TaskCreateSchema.safeParse({
      repo:          'deuk-agents/todos-app',
      issue:         42,
      goal:          'Add tag filtering',
      tier:          'reviewer',
      profile:       'default-ts',
      budget_usd:    5.00,
      budget_tokens: 1_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing repo', () => {
    const result = TaskCreateSchema.safeParse({ goal: 'Fix bug' });
    expect(result.success).toBe(false);
  });

  it('rejects empty goal', () => {
    const result = TaskCreateSchema.safeParse({ repo: 'org/repo', goal: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tier', () => {
    const result = TaskCreateSchema.safeParse({
      repo: 'org/repo',
      goal: 'Fix bug',
      tier: 'superagent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative budget', () => {
    const result = TaskCreateSchema.safeParse({
      repo: 'org/repo',
      goal: 'Fix bug',
      budget_usd: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

describe('Tier enum', () => {
  it('has all required tiers', () => {
    const tiers = Tier.options;
    expect(tiers).toContain('orchestrator');
    expect(tiers).toContain('reviewer');
    expect(tiers).toContain('worker');
    expect(tiers).toContain('tester');
    expect(tiers).toContain('scout');
  });
});

describe('TaskStatus enum', () => {
  it('has all required statuses', () => {
    const statuses = TaskStatus.options;
    expect(statuses).toContain('queued');
    expect(statuses).toContain('running');
    expect(statuses).toContain('awaiting-human');
    expect(statuses).toContain('blocked');
    expect(statuses).toContain('done');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('cancelled');
  });
});

describe('Profile enum', () => {
  it('has all required profiles', () => {
    const profiles = Profile.options;
    expect(profiles).toContain('readonly-scout');
    expect(profiles).toContain('default');
    expect(profiles).toContain('default-gleam');
    expect(profiles).toContain('default-ts');
    expect(profiles).toContain('deploy-staging');
  });
});

// ─────────────────────────────────────────────────────────────
// Sandbox profiles
// ─────────────────────────────────────────────────────────────

describe('SANDBOX_PROFILES', () => {
  it('has an entry for every Profile value', () => {
    for (const profile of Profile.options) {
      expect(SANDBOX_PROFILES[profile], `Missing sandbox profile: ${profile}`).toBeDefined();
    }
  });

  it('readonly-scout has read_only: true', () => {
    expect(SANDBOX_PROFILES['readonly-scout'].read_only).toBe(true);
  });

  it('all profiles drop ALL capabilities', () => {
    for (const name of Profile.options) {
      const profile = SANDBOX_PROFILES[name];
      expect(profile.cap_drop, `${name} should drop ALL caps`).toContain('ALL');
    }
  });

  it('all profiles have no-new-privileges', () => {
    for (const name of Profile.options) {
      const profile = SANDBOX_PROFILES[name];
      expect(
        profile.security_opt,
        `${name} should have no-new-privileges`,
      ).toContain('no-new-privileges:true');
    }
  });

  it('readonly-scout has a lower budget than default', () => {
    expect(SANDBOX_PROFILES['readonly-scout'].max_budget_usd!).toBeLessThan(
      SANDBOX_PROFILES['default'].max_budget_usd!,
    );
  });

  it('deploy-staging has the highest budget', () => {
    const budgets = Profile.options.map(name => SANDBOX_PROFILES[name].max_budget_usd ?? 0);
    const maxBudget = Math.max(...budgets);
    expect(SANDBOX_PROFILES['deploy-staging'].max_budget_usd).toBe(maxBudget);
  });
});

// ─────────────────────────────────────────────────────────────
// DEFAULTS integrity
// ─────────────────────────────────────────────────────────────

describe('DEFAULTS', () => {
  it('has sensible port values', () => {
    expect(DEFAULTS.ORCHESTRATOR_PORT).toBeGreaterThan(1024);
    expect(DEFAULTS.GATEWAY_PORT).toBeGreaterThan(1024);
    expect(DEFAULTS.DASHBOARD_PORT).toBeGreaterThan(1024);
    // All ports should be different
    const ports = [DEFAULTS.ORCHESTRATOR_PORT, DEFAULTS.GATEWAY_PORT, DEFAULTS.DASHBOARD_PORT];
    expect(new Set(ports).size).toBe(3);
  });

  it('has sensible budget values', () => {
    expect(DEFAULTS.DAILY_BUDGET_USD).toBeGreaterThan(0);
    expect(DEFAULTS.MONTHLY_BUDGET_USD).toBeGreaterThan(DEFAULTS.DAILY_BUDGET_USD);
    expect(DEFAULTS.HARD_BUDGET_USD).toBeGreaterThan(DEFAULTS.MONTHLY_BUDGET_USD);
  });

  it('daily budget * 30 approximates monthly budget', () => {
    const approxMonthly = DEFAULTS.DAILY_BUDGET_USD * 30;
    // Should be within 10% of monthly budget
    expect(Math.abs(approxMonthly - DEFAULTS.MONTHLY_BUDGET_USD)).toBeLessThan(
      DEFAULTS.MONTHLY_BUDGET_USD * 0.1,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Version
// ─────────────────────────────────────────────────────────────

describe('DEUK_VERSION', () => {
  it('follows semver format', () => {
    expect(DEUK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
