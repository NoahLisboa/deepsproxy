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
import { initPlaywright } from './services/playwright.ts';
import { getContextLength } from './services/telemetry.ts';
import { CURRENT_MODELS } from './models.ts';
import { registerBuiltinTools } from './tools/builtin.ts';
import { registry } from './tools/registry.ts';
import { executeToolCalls } from './tools/executor.ts';

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

// Basic health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// OpenAI compatible routes
app.post('/v1/chat/completions', chatCompletions);

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
  return c.json({
    object: 'list',
    data: CURRENT_MODELS.map((model) => modelEntry(model.id))
  });
});

// Initialize playwright when server starts
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initPlaywright().then(() => {
    console.log('Playwright initialized.');
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
