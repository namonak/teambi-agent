// gemini-reasoning-env.test.js — GEMINI_REASONING_EFFORT의 각 설정 상태에서
// 실제로 나가는 요청 본문을 확인한다.
// 핵심: .env에 'GEMINI_REASONING_EFFORT=' 만 남기는 실수(주석만 풀고 값 미입력)로
// 설정이 조용히 사라져 Teams 예산을 넘기는 회귀를 막는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const received = [];
let server;

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    );
  });
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
});

after(() => server.close());

// 모듈이 최상단에서 env를 읽으므로, 상태마다 쿼리로 캐시를 우회해 새로 로드한다
async function bodySentWith(envValue, tag) {
  if (envValue === undefined) delete process.env.GEMINI_REASONING_EFFORT;
  else process.env.GEMINI_REASONING_EFFORT = envValue;
  const gemini = await import(`../src/providers/gemini.js?case=${tag}`);
  received.length = 0;
  await gemini.call({ messages: [{ role: 'user', content: 'x' }], tools: [], timeout: 5000 });
  return received[0];
}

test('미설정이면 thinking을 최소로 낮춰 호출한다', async () => {
  const body = await bodySentWith(undefined, 'unset');
  assert.equal(body.reasoning_effort, 'minimal');
});

test('빈 값이어도 기본값이 적용된다', async () => {
  const body = await bodySentWith('', 'empty');
  assert.equal(body.reasoning_effort, 'minimal');
});

test('명시한 값은 그대로 전달한다 (2.5 계열의 none 등)', async () => {
  const body = await bodySentWith('low', 'low');
  assert.equal(body.reasoning_effort, 'low');
});
