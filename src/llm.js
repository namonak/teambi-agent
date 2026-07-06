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

// 기본값 claude (기존 동작 유지). 알 수 없는 값이면 claude로 폴백.
const SELECTED = (process.env.LLM_PROVIDER || 'claude').toLowerCase();

export function getProvider() {
  const p = PROVIDERS[SELECTED] ?? claude;
  return p.configured() ? p : null;
}

// 설정 안내 문구 (자연어 비활성 시 회신에 사용)
export function setupMessage() {
  const p = PROVIDERS[SELECTED] ?? claude;
  return `🤖 자연어 명령은 서버에 ${p.setupHint} 설정(LLM_PROVIDER=${p.name}) 후 사용할 수 있어요.\n카드 승인 문자를 그대로 붙여넣으면 바로 등록됩니다.`;
}
