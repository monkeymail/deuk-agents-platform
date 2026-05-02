/**
 * DEUK MCP — Filesystem (stub)
 * Provides typed tools: read_file, list_dir, write_file (within /workspace only).
 */
import { z } from 'zod';

const TOOLS = {
  read_file: z.object({ path: z.string() }),
  list_dir: z.object({ path: z.string() }),
  write_file: z.object({ path: z.string(), content: z.string() }),
};

console.log('[mcp-fs] Started. Tools:', Object.keys(TOOLS).join(', '));
