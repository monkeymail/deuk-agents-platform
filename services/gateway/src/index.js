/**
 * DEUK LLM Gateway — Provider-agnostic proxy with budget enforcement, scrubber, live pricing.
 *
 * Key features:
 *   - Provider abstraction: routes to OpenRouter, OpenAI, Anthropic, or custom endpoint
 *   - Live model pricing: fetched from provider API on startup, refreshed every 6h
 *   - Budget enforcement: per-call estimate, daily/monthly/hard limits
 *   - PII scrubber: credit cards, SSN, API keys, emails
 *   - No-training headers: injected on every request per GDPR/privacy policy
 *   - Rate limiting: in-memory sliding window
 *   - GET /models: returns live pricing for all allowed models
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  DEFAULTS,
  parseConfig,
  ALLOWED_MODELS,
  FALLBACK_MODEL_COSTS,
  getProviderConfig,
  fetchModelPricing,
} from '@deuk/config';

const cfg = parseConfig(process.env);
const providerCfg = getProviderConfig(cfg);

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT              = cfg.GATEWAY_PORT;
const ALLOWED_SET       = new Set(cfg.ALLOWED_MODELS);
const RATE_LIMIT_RPM    = cfg.RATE_LIMIT_RPM;
const SCRUBBER_PATTERNS = cfg.SCRUBBER_PATTERNS.split(',').map(s => s.trim());

// ─── Live Pricing Cache ───────────────────────────────────────────────────────
let livePricing = new Map();
let pricingFetchedAt = null;

async function refreshPricing() {
  try {
    const apiKey = providerCfg.apiKey;
    const baseUrl = providerCfg.baseUrl;
    livePricing = await fetchModelPricing(apiKey, baseUrl);
    pricingFetchedAt = new Date().toISOString();
    console.log(JSON.stringify({
      ts: pricingFetchedAt, svc: 'gateway', event: 'pricing.refreshed',
      models: livePricing.size,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), svc: 'gateway', event: 'pricing.refresh_failed',
      error: err.message,
    }));
  }
}

// Fetch pricing on startup, then every 6 hours
refreshPricing();
setInterval(refreshPricing, 6 * 60 * 60 * 1000);

// ─── Cost helpers ─────────────────────────────────────────────────────────────
function getModelCost(modelId) {
  if (livePricing.has(modelId)) {
    const p = livePricing.get(modelId);
    return { in: p.inputCostPer1k, out: p.outputCostPer1k };
  }
  return FALLBACK_MODEL_COSTS[modelId] || { in: 0.003, out: 0.015 };
}

function estimateCost(messages, modelId) {
  const totalChars = messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    if (Array.isArray(m.content)) return sum + m.content.map(c => c.text || '').join('').length;
    return sum;
  }, 0);
  const estimatedTokens = totalChars / 4;
  const rate = getModelCost(modelId);
  return (estimatedTokens / 1000) * rate.in;
}

function calculateCost(promptTokens, completionTokens, modelId) {
  const rate = getModelCost(modelId);
  return (promptTokens / 1000) * rate.in + (completionTokens / 1000) * rate.out;
}

// ─── Budget tracking ──────────────────────────────────────────────────────────
let dailySpend   = 0;
let monthlySpend = 0;
let dailyResetAt = new Date().toDateString();

function checkAndResetDaily() {
  const today = new Date().toDateString();
  if (today !== dailyResetAt) {
    dailySpend   = 0;
    dailyResetAt = today;
  }
}

function checkBudget(cost) {
  checkAndResetDaily();
  if (dailySpend + cost > cfg.HARD_BUDGET_USD) {
    return { ok: false, reason: 'hard_budget_exceeded', limit: cfg.HARD_BUDGET_USD, current: dailySpend };
  }
  if (dailySpend + cost > cfg.DAILY_BUDGET_USD) {
    return { ok: false, reason: 'daily_budget_exceeded', limit: cfg.DAILY_BUDGET_USD, current: dailySpend };
  }
  if (monthlySpend + cost > cfg.MONTHLY_BUDGET_USD) {
    return { ok: false, reason: 'monthly_budget_exceeded', limit: cfg.MONTHLY_BUDGET_USD, current: monthlySpend };
  }
  return { ok: true };
}

// ─── PII Scrubber ─────────────────────────────────────────────────────────────
const SCRUB_RULES = [
  { name: 'credit_card', regex: /\b(?:\d[ -]*?){13,16}\b/g,                          replacement: '[REDACTED_CC]' },
  { name: 'ssn',         regex: /\b\d{3}-\d{2}-\d{4}\b/g,                            replacement: '[REDACTED_SSN]' },
  { name: 'api_key',     regex: /\b(sk-[a-zA-Z0-9]{20,}|sk-or-v1-[a-zA-Z0-9]{40,})\b/g, replacement: '[REDACTED_KEY]' },
  { name: 'email',       regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
];

function scrubText(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const rule of SCRUB_RULES) {
    if (SCRUBBER_PATTERNS.includes(rule.name)) {
      result = result.replace(rule.regex, rule.replacement);
    }
  }
  return result;
}

function scrubMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(m => {
    if (typeof m.content === 'string') return { ...m, content: scrubText(m.content) };
    if (Array.isArray(m.content)) {
      return { ...m, content: m.content.map(c => c.text ? { ...c, text: scrubText(c.text) } : c) };
    }
    return m;
  });
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const requestLog = [];
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (requestLog.length && requestLog[0] < windowStart) requestLog.shift();
  if (requestLog.length >= RATE_LIMIT_RPM) return false;
  requestLog.push(now);
  return true;
}

// ─── No-training headers ──────────────────────────────────────────────────────
const NO_TRAINING_HEADERS = {
  'X-Title':                  'DEUK Agents',
  'HTTP-Referer':             'https://deuk.local',
  'X-Anthropic-No-Retention': 'true',
  'X-OpenAI-No-Training':     'true',
  'X-Google-No-Training':     'true',
  'X-DEUK-No-Training':       'true',
};

// ─── Middleware: validate + budget + scrub ────────────────────────────────────
app.use('/api/v1/chat/completions', (req, res, next) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ error: 'Missing model field' });
  if (!ALLOWED_SET.has(model)) {
    return res.status(403).json({ error: 'Model not in allowlist', model, allowed: cfg.ALLOWED_MODELS });
  }
  if (!checkRateLimit()) {
    return res.status(429).json({ error: 'Rate limit exceeded', limit_rpm: RATE_LIMIT_RPM });
  }

  const estimatedCost = estimateCost(req.body.messages || [], model);
  const budgetCheck = checkBudget(estimatedCost);
  if (!budgetCheck.ok) {
    return res.status(403).json({
      error: 'Budget exceeded',
      reason: budgetCheck.reason,
      limit: budgetCheck.limit,
      current_spend: budgetCheck.current,
    });
  }

  req.body.messages = scrubMessages(req.body.messages);
  req._deukModel = model;
  next();
});

// ─── Proxy to provider ────────────────────────────────────────────────────────
const proxy = createProxyMiddleware({
  target: providerCfg.baseUrl.replace('/api/v1', '').replace('/v1', ''),
  changeOrigin: true,
  pathRewrite: (path) => {
    // Normalize path for different providers
    if (providerCfg.provider === 'openrouter') return path; // already /api/v1/...
    return path.replace('/api/v1', '/v1');
  },
  on: {
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Authorization', `Bearer ${providerCfg.apiKey}`);
      if (providerCfg.requireNoTrainingHeaders) {
        for (const [k, v] of Object.entries(NO_TRAINING_HEADERS)) {
          proxyReq.setHeader(k, v);
        }
      }
      // Re-serialize body (it was modified by scrubber)
      const body = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
      proxyReq.write(body);
    },
    proxyRes: (proxyRes, req) => {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        try {
          const json = JSON.parse(body);
          const usage = json.usage || {};
          const model = req._deukModel || req.body?.model;
          const cost = calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, model);
          dailySpend   += cost;
          monthlySpend += cost;
          console.log(JSON.stringify({
            ts: new Date().toISOString(), svc: 'gateway', event: 'llm.call',
            model, tokens_in: usage.prompt_tokens, tokens_out: usage.completion_tokens,
            cost_usd: cost, daily_spend: dailySpend, monthly_spend: monthlySpend,
          }));
        } catch { /* ignore parse errors */ }
      });
    },
  },
});

