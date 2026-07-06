// providers/gemini.js — Gemini 프로바이더 (OpenAI 호환 엔드포인트 경유).
// Gemini는 Anthropic 호환이 아니므로 OpenAI SDK로 호출하고, 포맷을 공통 인터페이스에 맞춘다.
// 무료 티어 주의: 입출력이 Google 제품 개선(학습)에 사용될 수 있음(.env 안내 참조).
import OpenAI from 'openai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// GEMINI_BASE_URL은 프록시·테스트용 오버라이드 (기본: Google 공식 OpenAI 호환 엔드포인트)
const BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';

let client = null;
const getClient = () =>
  (client ??= new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: BASE_URL, maxRetries: 0 }));

export const name = 'gemini';
export const configured = () => Boolean(process.env.GEMINI_API_KEY);
export const setupHint = 'GEMINI_API_KEY';

// Anthropic 도구 정의({name, description, input_schema}) → OpenAI 함수 포맷
export const toTools = (tools) =>
  tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

// OpenAI 포맷은 시스템 프롬프트도 messages에 넣는다
export const initMessages = (system, userText) => [
  { role: 'system', content: system },
  { role: 'user', content: userText },
];

export async function call({ messages, tools, timeout }) {
  const resp = await getClient().chat.completions.create(
    { model: MODEL, max_tokens: 1024, messages, tools, tool_choice: 'auto' },
    { timeout },
  );
  const choice = resp.choices[0];
  const msg = choice.message;
  const toolCalls = (msg.tool_calls ?? []).map((tc) => {
    let input = {};
    try {
      input = JSON.parse(tc.function.arguments || '{}');
    } catch {
      input = {};
    }
    return { id: tc.id, name: tc.function.name, input };
  });
  return {
    text: (msg.content ?? '').trim(),
    toolCalls,
    isToolUse: toolCalls.length > 0,
    assistant: msg,
  };
}

export function appendAssistant(messages, assistant) {
  // OpenAI는 tool_calls가 담긴 assistant 메시지를 그대로 되돌려줘야 한다
  messages.push(assistant);
}

export function appendToolResults(messages, results) {
  // OpenAI는 도구 결과를 tool_call_id별 개별 메시지로 (병렬이면 여러 개)
  for (const r of results) {
    messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
}

// 분류 폴백용 단발 호출 — 텍스트만 반환
export async function simpleText({ system, user, maxTokens, timeout }) {
  const resp = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    { timeout },
  );
  return (resp.choices[0]?.message?.content ?? '').trim();
}
