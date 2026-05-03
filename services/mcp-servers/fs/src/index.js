/**
 * DEUK MCP — Filesystem server (stdio transport, JSON-RPC 2.0)
 * Tools: read_file, list_dir, write_file, delete_file, search_files, file_exists
 * All paths are sandboxed to /workspace.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';

const TOOLS = {};

function registerTool(name, description, schema, handler) {
  TOOLS[name] = { description, schema, handler };
}

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function log(msg) { console.error(`[mcp-fs] ${msg}`); }

function safePath(p) {
  const resolved = resolve(WORKSPACE, p);
  if (!resolved.startsWith(WORKSPACE)) throw new Error(`Path outside workspace: ${p}`);
  return resolved;
}

registerTool('read_file', 'Read a file from the workspace', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Relative path within workspace' },
    max_bytes: { type: 'number', description: 'Max bytes to read (default: 100000)' },
  },
  required: ['path'],
}, ({ path, max_bytes = 100_000 }) => {
  const p = safePath(path);
  const content = readFileSync(p, 'utf-8');
  const truncated = content.length > max_bytes;
  return {
    content: truncated ? content.slice(0, max_bytes) : content,
    bytes: content.length,
    truncated,
    path: relative(WORKSPACE, p),
  };
});

registerTool('list_dir', 'List directory contents', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Relative path within workspace' },
    recursive: { type: 'boolean', description: 'List recursively (default: false)' },
  },
  required: ['path'],
}, ({ path, recursive = false }) => {
  const p = safePath(path);
  function listDir(dir, depth = 0) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const result = [];
    for (const e of entries) {
      if (e.name.startsWith('.') && depth === 0) continue; // skip dotfiles at root
      const fullPath = join(dir, e.name);
      const relPath = relative(WORKSPACE, fullPath);
      const isDir = e.isDirectory();
      result.push({ name: e.name, path: relPath, type: isDir ? 'dir' : 'file' });
      if (recursive && isDir && depth < 3) {
        result.push(...listDir(fullPath, depth + 1));
      }
    }
    return result;
  }
  return { entries: listDir(p), path: relative(WORKSPACE, p) };
});

registerTool('write_file', 'Write content to a file', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Relative path within workspace' },
    content: { type: 'string', description: 'File content to write' },
  },
  required: ['path', 'content'],
}, ({ path, content }) => {
  const p = safePath(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
  return { written: true, bytes: Buffer.byteLength(content), path: relative(WORKSPACE, p) };
});

registerTool('delete_file', 'Delete a file from the workspace', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Relative path within workspace' },
  },
  required: ['path'],
}, ({ path }) => {
  const p = safePath(path);
  if (!existsSync(p)) throw new Error(`File not found: ${path}`);
  unlinkSync(p);
  return { deleted: true, path: relative(WORKSPACE, p) };
});

registerTool('file_exists', 'Check if a file or directory exists', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Relative path within workspace' },
  },
  required: ['path'],
}, ({ path }) => {
  const p = safePath(path);
  const exists = existsSync(p);
  if (!exists) return { exists: false, path };
  const stat = statSync(p);
  return { exists: true, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size, path };
});

registerTool('search_files', 'Search for text in files', {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Text or regex pattern to search for' },
    path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
    file_pattern: { type: 'string', description: 'File extension filter e.g. ".js" or ".ts"' },
    max_results: { type: 'number', description: 'Max results to return (default: 20)' },
  },
  required: ['pattern'],
}, ({ pattern, path = '.', file_pattern, max_results = 20 }) => {
  const searchDir = safePath(path);
  const regex = new RegExp(pattern, 'gi');
  const results = [];

  function searchDir_(dir) {
    if (results.length >= max_results) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (results.length >= max_results) break;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) {
        searchDir_(fullPath);
      } else {
        if (file_pattern && !e.name.endsWith(file_pattern)) continue;
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: relative(WORKSPACE, fullPath),
                line: i + 1,
                text: lines[i].trim().slice(0, 200),
              });
              if (results.length >= max_results) break;
            }
          }
        } catch { /* skip binary files */ }
      }
    }
  }

  searchDir_(searchDir);
  return { results, total: results.length, truncated: results.length >= max_results };
});

// ─── Protocol ─────────────────────────────────────────────────────────────────
function handleRequest(req) {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0', id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-fs', version: '0.3.0' },
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
