import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseConfig,
  safeParseConfig,
  TaskCreateSchema,
  Tier,
  TaskStatus,
  ALLOWED_MODELS,
  MODEL_COSTS,
  TIER_DEFAULT_MODEL,
  DEFAULTS,
} from './index.js';

describe('DeukConfig', () => {
  test('parses valid config with defaults', () => {
    const cfg = parseConfig({});
    assert.strictEqual(cfg.DEUK_ENV, 'local');
    assert.strictEqual(cfg.GATEWAY_PORT, DEFAULTS.GATEWAY_PORT);
    assert.strictEqual(cfg.DAILY_BUDGET_USD, DEFAULTS.DAILY_BUDGET_USD);
  });

  test('parses custom env vars', () => {
    const cfg = parseConfig({
      DEUK_ENV: 'staging',
      DAILY_BUDGET_USD: '10.00',
      RATE_LIMIT_RPM: '120',
    });
    assert.strictEqual(cfg.DEUK_ENV, 'staging');
    assert.strictEqual(cfg.DAILY_BUDGET_USD, 10.00);
    assert.strictEqual(cfg.RATE_LIMIT_RPM, 120);
  });

  test('allows empty OPENROUTER_API_KEY', () => {
    const cfg = parseConfig({ OPENROUTER_API_KEY: '' });
    assert.strictEqual(cfg.OPENROUTER_API_KEY, '');
  });

  test('rejects invalid env', () => {
    const result = safeParseConfig({ DEUK_ENV: 'invalid' });
    assert.strictEqual(result.success, false);
  });
});

describe('TaskCreateSchema', () => {
  test('validates minimal task', () => {
    const result = TaskCreateSchema.safeParse({
      repo: 'deuk-agents/platform',
      goal: 'Fix bug',
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.tier, 'worker');
      assert.strictEqual(result.data.budget_usd, DEFAULTS.TASK_BUDGET_USD);
    }
  });

  test('rejects missing repo', () => {
    const result = TaskCreateSchema.safeParse({ goal: 'Fix bug' });
    assert.strictEqual(result.success, false);
  });
});

describe('Model Registry', () => {
  test('all allowed models have costs', () => {
    for (const model of ALLOWED_MODELS) {
      assert.ok(MODEL_COSTS[model], `Missing cost for ${model}`);
      assert.ok(MODEL_COSTS[model].in > 0, `Invalid input cost for ${model}`);
      assert.ok(MODEL_COSTS[model].out > 0, `Invalid output cost for ${model}`);
    }
  });

  test('tier default models are in allowlist', () => {
    for (const [tier, model] of Object.entries(TIER_DEFAULT_MODEL)) {
      assert.ok(ALLOWED_MODELS.includes(model as any), `Invalid default model for ${tier}: ${model}`);
    }
  });
});

describe('Enums', () => {
  test('Tier has required values', () => {
    const tiers = Tier.options;
    assert.ok(tiers.includes('orchestrator'));
    assert.ok(tiers.includes('worker'));
    assert.ok(tiers.includes('reviewer'));
  });

  test('TaskStatus has required values', () => {
    const statuses = TaskStatus.options;
    assert.ok(statuses.includes('queued'));
    assert.ok(statuses.includes('running'));
    assert.ok(statuses.includes('done'));
    assert.ok(statuses.includes('failed'));
  });
});
