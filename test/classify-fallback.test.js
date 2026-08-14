// classify-fallback.test.js — 분류 LLM 폴백이 실패했을 때의 동작.
// 폴백 실패는 치명적이지 않아 3단계(기본값)로 강등되지만, 이유를 로그에 남겨야 한다.
// (429로 막힌 건지 타임아웃인지 흔적이 없으면 운영 중 원인 추적이 불가능하다)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let classify;

const server_ = http.createServer((req, res) => {
  res.writeHead(429, { 'Content-Type': 'application/json' });
  res.end('');
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  classify = await import('../src/classify.js');
});

after(() => server.close());

test('LLM 폴백이 429로 실패하면 null을 반환하고 이유를 로그에 남긴다', async () => {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    const result = await classify.classifyWithLlm('스타벅스', '09:00', 5000, ['커피', '간식']);
    assert.equal(result, null, '폴백 실패는 null로 강등되어야 한다');
  } finally {
    console.warn = original;
  }
  assert.equal(warned.length, 1, '실패 이유가 정확히 한 번 로그에 남아야 한다');
  assert.match(warned[0], /classify/, '어느 단계에서 실패했는지 식별 가능해야 한다');
  assert.match(warned[0], /429/, '어떤 실패인지(상태 코드) 확인 가능해야 한다');
});

test('통합 경로: 폴백이 죽어도 기본값 단계로 내려가 분류는 성공한다', async () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    // '스타벅스'는 키워드 규칙에 걸리므로, 규칙에 없는 가맹점으로 폴백을 강제한다
    const result = await classify.classifyCategory('한빛식자재', '09:00', 5000, ['커피', '간식']);
    assert.equal(result.source, 'default');
    assert.ok(['커피', '간식'].includes(result.name));
  } finally {
    console.warn = original;
  }
});
