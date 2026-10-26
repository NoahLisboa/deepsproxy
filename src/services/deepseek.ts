/*
 * File: deepseek.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { getDeepSeekHeaders } from './playwright.ts';

// In-memory state to track the last message ID per session to avoid overwriting
// Use globalThis to ensure it survives module reloads in some test environments
const sessionStates: Record<string, number | null> = (globalThis as any)._sessionStates || {};
(globalThis as any)._sessionStates = sessionStates;
let sharedWebSession: { id: string; parentId: number | null } | null = null;

export function resetDeepSeekSession() {
  sharedWebSession = null;
}

export function updateSessionParent(sessionId: string, parentId: number | null) {
  if (sessionId) {
    sessionStates[sessionId] = parentId;
    if (sharedWebSession?.id === sessionId) sharedWebSession.parentId = parentId;
  }
}

export interface DeepSeekPayload {
  chat_session_id?: string;
  parent_message_id?: number | null;
  model_type: string | null;
  prompt: string;
  ref_file_ids: string[];
  thinking_enabled: boolean;
  search_enabled: boolean;
  preempt: boolean;
}

export async function createDeepSeekStream(
  prompt: string,
  enableThinking: boolean,
  isProModel: boolean = false,
  forcedParentId?: number | null
): Promise<{ stream: ReadableStream, headers: Record<string, string>, uiSessionId: string }> {
  // Obtain fresh headers/PoW, but keep one Chat Web session for the lifetime of
  // this proxy. A null parent is reserved for an explicit new-session call.
  const startNewSession = forcedParentId === null || sharedWebSession === null;
  const { headers, chatSessionId, parentMessageId } = await getDeepSeekHeaders(startNewSession);

  if (startNewSession || !sharedWebSession) {
    sharedWebSession = {
      id: chatSessionId,
      parentId: parentMessageId,
    };
    sessionStates[chatSessionId] = parentMessageId;
  }

  // Determine the actual parent ID:
  // 1. If forcedParentId is provided (even if null), use it.
  // 2. If tracked parent ID is available for this session, use it.
  // 3. Fallback to Playwright's state.
  let actualParentId: number | null = parentMessageId;
  
  if (forcedParentId !== undefined) {
    actualParentId = forcedParentId;
  } else if (sharedWebSession) {
    actualParentId = sharedWebSession.parentId;
  }

  const payload: DeepSeekPayload = {
    chat_session_id: sharedWebSession?.id || chatSessionId || undefined,
    parent_message_id: actualParentId,
    model_type: isProModel ? 'expert' : null,
    prompt: prompt,
    ref_file_ids: [],
    thinking_enabled: enableThinking,
    search_enabled: true,
    preempt: false
  };

  const response = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'authorization': headers['authorization'],
      'content-type': 'application/json',
      'origin': 'https://chat.deepseek.com',
      'x-ds-pow-response': headers['x-ds-pow-response'],
      'x-hif-dliq': headers['x-hif-dliq'],
      'x-hif-leim': headers['x-hif-leim'],
      'x-app-version': '2.0.0',
      'x-client-locale': 'pt_BR',
      'x-client-platform': 'web',
      'x-client-version': '2.0.0'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to fetch from DeepSeek: ${response.status} ${response.statusText} - ${errText}`);
  }

  return { stream: response.body, headers, uiSessionId: sharedWebSession?.id || chatSessionId };
}
