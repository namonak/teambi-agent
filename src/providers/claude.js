// providers/claude.js — Anthropic(Claude) 프로바이더.
// 공통 인터페이스(llm.js 참조)를 Anthropic Messages API로 구현한다.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

let client = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 0 })); // 타임아웃은 호출별 지정

export const name = 'claude';
export const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const setupHint = 'ANTHROPIC_API_KEY';

// 도구 정의는 이미 Anthropic 포맷({name, description, input_schema}) — 변환 불필요
export const toTools = (tools) => tools;

// 시스템 프롬프트는 별도 파라미터로 전달하므로 messages에는 user만
export const initMessages = (_system, userText) => [{ role: 'user', content: userText }];

export async function call({ system, messages, tools, timeout }) {
  const resp = await getClient().messages.create(
    { model: MODEL, max_tokens: 1024, system, tools, messages },
    { timeout },
  );
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const toolCalls = resp.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { text, toolCalls, isToolUse: resp.stop_reason === 'tool_use', assistant: resp.content };
}

export function appendAssistant(messages, assistant) {
  messages.push({ role: 'assistant', content: assistant });
}

export function appendToolResults(messages, results) {
  // 모든 tool_result를 하나의 user 메시지로 (병렬 도구 규칙)
  messages.push({
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.content,
      is_error: r.is_error,
    })),
  });
}

// 분류 폴백용 단발 호출 — 텍스트만 반환
export async function simpleText({ system, user, maxTokens, timeout }) {
  const resp = await getClient().messages.create(
    { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
    { timeout },
  );
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
