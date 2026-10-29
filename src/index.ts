/*
 * File: index.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chatCompletions } from './routes/chat.ts';
import * as dotenv from 'dotenv';
import { initPlaywright, importStorageState } from './services/playwright.ts';
import { getContextLength } from './services/telemetry.ts';
import { CURRENT_MODELS } from './models.ts';
import { registerBuiltinTools } from './tools/builtin.ts';
import { registry } from './tools/registry.ts';
import { executeToolCalls } from './tools/executor.ts';
import { customChatCompletions, customModelEntries } from './services/custom-api.ts';

dotenv.config();
registerBuiltinTools();

export const app = new Hono();

function modelEntry(id: string) {
  const model = CURRENT_MODELS.find((entry) => entry.id === id);
  const dynamicLimit = model ? Math.max(getContextLength(id), model.contextLength) : getContextLength(id);
  return {
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'deepseek',
    permission: [],
    root: id,
    parent: null,
    context_length: dynamicLimit,
    max_context_tokens: dynamicLimit,
    max_input_tokens: dynamicLimit,
    max_output_tokens: model?.maxOutputTokens ?? 384_000,
  };
}

app.use('*', cors());

app.use('*', async (c, next) => {
  if (c.req.path === '/login' || c.req.path === '/login/import') return next();
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const authHeader = c.req.header('Authorization');
    const xApiKey = c.req.header('X-API-Key');
    const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey;
    if (!providedKey || providedKey !== apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  await next();
});

function loginTokenValid(c: any): boolean {
  const expected = process.env.LOGIN_SETUP_TOKEN;
  const supplied = c.req.query('token') || c.req.header('X-Login-Token');
  return Boolean(expected && supplied && supplied === expected);
}

app.get('/login', (c) => {
  if (!loginTokenValid(c)) return c.text('Login link inválido ou não configurado.', 401);
  const token = encodeURIComponent(c.req.query('token') || '');
  return c.html(`<!doctype html><meta charset="utf-8"><title>DeepProxy Login</title>
  <style>body{font-family:system-ui;max-width:650px;margin:40px auto;padding:0 20px}input,button{font-size:16px;margin-top:12px}button{padding:10px 16px}</style>
  <h1>Vincular sessão do DeepSeek</h1>
  <p>Envie um arquivo <code>storage-state.json</code> exportado de um navegador em que o DeepSeek esteja logado.</p>
  <form method="post" action="/login/import?token=${token}" enctype="multipart/form-data">
    <input name="state" type="file" accept="application/json,.json" required><br>
    <button>Importar sessão</button>
  </form>`);
});

app.post('/login/import', async (c) => {
  if (!loginTokenValid(c)) return c.json({ error: 'Invalid login token' }, 401);
  try {
    const form = await c.req.formData();
    const file = form.get('state');
    if (!(file instanceof File)) return c.json({ error: 'state JSON file is required' }, 400);
    if (file.size > 2_000_000) return c.json({ error: 'state file is too large' }, 413);
    await importStorageState(JSON.parse(await file.text()));
    return c.html('<h1>Sessão importada</h1><p>Agora teste o proxy. Você pode fechar esta página.</p>');
  } catch (error: any) {
    return c.json({ error: error?.message || String(error) }, 400);
  }
});

// Basic health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// OpenAI compatible routes
app.post('/v1/chat/completions', (c) =>
  process.env.PROXY_BACKEND === 'custom' ? customChatCompletions(c) : chatCompletions(c)
);

// Direct tool execution endpoint for clients that want to run the registered
// tools locally instead of handling OpenAI tool_calls themselves.
app.get('/v1/tools', (c) => c.json({ object: 'list', data: registry.toOpenAITools() }));
app.post('/v1/tools/execute', async (c) => {
  try {
    const body = await c.req.json();
    if (!Array.isArray(body.tool_calls)) return c.json({ error: { message: 'tool_calls must be an array' } }, 400);
    const results = await executeToolCalls(body.tool_calls, {
      messages: body.messages || [],
      turn: 0,
      model: body.model || 'deepseek-flash',
    });
    return c.json({ object: 'tool.result.list', data: results });
  } catch (error: any) {
    return c.json({ error: { message: error?.message || String(error) } }, 400);
  }
});

app.get('/v1/models', (c) => {
  if (process.env.PROXY_BACKEND === 'custom') {
    return c.json({ object: 'list', data: customModelEntries() });
  }
  return c.json({
    object: 'list',
    data: CURRENT_MODELS.map((model) => modelEntry(model.id))
  });
});

// Initialize playwright when server starts
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const backend = process.env.PROXY_BACKEND === 'custom' ? 'custom' : 'deepseek';
  console.log(`Backend selecionado: ${backend}`);
  console.log('Opções: PROXY_BACKEND=deepseek | PROXY_BACKEND=custom');
  (backend === 'custom' ? Promise.resolve() : initPlaywright()).then(() => {
    if (backend !== 'custom') console.log('Playwright initialized.');
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    console.log(`Server is running on port ${port}`);

    serve({
      fetch: app.fetch,
      port
    });
  }).catch((err: any) => {
    console.error('Failed to initialize playwright:', err);
    process.exit(1);
  });
}