app.use('/api/v1/chat/completions', proxy);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  checkAndResetDaily();
  res.json({
    status: 'ok',
    service: 'gateway',
    provider: providerCfg.provider,
    provider_base_url: providerCfg.baseUrl,
    allowed_models: cfg.ALLOWED_MODELS,
    pricing_fetched_at: pricingFetchedAt,
    daily_spend: dailySpend,
    monthly_spend: monthlySpend,
    daily_budget: cfg.DAILY_BUDGET_USD,
    monthly_budget: cfg.MONTHLY_BUDGET_USD,
    hard_budget: cfg.HARD_BUDGET_USD,
    rate_limit_rpm: RATE_LIMIT_RPM,
    scrubber_patterns: SCRUBBER_PATTERNS,
    no_training_headers: providerCfg.requireNoTrainingHeaders,
  });
});

/** Live model pricing endpoint — used by workers to get current costs */
app.get('/models', (_req, res) => {
  const models = cfg.ALLOWED_MODELS.map(id => {
    const live = livePricing.get(id);
    const fallback = FALLBACK_MODEL_COSTS[id] || { in: 0.003, out: 0.015 };
    return {
      id,
      input_cost_per_1k:  live ? live.inputCostPer1k  : fallback.in,
      output_cost_per_1k: live ? live.outputCostPer1k : fallback.out,
      context_length:     live ? live.contextLength    : 0,
      source:             live ? 'live' : 'fallback',
      fetched_at:         live ? live.fetchedAt        : null,
    };
  });
  res.json({ models, pricing_fetched_at: pricingFetchedAt });
});

app.get('/budget', (_req, res) => {
  checkAndResetDaily();
  res.json({
    daily_spend:    dailySpend,
    monthly_spend:  monthlySpend,
    daily_budget:   cfg.DAILY_BUDGET_USD,
    monthly_budget: cfg.MONTHLY_BUDGET_USD,
    hard_budget:    cfg.HARD_BUDGET_USD,
    daily_remaining:   Math.max(0, cfg.DAILY_BUDGET_USD - dailySpend),
    monthly_remaining: Math.max(0, cfg.MONTHLY_BUDGET_USD - monthlySpend),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(), svc: 'gateway', event: 'started',
    port: PORT, provider: providerCfg.provider, base_url: providerCfg.baseUrl,
    allowed_models: cfg.ALLOWED_MODELS.length,
  }));
});
