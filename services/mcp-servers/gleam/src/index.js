/**
 * DEUK MCP — Gleam (stub)
 * Provides typed tools: gleam_format, gleam_check, gleam_test, gleam_build.
 */
import { z } from 'zod';

const TOOLS = {
  gleam_format: z.object({ repo: z.string() }),
  gleam_check: z.object({ repo: z.string() }),
  gleam_test: z.object({ repo: z.string(), target: z.enum(['erlang', 'javascript']).default('erlang') }),
  gleam_build: z.object({ repo: z.string(), target: z.enum(['erlang', 'javascript']).default('erlang') }),
};

console.log('[mcp-gleam] Started. Tools:', Object.keys(TOOLS).join(', '));

// Keep process alive
setInterval(() => {}, 60_000);
