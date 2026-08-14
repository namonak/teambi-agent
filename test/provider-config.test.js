// provider-config.test.js — Gemini 설정을 기동 시 확인할 수 있어야 한다.
// 배포 사고: 404가 났는데 어떤 모델·엔드포인트로 호출했는지 로그에 없어
// 컨테이너에 직접 들어가 확인해야 했다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function geminiConfig(env, tag) {
  for (const k of ['GEMINI_MODEL', 'GEMINI_BASE_URL', 'GEMINI_REASONING_EFFORT']) delete process.env[k];
  Object.assign(process.env, env);
  const m = await import(`../src/gemini.js?case=${tag}`);
  return m.status();
}

test('기본 설정: 모델 이름을 그대로 보고한다', async () => {
  const c = await geminiConfig({}, 'default');
  assert.equal(c.model, 'gemini-3.6-flash');
  assert.deepEqual(c.notes, [], '기본 상태에서는 경고가 없어야 한다');
});

test('모델 이름의 공백·CR을 정리하고 오염 사실을 알린다', async () => {
  const c = await geminiConfig({ GEMINI_MODEL: 'gemini-3.6-flash\r' }, 'dirtymodel');
  assert.equal(c.model, 'gemini-3.6-flash', '정리 후 정상 인식되어야 한다');
  assert.ok(
    c.notes.some((n) => n.includes('GEMINI_MODEL')),
    '오염을 조용히 고치면 안 된다',
  );
});

test('엔드포인트를 재정의하면 기동 로그로 드러낸다', async () => {
  const c = await geminiConfig({ GEMINI_BASE_URL: 'http://proxy.local/v1/' }, 'baseurl');
  assert.ok(c.notes.some((n) => n.includes('proxy.local')), '어디로 나가는지 보여야 한다');
});

test('공백만 있는 값은 기본값으로 되돌린다', async () => {
  const c = await geminiConfig({ GEMINI_MODEL: '   ' }, 'blank');
  assert.equal(c.model, 'gemini-3.6-flash');
});


