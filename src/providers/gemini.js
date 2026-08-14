// providers/gemini.js — Gemini 프로바이더 (OpenAI 호환 엔드포인트 경유).
// Gemini는 Anthropic 호환이 아니므로 OpenAI SDK로 호출하고, 포맷을 공통 인터페이스에 맞춘다.
// 무료 티어 주의: 입출력이 Google 제품 개선(학습)에 사용될 수 있음(.env 안내 참조).
import OpenAI from 'openai';

// .env 값에 공백·CR이 섞이는 사고가 잦다. 정리해서 쓰되 오염 사실은 notes로 알린다
// (오염된 모델명은 404 "model not found"로 나타나 원인을 짐작하기 어렵다).
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const clean = (v) => (v ?? '').trim();

const RAW_MODEL = process.env.GEMINI_MODEL;
const RAW_BASE = process.env.GEMINI_BASE_URL;
const MODEL = clean(RAW_MODEL) || 'gemini-2.5-flash';
// GEMINI_BASE_URL은 프록시·테스트용 오버라이드 (기본: Google 공식 OpenAI 호환 엔드포인트)
const BASE_URL = clean(RAW_BASE) || DEFAULT_BASE_URL;

// gemini-2.5-flash는 thinking이 기본 On이라 도구 호출 1라운드가 수 초~십수 초 걸린다.
// Teams 동기 예산(4.2s)으로는 매번 타임아웃하므로 OpenAI 호환 레이어의 reasoning_effort로 끈다.
// 2.5 Pro/3 계열은 'none'이 거부되므로 GEMINI_REASONING_EFFORT=low|medium|high로 재정의한다.
// ||를 쓰는 이유: .env에 'GEMINI_REASONING_EFFORT=' 만 남겨도(주석만 풀고 값 미입력)
// 빈 문자열이 아니라 기본값이 적용되어 thinking이 조용히 되살아나지 않게 한다.
const RAW_EFFORT = process.env.GEMINI_REASONING_EFFORT;
const REASONING_EFFORT = clean(RAW_EFFORT) || 'none';

let client = null;
const getClient = () =>
  (client ??= new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: BASE_URL, maxRetries: 0 }));

export const name = 'gemini';
export const configured = () => Boolean(clean(process.env.GEMINI_API_KEY));
export const setupHint = 'GEMINI_API_KEY';

// 기동 로그용 — 실제로 어디로 무엇을 호출하는지 드러낸다
export function config() {
  const notes = [];
  for (const [key, raw] of [
    ['GEMINI_MODEL', RAW_MODEL],
    ['GEMINI_BASE_URL', RAW_BASE],
    ['GEMINI_REASONING_EFFORT', RAW_EFFORT],
  ]) {
    if (raw && raw !== raw.trim()) notes.push(`${key} 값에 공백/개행이 섞여 있어요`);
  }
  if (BASE_URL !== DEFAULT_BASE_URL) notes.push(`엔드포인트가 재정의됨: ${BASE_URL}`);
  return { model: MODEL, notes };
}

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
    {
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools,
      tool_choice: 'auto',
      reasoning_effort: REASONING_EFFORT,
    },
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
      reasoning_effort: REASONING_EFFORT,
    },
    { timeout },
  );
  return (resp.choices[0]?.message?.content ?? '').trim();
}
