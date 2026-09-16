// openrouter-request.test.js — Gemini 설정을 건드리지 않고 OpenRouter를 선택할 수 있어야 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const received = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '커피' } }] }));
  });
});

let llm;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LLM_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.OPENROUTER_MODEL = 'google/gemini-3.5-flash-lite';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  delete process.env.GEMINI_API_KEY;
  llm = await import('../src/gemini.js?provider=openrouter-test');
});

after(() => {
  server.close();
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
});

test('OpenRouter 키만으로 도구 호출 요청을 보낸다', async () => {
  assert.equal(llm.name, 'openrouter');
  assert.equal(llm.configured(), true);

  await llm.call({ messages: [{ role: 'user', content: '안녕' }], tools: [], timeout: 5000 });

  assert.equal(received.length, 1);
  assert.equal(received[0].headers.authorization, 'Bearer openrouter-test-key');
  assert.equal(received[0].body.model, 'google/gemini-3.5-flash-lite');
  assert.deepEqual(received[0].body.reasoning, { effort: 'minimal', exclude: true });
  assert.equal(received[0].body.reasoning_effort, undefined);
});
