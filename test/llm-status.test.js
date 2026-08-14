// llm-status.test.js — LLM_PROVIDER 해석 결과를 기동 시 진단할 수 있어야 한다.
// 배포 사고: LLM_PROVIDER에 CR이 섞여 'gemini\r'이 되자 조용히 claude로 폴백했고,
// ANTHROPIC_API_KEY가 비어 있어 "LLM API 키 미설정"만 찍혔다. 원인을 알 수 없었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// llm.js는 최상단에서 env를 읽으므로 상태마다 캐시를 우회해 새로 로드한다
async function statusWith(env, tag) {
  for (const k of ['LLM_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  const llm = await import(`../src/llm.js?case=${tag}`);
  return llm.providerStatus();
}

test('정상: LLM_PROVIDER=gemini + 키 설정', async () => {
  const s = await statusWith({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, 'ok');
  assert.equal(s.name, 'gemini');
  assert.equal(s.known, true);
  assert.equal(s.configured, true);
});

test('미설정 기본값은 claude', async () => {
  const s = await statusWith({ ANTHROPIC_API_KEY: 'k' }, 'default');
  assert.equal(s.name, 'claude');
  assert.equal(s.known, true);
});

test('CR/공백이 섞여도 인식하되, 원본이 오염됐음을 알린다', async () => {
  const s = await statusWith({ LLM_PROVIDER: 'gemini\r', GEMINI_API_KEY: 'k' }, 'cr');
  assert.equal(s.name, 'gemini', '정리 후 정상 인식되어야 한다');
  assert.equal(s.known, true);
  assert.equal(s.configured, true);
  assert.equal(s.dirty, true, '값이 오염됐다는 신호가 있어야 한다');
});

test('오타는 폴백하되 known=false로 드러낸다', async () => {
  const s = await statusWith({ LLM_PROVIDER: 'gemni', ANTHROPIC_API_KEY: 'k' }, 'typo');
  assert.equal(s.known, false, '조용히 삼키면 안 된다');
  assert.equal(s.requested, 'gemni', '사용자가 뭘 적었는지 알려야 한다');
  assert.equal(s.name, 'claude', '폴백 동작 자체는 유지');
});

test('키 미설정이면 어떤 환경변수가 필요한지 지목한다', async () => {
  const s = await statusWith({ LLM_PROVIDER: 'gemini' }, 'nokey');
  assert.equal(s.configured, false);
  assert.equal(s.hint, 'GEMINI_API_KEY');
});

test('claude 선택 시 힌트는 ANTHROPIC_API_KEY', async () => {
  const s = await statusWith({ LLM_PROVIDER: 'claude' }, 'claudenokey');
  assert.equal(s.configured, false);
  assert.equal(s.hint, 'ANTHROPIC_API_KEY');
});
