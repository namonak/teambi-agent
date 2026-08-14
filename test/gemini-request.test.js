// gemini-request.test.js — Gemini 프로바이더가 "실제로 보내는 요청 본문"을 검증한다.
// gemini-2.5-flash는 thinking이 기본 On이라 Teams 응답 예산(4.2s)을 넘긴다.
// OpenAI 호환 레이어의 reasoning_effort로 꺼야 하므로, 그 파라미터가 나가는지 확인한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const received = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ path: req.url, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'test',
        object: 'chat.completion',
        created: 0,
        model: 'gemini-2.5-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: '커피' }, finish_reason: 'stop' }],
      }),
    );
  });
});

let gemini;

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  // 모듈 최상단에서 env를 읽으므로 반드시 import 전에 설정한다
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/`;
  gemini = await import('../src/providers/gemini.js');
});

after(() => server.close());

test('call: thinking을 끄는 reasoning_effort를 함께 보낸다', async () => {
  received.length = 0;
  await gemini.call({
    messages: [{ role: 'user', content: '안녕' }],
    tools: [],
    timeout: 5000,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].body.reasoning_effort, 'none');
});

test('simpleText: 분류 폴백 호출에도 reasoning_effort를 보낸다', async () => {
  received.length = 0;
  const text = await gemini.simpleText({
    system: '분류기',
    user: '스타벅스',
    maxTokens: 64,
    timeout: 2500,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].body.reasoning_effort, 'none');
  assert.equal(text, '커피');
});

// 환경변수별 동작은 gemini-reasoning-env.test.js에서 검증한다
