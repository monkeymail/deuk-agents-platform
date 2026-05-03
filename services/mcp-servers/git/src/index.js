/**
 * DEUK MCP — Git server (stdio transport, JSON-RPC 2.0)
 * Tools: git_clone, git_status, git_diff, git_log, git_branch,
 *        git_checkout, git_commit, git_push, git_add
 * All operations sandboxed to /workspace.
 */
import { execSync } from 'child_process';
import { resolve, relative } from 'path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';

const TOOLS = {};

function registerTool(name, description, schema, handler) {
  TOOLS[name] = { description, schema, handler };
}

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function log(msg) { console.error(`[mcp-git] ${msg}`); }

function safePath(p) {
  const resolved = resolve(WORKSPACE, p || '.');
  if (!resolved.startsWith(WORKSPACE)) throw new Error(`Path outside workspace: ${p}`);
  return resolved;
}

function git(args, cwd = WORKSPACE) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 60000 }).trim();
}

registerTool('git_clone', 'Clone a git repository into the workspace', {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'Repository URL to clone' },
    dest: { type: 'string', description: 'Destination path (default: workspace root)' },
    depth: { type: 'number', description: 'Clone depth (default: 50)' },
  },
  required: ['url'],
}, ({ url, dest = '.', depth = 50 }) => {
  const safeDest = safePath(dest);
  git(`clone --depth ${depth} "${url}" "${safeDest}"`);
  git('config user.email "agent@deuk.local"', safeDest);
  git('config user.name "DEUK Agent"', safeDest);
  return { cloned: true, dest: relative(WORKSPACE, safeDest) };
});

registerTool('git_status', 'Get git status of the workspace', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
  },
}, ({ repo = '.' }) => {
  const cwd = safePath(repo);
  const status = git('status --short', cwd);
  const branch = git('branch --show-current', cwd);
  return { status: status || 'clean', branch, has_changes: status.length > 0 };
});

registerTool('git_diff', 'Show git diff', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    staged: { type: 'boolean', description: 'Show staged diff (default: false)' },
    file: { type: 'string', description: 'Specific file to diff' },
    max_lines: { type: 'number', description: 'Max lines to return (default: 200)' },
  },
}, ({ repo = '.', staged = false, file, max_lines = 200 }) => {
  const cwd = safePath(repo);
  const args = staged ? 'diff --cached' : 'diff';
  const target = file ? ` -- "${file}"` : '';
  const diff = git(`${args}${target}`, cwd);
  const lines = diff.split('\n');
  const truncated = lines.length > max_lines;
  return {
    diff: lines.slice(0, max_lines).join('\n'),
    lines: lines.length,
    truncated,
  };
});

registerTool('git_log', 'Show git commit log', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    n: { type: 'number', description: 'Number of commits (default: 10)' },
  },
}, ({ repo = '.', n = 10 }) => {
  const cwd = safePath(repo);
  const log = git(`log --oneline -${n}`, cwd);
  return { log, commits: log.split('\n').filter(Boolean) };
});

registerTool('git_branch', 'List or create branches', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    create: { type: 'string', description: 'Branch name to create' },
  },
}, ({ repo = '.', create }) => {
  const cwd = safePath(repo);
  if (create) {
    git(`checkout -b ${create}`, cwd);
    return { created: true, branch: create };
  }
  const branches = git('branch -a', cwd);
  const current = git('branch --show-current', cwd);
  return { branches: branches.split('\n').map(b => b.trim()).filter(Boolean), current };
});

registerTool('git_checkout', 'Checkout a branch or file', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    ref: { type: 'string', description: 'Branch name, tag, or commit hash' },
    create: { type: 'boolean', description: 'Create branch if it does not exist' },
  },
  required: ['ref'],
}, ({ repo = '.', ref, create = false }) => {
  const cwd = safePath(repo);
  const flag = create ? '-b ' : '';
  git(`checkout ${flag}${ref}`, cwd);
  return { checked_out: ref };
});

registerTool('git_add', 'Stage files for commit', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    files: { type: 'string', description: 'Files to stage (default: all changed files)' },
  },
}, ({ repo = '.', files = '-A' }) => {
  const cwd = safePath(repo);
  git(`add ${files}`, cwd);
  const status = git('status --short', cwd);
  return { staged: true, status };
});

registerTool('git_commit', 'Commit staged changes', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    message: { type: 'string', description: 'Commit message' },
    add_all: { type: 'boolean', description: 'Stage all changes before committing (default: true)' },
  },
  required: ['message'],
}, ({ repo = '.', message, add_all = true }) => {
  const cwd = safePath(repo);
  if (add_all) git('add -A', cwd);
  const safeMsg = message.replace(/"/g, '\\"');
  git(`commit -m "${safeMsg}"`, cwd);
  const hash = git('rev-parse --short HEAD', cwd);
  return { committed: true, hash, message };
});

registerTool('git_push', 'Push branch to remote', {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repo path (default: workspace root)' },
    branch: { type: 'string', description: 'Branch to push (default: current branch)' },
    remote: { type: 'string', description: 'Remote name (default: origin)' },
  },
}, ({ repo = '.', branch, remote = 'origin' }) => {
  const cwd = safePath(repo);
  const b = branch || git('branch --show-current', cwd);
  git(`push -u ${remote} ${b}`, cwd);
  return { pushed: true, branch: b, remote };
});

// ─── Protocol ─────────────────────────────────────────────────────────────────
function handleRequest(req) {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0', id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-git', version: '0.3.0' },
      },
    };
  }
  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0', id: req.id,
      result: {
        tools: Object.entries(TOOLS).map(([name, { description, schema }]) => ({
          name, description,
          inputSchema: { ...schema, additionalProperties: false },
        })),
      },
    };
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    const tool = TOOLS[name];
    if (!tool) {
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    }
    try {
      const result = tool.handler(args || {});
      return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    } catch (err) {
      return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } };
    }
  }
  return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } };
}

// ─── Stdio transport ──────────────────────────────────────────────────────────
let buffer = '';
let contentLength = null;

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  while (true) {
    if (contentLength === null) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx === -1) break;
      const match = buffer.slice(0, idx).match(/Content-Length: (\d+)/i);
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
    } catch (err) { log(`Error: ${err.message}`); }
  }
});

process.stdin.on('end', () => {});
setInterval(() => {}, 60_000);
log(`Started. Workspace: ${WORKSPACE}. Tools: ${Object.keys(TOOLS).join(', ')}`);
