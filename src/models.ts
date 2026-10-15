export interface ModelConfig {
  id: string;
  isPro: boolean;
  supportsThinking: boolean;
  contextLength: number;
  maxOutputTokens: number;
}

/**
 * Current DeepSeek API model names as documented on 2026-10-15.
 * The web chat backend still receives a boolean thinking flag, so the
 * `-thinking` variants are proxy conveniences rather than upstream IDs.
 */
export const CURRENT_MODELS: readonly ModelConfig[] = [
  {
    id: 'deepseek-flash',
    isPro: false,
    supportsThinking: true,
    contextLength: 1_000_000,
    maxOutputTokens: 384_000,
  },
  {
    id: 'deepseek-v4-pro',
    isPro: true,
    supportsThinking: true,
    contextLength: 1_000_000,
    maxOutputTokens: 384_000,
  },
];

/** Legacy IDs accepted for backwards compatibility and routed to current models. */
export const MODEL_ALIASES: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-thinking': 'deepseek-flash-thinking',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp-thinking': 'deepseek-flash-thinking',
  'deepseek-flash-thinking': 'deepseek-flash',
  'deepseek-v4-pro-thinking': 'deepseek-v4-pro',
};

export function resolveModel(model: string): { config: ModelConfig; requestedModel: string } {
  const canonicalId = MODEL_ALIASES[model] || model;
  const config = CURRENT_MODELS.find((entry) => entry.id === canonicalId || entry.id === canonicalId.replace(/-thinking$/i, ''));
  if (!config) {
    throw new Error(`Unsupported DeepSeek model '${model}'. Use deepseek-flash or deepseek-v4-pro.`);
  }
  return { config, requestedModel: model };
}

export function isThinkingRequest(model: string, body: { thinking?: { type?: string } | null; reasoning_effort?: string }): boolean {
  const modelRequestsThinking = /-thinking$/i.test(model);
  if (body.thinking?.type) return body.thinking.type === 'enabled';
  if (body.reasoning_effort) return body.reasoning_effort !== 'none';
  return modelRequestsThinking;
}
