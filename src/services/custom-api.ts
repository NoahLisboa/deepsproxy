import type { Context } from 'hono';

export const CUSTOM_MODEL_IDS = [
  'dots-studio/dots-3-note-preview',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'poolside/laguna-s-2.1',
  'minimax/minimax-m3.1-flash',
  'reflection/beam-1.0',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'recursive/flint-v1.0',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-bolt-e4b',
  'cohere/north-mini-code',
  'stealth/glyph-cluster',
  'poolside/laguna-xs-2.1',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/muse-glimmer-30b',
  'xingchen-agi/xing4.0-29b-a4b',
  'ornith/ornith-1.5-122b',
  'liquid/lfm-2.5-2.6b',
  'deepseek/deepseek-v4-flash',
  'google/gemma-4-31b',
  'openai/gpt-oss-20b',
  'nvidia/nemotron-3.5-content-safety',
  'nvidia/riva-translate-4b-instruct-v2',
  'nvidia/nemotron-parse-2.0',
  'apple/foundation-model',
  'scira/amos-1-large',
  'nvidia/nemotron-3.5-embed-8b',
  'vllm-sr/d3-ultra',
  'scira/amos-1-small',
  'nvidia/nemotron-3.5-embed-1b',
  'nvidia/nemotron-3-embed-1b',
  'qwen/qwen3-8b',
  'scira/amos-1-mini',
  'thinkingmachines/inkling',
  'thinkingmachines/inkling-small',
  'hal-x/thx-01',
  'liquid/lfm-2.5-embedding-350m',
  'vllm-sr/d3-edge',
  'vllm-sr/d3-flash',
  'vllm-sr/d3-lite',
  'vllm-sr/d3-mini',
  'vllm-sr/d3-nano',
] as const;

export function customModelEntries() {
  return CUSTOM_MODEL_IDS.map((id) => ({
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: id.split('/')[0] || 'anyrouter',
    permission: [],
    root: id,
    parent: null,
  }));
}

function apiUrl(path: string): string {
  const base = (process.env.CUSTOM_API_BASE_URL || 'https://anyrouter.dev/api/v1').replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export async function customChatCompletions(c: Context): Promise<Response> {
  const apiKey = process.env.CUSTOM_API_KEY;
  if (!apiKey) return c.json({ error: { message: 'CUSTOM_API_KEY is not configured' } }, 500);

  const body = await c.req.text();
  const upstream = await fetch(apiUrl('chat/completions'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': c.req.header('content-type') || 'application/json',
      ...(c.req.header('x-session-id') ? { 'x-session-id': c.req.header('x-session-id')! } : {}),
    },
    body,
  });

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  for (const name of ['cache-control', 'x-request-id', 'x-anyrouter-provider']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
