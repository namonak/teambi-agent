// gemini.js — 자연어 처리·분류 폴백에 쓰는 LLM.
// Gemini와 OpenRouter는 모두 OpenAI 호환 API라 같은 SDK·도구 루프를 쓴다.
//
// 도구 호출 중복과 지연을 피하려 maxRetries는 0이고, 타임아웃은 호출자가 정한 데드라인을 넘긴다.
import OpenAI from 'openai';

// .env 값에 공백·CR이 섞이는 사고가 잦다. 정리해서 쓰되 오염 사실은 notes로 알린다
// (오염된 모델명은 404 "model not found"로 나타나 원인을 짐작하기 어렵다).
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const clean = (v) => (v ?? '').trim();

const RAW_PROVIDER = process.env.LLM_PROVIDER;
const PROVIDER = clean(RAW_PROVIDER).toLowerCase() || 'gemini';
const CONFIG = {
  gemini: {
    key: 'GEMINI_API_KEY',
    model: 'GEMINI_MODEL',
    base: 'GEMINI_BASE_URL',
    effort: 'GEMINI_REASONING_EFFORT',
    defaultModel: 'gemini-3.5-flash-lite',
    defaultBase: DEFAULT_BASE_URL,
  },
  openrouter: {
    key: 'OPENROUTER_API_KEY',
    model: 'OPENROUTER_MODEL',
    base: 'OPENROUTER_BASE_URL',
    effort: 'OPENROUTER_REASONING_EFFORT',
    defaultModel: 'google/gemini-3.5-flash-lite',
    defaultBase: OPENROUTER_BASE_URL,
  },
}[PROVIDER];

const RAW_MODEL = CONFIG && process.env[CONFIG.model];
const RAW_BASE = CONFIG && process.env[CONFIG.base];
// 기본 모델 선정 근거 (실측, NAS 컨테이너에서 도구 6종 물린 단발 호출):
//   gemini-3.6-flash      라운드당 ~1,150ms
//   gemini-3.5-flash-lite 라운드당 ~732ms
// 더 강한 해석이 필요하면 GEMINI_MODEL=gemini-3.6-flash로 올릴 수 있다.
// 참고: gemini-2.5-flash는 신규 사용자에게 차단됐다("no longer available to new users")
// — 문서와 /models 목록에는 남아 있지만 실제 호출은 404로 거부된다.
const MODEL = clean(RAW_MODEL) || CONFIG?.defaultModel;
// *_BASE_URL은 프록시·테스트용 오버라이드다.
const BASE_URL = clean(RAW_BASE) || CONFIG?.defaultBase;

// thinking은 도구 호출 1라운드를 수 초~십수 초로 늘린다.
// Gemini 3 계열은 thinking을 끌 수 없으므로("Reasoning cannot be turned off for
// Gemini 2.5 Pro or 3 models") 가장 낮은 minimal로 내리는 것이 최선이다.
// 2.5 계열을 쓴다면 GEMINI_REASONING_EFFORT=none으로 완전히 끌 수 있다.
// ||를 쓰는 이유: .env에 'GEMINI_REASONING_EFFORT=' 만 남겨도(주석만 풀고 값 미입력)
// 빈 문자열이 아니라 기본값이 적용되어 설정이 조용히 사라지지 않게 한다.
const RAW_EFFORT = CONFIG && process.env[CONFIG.effort];
const REASONING_EFFORT = clean(RAW_EFFORT) || 'minimal';

let client = null;
const getClient = () =>
  (client ??= new OpenAI({ apiKey: process.env[CONFIG.key], baseURL: BASE_URL, maxRetries: 0 }));

export const name = PROVIDER;
export const configured = () => Boolean(CONFIG && clean(process.env[CONFIG.key]));
export const setupHint = CONFIG?.key ?? 'LLM_PROVIDER=gemini 또는 openrouter';

// 기동 로그·진단용 — 실제로 어디로 무엇을 호출하는지, 설정에 문제가 없는지 드러낸다
export function status() {
  const notes = [];
  if (!CONFIG) notes.push(`LLM_PROVIDER 값이 올바르지 않아요: ${clean(RAW_PROVIDER) || '(비어 있음)'}`);
  for (const [key, raw] of [
    [CONFIG?.model, RAW_MODEL],
    [CONFIG?.base, RAW_BASE],
    [CONFIG?.effort, RAW_EFFORT],
  ]) {
    if (key && raw && raw !== raw.trim()) notes.push(`${key} 값에 공백/개행이 섞여 있어요`);
  }
  if (CONFIG && BASE_URL !== CONFIG.defaultBase) notes.push(`엔드포인트가 재정의됨: ${BASE_URL}`);
  return { model: MODEL, configured: configured(), hint: setupHint, notes };
}

// 키 미설정 시 채널에 그대로 나가는 안내 문구
export function setupMessage() {
  return `🤖 자연어 명령은 서버에 ${setupHint} 설정 후 사용할 수 있어요.\n카드 승인 문자를 그대로 붙여넣으면 바로 등록됩니다.`;
}

// tools.js의 도구 정의({name, description, input_schema}) → OpenAI 함수 포맷
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

const reasoningOptions = () =>
  PROVIDER === 'openrouter'
    ? { reasoning: { effort: REASONING_EFFORT, exclude: true } }
    : { reasoning_effort: REASONING_EFFORT };

export async function call({ messages, tools, timeout }) {
  const resp = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools,
      tool_choice: 'auto',
      ...reasoningOptions(),
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
      ...reasoningOptions(),
    },
    { timeout },
  );
  return (resp.choices[0]?.message?.content ?? '').trim();
}
