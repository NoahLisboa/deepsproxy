import type { Context } from 'hono';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part: any) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return part.text || '';
    if (part?.type === 'thinking') return `<think>\n${part.thinking || ''}\n</think>`;
    return part?.text || JSON.stringify(part);
  }).join('\n');
}

function toOpenAI(body: any): any {
  const messages: any[] = [];
  if (body.system) {
    messages.push({ role: 'system', content: contentToText(body.system) });
  }
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (message.role === 'tool' || message.role === 'function') {
      messages.push({ role: 'tool', content: contentToText(message.content), tool_call_id: message.tool_call_id, name: message.name });
      continue;
    }
    messages.push({ role: message.role, content: contentToText(message.content) });
  }

  const result: any = {
    model: body.model || 'deepseek-v4-pro',
    messages,
    stream: Boolean(body.stream),
  };
  for (const key of ['max_tokens', 'temperature', 'top_p', 'stop', 'response_format']) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  if (body.thinking?.type) result.thinking = body.thinking;
  if (body.tools) {
    result.tools = body.tools.map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name || tool.function?.name,
        description: tool.description || tool.function?.description || '',
        parameters: tool.input_schema || tool.function?.parameters || { type: 'object', properties: {} },
      },
    }));
  }
  if (body.tool_choice) result.tool_choice = body.tool_choice;
  return result;
}

function anthropicJson(openai: any, requestedModel: string): any {
  const choice = openai?.choices?.[0] || {};
  const message = choice.message || {};
  const content: any[] = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  if (message.reasoning_content) content.unshift({ type: 'thinking', thinking: message.reasoning_content });
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      let input: any = {};
      try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = { raw_arguments: call.function?.arguments || '' }; }
      content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
    }
  }
  const usage = openai?.usage || {};
  return {
    id: openai?.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 },
  };
}

async function streamAsAnthropic(response: Response): Promise<Response> {
  const reader = response.body?.getReader();
  if (!reader) return response;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let messageId = `msg_${Date.now()}`;
      write('message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', content: [], model: 'deepseek', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
      write('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
            try {
              const chunk = JSON.parse(line.slice(6));
              const delta = chunk.choices?.[0]?.delta || {};
              if (delta.content) write('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } });
              const finish = chunk.choices?.[0]?.finish_reason;
              if (finish) write('message_delta', { type: 'message_delta', delta: { stop_reason: finish === 'tool_calls' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: chunk.usage?.completion_tokens || 0 } });
            } catch { /* Ignore incomplete upstream chunks. */ }
          }
        }
        write('content_block_stop', { type: 'content_block_stop', index: 0 });
        write('message_stop', { type: 'message_stop' });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { status: response.status, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}

export async function messages(c: Context, completionHandler: (context: Context) => Promise<Response>): Promise<Response> {
  const body = await c.req.json();
  const headers = new Headers();
  const authorization = c.req.header('Authorization');
  const apiKey = c.req.header('X-API-Key');
  if (authorization) headers.set('Authorization', authorization);
  if (apiKey) headers.set('X-API-Key', apiKey);
  headers.set('Content-Type', 'application/json');
  const request = new Request(new URL('/v1/chat/completions', c.req.url), {
    method: 'POST',
    headers,
    body: JSON.stringify(toOpenAI(body)),
  });
  const internalContext = new Proxy(c, {
    get(target, property, receiver) {
      if (property === 'req') return { ...target.req, raw: request, json: async () => toOpenAI(body) };
      return Reflect.get(target, property, receiver);
    },
  }) as Context;
  const response = await completionHandler(internalContext);
  if (body.stream) return streamAsAnthropic(response);
  if (!response.ok) return response;
  return new Response(JSON.stringify(anthropicJson(await response.json(), body.model || 'deepseek-v4-pro')), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
