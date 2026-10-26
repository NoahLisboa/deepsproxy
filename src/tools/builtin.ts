import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registry } from './registry.ts';
import type { ToolContext } from './types.ts';
import { activePage } from '../services/playwright.ts';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = Number(process.env.TOOL_MAX_OUTPUT_CHARS || '20000');
const DEFAULT_TIMEOUT = Number(process.env.TOOL_TIMEOUT_MS || '30000');
let workspaceRoot = resolve(process.env.TOOL_WORKSPACE || process.cwd());

function bounded(value: string): string {
  if (value.length <= MAX_OUTPUT) return value;
  return `${value.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]`;
}

function safePath(input: string): string {
  const candidate = resolve(workspaceRoot, input);
  if (candidate !== workspaceRoot && !candidate.startsWith(`${workspaceRoot}/`)) {
    throw new Error(`Path must stay inside TOOL_WORKSPACE (${workspaceRoot})`);
  }
  return candidate;
}

async function run(command: string, args: string[], timeout = DEFAULT_TIMEOUT) {
  const result = await execFileAsync(command, args, { cwd: workspaceRoot, timeout, maxBuffer: MAX_OUTPUT * 2, windowsHide: true });
  return { stdout: bounded(result.stdout), stderr: bounded(result.stderr), exit_code: 0 };
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*\*/g, '§§').replace(/\*/g, '[^/\\\\]*').replace(/§§/g, '.*').replace(/\?/g, '[^/\\\\]')}$`, 'i');
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true } as any);
  return entries.filter((entry: any) => entry.isFile?.()).map((entry: any) =>
    entry.parentPath ? resolve(entry.parentPath, entry.name) : resolve(directory, entry.name));
}

async function shellTool(args: Record<string, unknown>, executable: string, fallback?: string) {
  const command = stringArg(args, 'command');
  const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : DEFAULT_TIMEOUT;
  try {
    return await run(executable, ['-NoProfile', '-NonInteractive', '-Command', command], timeout);
  } catch (error: any) {
    if (fallback && (error?.code === 'ENOENT' || /not found/i.test(error?.message || ''))) {
      return run(fallback, ['-lc', command], timeout);
    }
    throw error;
  }
}

export function registerBuiltinTools(): void {
  if (registry.has('pwrsh')) return;

  registry.register('pwrsh', 'Executa um comando PowerShell no workspace do proxy.', {
    type: 'object', properties: {
      command: { type: 'string', minLength: 1 },
      timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
    }, required: ['command'],
  }, (args) => shellTool(args, process.platform === 'win32' ? 'powershell.exe' : 'pwsh', 'sh'));

  registry.register('cmd', 'Executa um comando CMD/sh no workspace do proxy.', {
    type: 'object', properties: {
      command: { type: 'string', minLength: 1 },
      timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
    }, required: ['command'],
  }, async (args) => {
    const command = stringArg(args, 'command');
    const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : DEFAULT_TIMEOUT;
    if (process.platform === 'win32') return run('cmd.exe', ['/d', '/s', '/c', command], timeout);
    return run('sh', ['-lc', command], timeout);
  });

  registry.register('read', 'Lê um arquivo de texto dentro do workspace do proxy.', {
    type: 'object', properties: {
      path: { type: 'string', minLength: 1 },
      file_path: { type: 'string', minLength: 1 },
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1 },
    }, required: [],
  }, async (args) => {
    const fileInput = typeof args.path === 'string' ? args.path : args.file_path;
    if (typeof fileInput !== 'string' || !fileInput.trim()) throw new Error('path or file_path must be provided');
    const filePath = safePath(fileInput);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('path is not a regular file');
    const text = await readFile(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const start = typeof args.offset === 'number' ? args.offset : (typeof args.start_line === 'number' ? args.start_line - 1 : 0);
    const end = typeof args.limit === 'number' ? start + args.limit : (typeof args.end_line === 'number' ? args.end_line : lines.length);
    return bounded(lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join('\n'));
  });

  registry.register('working_directory', 'Seleciona ou informa o diretório de trabalho do projeto.', {
    type: 'object', properties: { cd: { type: 'string', minLength: 1 } }, required: ['cd'],
  }, async (args) => {
    const requested = stringArg(args, 'cd');
    const nextRoot = resolve(requested);
    const info = await stat(nextRoot);
    if (!info.isDirectory()) throw new Error(`Not a directory: ${nextRoot}`);
    workspaceRoot = nextRoot;
    return { path: workspaceRoot };
  });

  registry.register('glob', 'Encontra arquivos usando um padrão glob dentro do workspace.', {
    type: 'object', properties: { pattern: { type: 'string', minLength: 1 }, path: { type: 'string' } }, required: ['pattern'],
  }, async (args) => {
    const pattern = stringArg(args, 'pattern').replace(/\\/g, '/');
    const base = safePath(typeof args.path === 'string' && args.path.trim() ? args.path : '.');
    const files = await filesUnder(base);
    const relative = files.map((file) => file.replace(`${workspaceRoot}/`, '').replace(/\\/g, '/'));
    const matcher = wildcardRegex(pattern);
    return relative.filter((file) => matcher.test(file) || matcher.test(file.replace(/^\.\//, ''))).slice(0, 2000);
  });

  registry.register('grep', 'Procura texto ou expressão regular nos arquivos do workspace.', {
    type: 'object', properties: { pattern: { type: 'string', minLength: 1 }, path: { type: 'string' }, file_path: { type: 'string' } }, required: ['pattern'],
  }, async (args) => {
    const pattern = stringArg(args, 'pattern');
    const targetInput = typeof args.path === 'string' ? args.path : (typeof args.file_path === 'string' ? args.file_path : '.');
    const target = safePath(targetInput);
    const info = await stat(target);
    const files = info.isFile() ? [target] : await filesUnder(target);
    const matcher = new RegExp(pattern, 'i');
    const matches: string[] = [];
    for (const file of files) {
      try {
        const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
        lines.forEach((line, index) => { if (matcher.test(line)) matches.push(`${file.replace(`${workspaceRoot}/`, '')}:${index + 1}:${line}`); });
      } catch { /* ignore binary/unreadable files */ }
      if (matches.length >= 2000) break;
    }
    return bounded(matches.join('\n'));
  });

  registry.register('list_dir', 'Lista arquivos e subpastas dentro do workspace do proxy.', {
    type: 'object', properties: {
      path: { type: 'string' },
      recursive: { type: 'boolean' },
    },
  }, async (args) => {
    const directory = safePath(typeof args.path === 'string' && args.path.trim() ? args.path : '.');
    const entries = await readdir(directory, { withFileTypes: true, recursive: args.recursive === true });
    return entries.slice(0, 2000).map((entry: any) => ({
      name: entry.name,
      type: entry.isDirectory?.() ? 'directory' : 'file',
      path: entry.parentPath ? resolve(entry.parentPath, entry.name).replace(`${workspaceRoot}/`, '') : entry.name,
    }));
  });

  registry.register('write', 'Cria ou sobrescreve um arquivo de texto dentro do workspace.', {
    type: 'object', properties: {
      path: { type: 'string', minLength: 1 },
      content: { type: 'string' },
    }, required: ['path', 'content'],
  }, async (args) => {
    const filePath = safePath(stringArg(args, 'path'));
    const content = typeof args.content === 'string' ? args.content : '';
    if (content.length > MAX_OUTPUT * 10) throw new Error('content exceeds the maximum write size');
    await writeFile(filePath, content, 'utf8');
    return { path: filePath.replace(`${workspaceRoot}/`, ''), bytes: Buffer.byteLength(content) };
  });

  registry.register('delete', 'Exclui um arquivo ou pasta dentro do workspace. A chamada deve ser explícita.', {
    type: 'object', properties: {
      path: { type: 'string', minLength: 1 },
      recursive: { type: 'boolean' },
    }, required: ['path'],
  }, async (args) => {
    const target = safePath(stringArg(args, 'path'));
    if (target === workspaceRoot) throw new Error('Refusing to delete TOOL_WORKSPACE itself');
    await rm(target, { recursive: args.recursive === true, force: false });
    return { deleted: target.replace(`${workspaceRoot}/`, '') };
  });

  registry.register('web_search', 'Busca páginas públicas na internet usando DuckDuckGo HTML.', {
    type: 'object', properties: {
      query: { type: 'string', minLength: 2 },
      max_results: { type: 'integer', minimum: 1, maximum: 10 },
    }, required: ['query'],
  }, async (args) => {
    const query = encodeURIComponent(stringArg(args, 'query'));
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
    if (!response.ok) throw new Error(`search failed with HTTP ${response.status}`);
    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const re = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) && results.length < (typeof args.max_results === 'number' ? args.max_results : 5)) {
      const clean = (value: string) => value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
      results.push({ title: clean(match[2]), url: match[1], snippet: clean(match[3]) });
    }
    return results;
  });

  registry.register('browser_open', 'Abre uma URL no browser Playwright persistente do DeepSeek.', {
    type: 'object', properties: { url: { type: 'string', minLength: 8 } }, required: ['url'],
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    const url = stringArg(args, 'url');
    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    return { url: activePage.url(), title: await activePage.title() };
  });

  registry.register('browser_user', 'Lê o estado visível da página atual no browser persistente.', {
    type: 'object', properties: { max_chars: { type: 'integer', minimum: 100, maximum: MAX_OUTPUT } },
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    const text = await activePage.locator('body').innerText();
    return { url: activePage.url(), title: await activePage.title(), text: bounded(text.slice(0, typeof args.max_chars === 'number' ? args.max_chars : MAX_OUTPUT)) };
  });

  registry.register('browser_click', 'Clica em um elemento pela URL CSS ou texto acessível.', {
    type: 'object', properties: { selector: { type: 'string', minLength: 1 } }, required: ['selector'],
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    const selector = stringArg(args, 'selector');
    await activePage.locator(selector).first().click({ timeout: DEFAULT_TIMEOUT });
    return { url: activePage.url(), title: await activePage.title() };
  });

  registry.register('browser_fill', 'Preenche um campo do browser usando um seletor CSS.', {
    type: 'object', properties: {
      selector: { type: 'string', minLength: 1 },
      value: { type: 'string' },
    }, required: ['selector', 'value'],
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    await activePage.locator(stringArg(args, 'selector')).first().fill(typeof args.value === 'string' ? args.value : '');
    return { url: activePage.url() };
  });

  registry.register('browser_press', 'Pressiona uma tecla no browser, por exemplo Enter ou Escape.', {
    type: 'object', properties: { key: { type: 'string', minLength: 1 } }, required: ['key'],
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    await activePage.keyboard.press(stringArg(args, 'key'));
    return { url: activePage.url(), title: await activePage.title() };
  });

  registry.register('browser_snapshot', 'Captura um screenshot da página atual no workspace.', {
    type: 'object', properties: { path: { type: 'string' } },
  }, async (args) => {
    if (!activePage) throw new Error('Browser not initialized; run npm run login or start the server first');
    const output = safePath(typeof args.path === 'string' && args.path.trim() ? args.path : 'browser-snapshot.png');
    await activePage.screenshot({ path: output, fullPage: true });
    return { path: output.replace(`${workspaceRoot}/`, '') };
  });
}
