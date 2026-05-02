/**
 * DEUK LLM Gateway — OpenRouter proxy with model allowlist, budget enforcement, scrubber, no-training headers.
 * Uses centralized @deuk/config for all configuration.
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  DEFAULTS,
  parseConfig,
  ALLOWED_MODELS,
  MODEL_COSTS,
} from '@deuk/config';

const cfg = parseConfig(process.env);

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Config ───
const PORT = cfg.GATEWAY_PORT;
const OPENROUTER_API_KEY = cfg.OPENROUTER_API_KEY;
const ALLOWED_MODELS_SET = new Set(cfg.ALLOWED_MODELS);
const REQUIRE_NO_TRAINING = cfg.REQUIRE_NO_TRAINING_HEADERS;
const RATE_LIMIT_RPM = cfg.RATE_LIMIT_RPM;
const SCRUBBER_PATTERNS = (process.env.SCRUBBER_PATTERNS || 'credit_card,ssn,api_key').split(',');

// ─── Budget tracking ───
let dailySpend = 0;
let monthlySpend = 0;

function checkBudget(cost) {
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

// ─── Scrubber ───
const SCRUB_PATTERNS = [
  { name: 'credit_card', regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[REDACTED_CC]' },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { name: 'api_key', regex: /\b(sk-[a-zA-Z0-9]{20,48})\b/g, replacement: '[REDACTED_KEY]' },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
];

function scrubContent(content) {
  if (typeof content !== 'string') return content;
  let scrubbed = content;
  for (const pattern of SCRUB_PATTERNS) {
    if (SCRUBBER_PATTERNS.includes(pattern.name)) {
      scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
    }
  }
  return scrubbed;
}

function scrubRequestBody(body) {
  if (!body || !body.messages) return body;
  return {
    ...body,
    messages: body.messages.map(m => ({
      ...m,
      content: scrubContent(m.content),
    })),
  };
}

// ─── Simple in-memory rate limiter ───
const requestLog = [];
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (requestLog.length && requestLog[0] < windowStart) requestLog.shift();
  if (requestLog.length >= RATE_LIMIT_RPM) return false;
  requestLog.push(now);
  return true;
}

// ─── Middleware: validate model and budget ───
app.use('/api/v1/chat/completions', (req, res, next) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ error: 'Missing model field' });
  if (!ALLOWED_MODELS_SET.has(model)) {
    return res.status(403).json({ error: 'Model not in allowlist', model, allowed: cfg.ALLOWED_MODELS });
  }
  if (!checkRateLimit()) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  // Budget check — estimate cost before proxying
  const messages = req.body.messages || [];
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const estimatedTokens = totalChars / 4;
  const rate = MODEL_COSTS[model]?.in || 0.003;
  const estimatedCost = (estimatedTokens / 1000) * rate;

  const budgetCheck = checkBudget(estimatedCost);
  if (!budgetCheck.ok) {
    return res.status(403).json({
      error: 'Budget exceeded',
      reason: budgetCheck.reason,
      limit: budgetCheck.limit,
      current_spend: budgetCheck.current,
    });
  }

  // Scrub PII from request
  req.body = scrubRequestBody(req.body);

  next();
});

// ─── Proxy to OpenRouter ───
const proxy = createProxyMiddleware({
  target: 'https://openrouter.ai',
  changeOrigin: true,
  pathRewrite: { '^/api/v1': '/api/v1' },
  onProxyReq: (proxyReq, req) => {
    proxyReq.setHeader('Authorization', `Bearer ${OPENROUTER_API_KEY}`);
    if (REQUIRE_NO_TRAINING) {
      proxyReq.setHeader('X-Title', 'DEUK Agents');
      proxyReq.setHeader('HTTP-Referer', 'https://deuk.local');
      proxyReq.setHeader('X-Anthropic-No-Retention', 'true');
      proxyReq.setHeader('X-OpenAI-No-Training', 'true');
      proxyReq.setHeader('X-Google-No-Training', 'true');
      proxyReq.setHeader('X-DEUK-No-Training', 'true');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      try {
        const json = JSON.parse(body);
        const usage = json.usage || {};
        const model = req.body?.model;
        const cost = calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, model);
        dailySpend += cost;
        monthlySpend += cost;
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          svc: 'gateway',
          event: 'llm.call',
          model,
          tokens_in: usage.prompt_tokens,
          tokens_out: usage.completion_tokens,
          cost_usd: cost,
          daily_spend: dailySpend,
          monthly_spend: monthlySpend,
        }));
      } catch { /* ignore parse errors */ }
    });
  },
});

function calculateCost(promptTokens, completionTokens, model) {
  const rate = MODEL_COSTS[model] || { in: 0.003, out: 0.015 };
  return (promptTokens / 1000) * rate.in + (completionTokens / 1000) * rate.out;
}

app.use('/api/v1/chat/completions', proxy);

// ─── Health ───
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    allowed_models: cfg.ALLOWED_MODELS,
    daily_spend: dailySpend,
    monthly_spend: monthlySpend,
    daily_budget: cfg.DAILY_BUDGET_USD,
    monthly_budget: cfg.MONTHLY_BUDGET_USD,
    hard_budget: cfg.HARD_BUDGET_USD,
    rate_limit_rpm: RATE_LIMIT_RPM,
    scrubber_patterns: SCRUBBER_PATTERNS,
  });
});

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] Listening on http://0.0.0.0:${PORT}`);
});
