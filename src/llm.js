// llm.js — LLM 프로바이더 선택기.
// .env의 LLM_PROVIDER(claude|gemini)로 전환. 각 프로바이더는 동일 인터페이스를 구현한다:
//   name, configured(), setupHint, toTools(tools), initMessages(system, userText),
//   call({system, messages, tools, timeout}) -> {text, toolCalls:[{id,name,input}], isToolUse, assistant},
//   appendAssistant(messages, assistant), appendToolResults(messages, results),
//   simpleText({system, user, maxTokens, timeout}) -> string
// Teams 5초 예산 때문에 두 프로바이더 모두 maxRetries: 0, 타임아웃은 호출별로 지정.
import * as claude from './providers/claude.js';
import * as gemini from './providers/gemini.js';

const PROVIDERS = { claude, gemini };

// .env 값에 공백·CR(\r)이 섞이는 사고가 잦다. 정리해서 인식하되, 정리로 값이
// 달라졌으면 dirty로 알린다 — 조용히 고치면 같은 실수를 반복하게 된다.
const REQUESTED = process.env.LLM_PROVIDER ?? '';
const NORMALIZED = REQUESTED.trim().toLowerCase();
const SELECTED = NORMALIZED || 'claude'; // 기본값 claude (기존 동작 유지)

const resolve = () => PROVIDERS[SELECTED] ?? claude; // 알 수 없는 값이면 claude로 폴백

export function getProvider() {
  const p = resolve();
  return p.configured() ? p : null;
}

// 기동 로그·진단용. 무엇이 왜 선택됐는지 그대로 드러낸다.
export function providerStatus() {
  const p = resolve();
  return {
    requested: REQUESTED, // .env에 적힌 원본
    name: p.name, // 실제로 선택된 프로바이더
    known: NORMALIZED === '' || NORMALIZED in PROVIDERS, // 오타/오염 여부
    dirty: REQUESTED !== NORMALIZED && REQUESTED !== '', // 공백·CR 혼입 여부
    configured: p.configured(), // 해당 키가 채워져 있는지
    hint: p.setupHint, // 필요한 환경변수 이름
  };
}

// 설정 안내 문구 (자연어 비활성 시 회신에 사용)
export function setupMessage() {
  const p = resolve();
  return `🤖 자연어 명령은 서버에 ${p.setupHint} 설정(LLM_PROVIDER=${p.name}) 후 사용할 수 있어요.\n카드 승인 문자를 그대로 붙여넣으면 바로 등록됩니다.`;
}
