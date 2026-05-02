/**
 * DEUK LLM Gateway — Minimal bootstrap version
 * Proxies to OpenRouter with: model allowlist, budget tracking, no-training headers.
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Config ───
const PORT = process.env.GATEWAY_PORT || 7100;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ALLOWED_MODELS = (process.env.ALLOWED_MODELS || 'openai/gpt-4o-mini').split(',');
const REQUIRE_NO_TRAINING = process.env.REQUIRE_NO_TRAINING_HEADERS === 'true';
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM || '60', 10);

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

// ─── Middleware: validate model ───
app.use('/api/v1/chat/completions', (req, res, next) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ error: 'Missing model field' });
  if (!ALLOWED_MODELS.includes(model)) {
    return res.status(403).json({ error: 'Model not in allowlist', model });
  }
  if (!checkRateLimit()) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
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
      // Provider-specific opt-out headers (non-optional)
      proxyReq.setHeader('X-Anthropic-No-Retention', 'true');
      proxyReq.setHeader('X-OpenAI-No-Training', 'true');
      proxyReq.setHeader('X-Google-No-Training', 'true');
      proxyReq.setHeader('X-DEUK-No-Training', 'true');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Log usage for budget tracking
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      try {
        const json = JSON.parse(body);
        const usage = json.usage || {};
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          svc: 'gateway',
          event: 'llm.call',
          model: req.body?.model,
          tokens_in: usage.prompt_tokens,
          tokens_out: usage.completion_tokens,
        }));
      } catch { /* ignore parse errors */ }
    });
  },
});

app.use('/api/v1/chat/completions', proxy);

// ─── Health ───
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gateway', allowed_models: ALLOWED_MODELS });
});

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] Listening on http://0.0.0.0:${PORT}`);
});
