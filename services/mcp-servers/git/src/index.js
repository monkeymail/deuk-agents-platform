/**
 * DEUK MCP — Git server (stdio transport)
 * Provides typed tools: git_clone, git_status, git_commit, git_push.
 */
import { execSync } from 'child_process';
import { resolve } from 'path';

const TOOLS = {};

function registerTool(name, schema, handler) {
  TOOLS[name] = { schema, handler };
}

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function log(msg) {
  console.error(`[mcp-git] ${msg}`);
}

function runGit(cwd, args) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 30000 });
}

// ─── Tools ───

registerTool('git_clone', { url: 'string', dest: 'string' }, ({ url, dest }) => {
  const safeDest = resolve('/workspace', dest);
  if (!safeDest.startsWith('/workspace')) throw new Error('Path outside /workspace');
  runGit('/workspace', `clone --depth 50 "${url}" "${safeDest}"`);
  return { cloned: true, dest: safeDest };
});

registerTool('git_status', { repo: 'string' }, ({ repo }) => {
  const safeRepo = resolve('/workspace', repo);
  if (!safeRepo.startsWith('/workspace')) throw new Error('Path outside /workspace');
  const out = runGit(safeRepo, 'status --short');
  return { status: out.trim() || 'clean' };
});

registerTool('git_commit', { repo: 'string', message: 'string' }, ({ repo, message }) => {
  const safeRepo = resolve('/workspace', repo);
  if (!safeRepo.startsWith('/workspace')) throw new Error('Path outside /workspace');
  runGit(safeRepo, `add -A`);
  runGit(safeRepo, `commit -m "${message.replace(/"/g, '\\"')}"`);
  return { committed: true };
});

registerTool('git_push', { repo: 'string', branch: 'string' }, ({ repo, branch }) => {
  const safeRepo = resolve('/workspace', repo);
  if (!safeRepo.startsWith('/workspace')) throw new Error('Path outside /workspace');
  runGit(safeRepo, `push origin ${branch}`);
  return { pushed: true, branch };
});

// ─── Protocol ───

function handleRequest(req) {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-git', version: '0.1.0' },
      },
    };
  }
  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: Object.entries(TOOLS).map(([name, { schema }]) => ({
          name,
          description: `Tool: ${name}`,
          inputSchema: { type: 'object', properties: schema },
        })),
      },
    };
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    const tool = TOOLS[name];
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const result = tool.handler(args);
    return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
  }
  return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } };
}

// ─── Stdio transport ───

let buffer = '';
let contentLength = null;

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  while (true) {
    if (contentLength === null) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx === -1) break;
      const header = buffer.slice(0, idx);
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) { buffer = buffer.slice(idx + 4); continue; }
      contentLength = parseInt(match[1], 10);
      buffer = buffer.slice(idx + 4);
    }
    if (buffer.length < contentLength) break;
    const json = buffer.slice(0, contentLength);
    buffer = buffer.slice(contentLength);
    contentLength = null;
    try {
      const req = JSON.parse(json);
      const res = handleRequest(req);
      if (res) send(res);
    } catch (err) {
      log(`Error: ${err.message}`);
    }
  }
});

log('Started. Tools: ' + Object.keys(TOOLS).join(', '));

// Keep alive when no stdin is attached
process.stdin.on('end', () => {});
setInterval(() => {}, 60_000);
