// nl-agent-budget.test.js — 타임아웃 시 예산이 어디로 갔는지 로그에 남기기.
//
// "AI 응답이 제한 시간 안에 오지 않았어요"만 남으면 무엇이 예산을 먹었는지 알 수 없어
// 컨테이너에 들어가 구간별로 재야 했다(createToolkit 1,858ms가 범인이었다).
// 준비·LLM·도구 실행이 각각 몇 ms를 썼는지 남겨 추측 없이 판단할 수 있게 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { budgetSummary } from '../src/nl-agent.js';

test('budgetSummary: 구간별 소진과 남은 시간을 한 줄로 만든다', () => {
  const line = budgetSummary({ toolkit: 1858, llm: 1381, tools: 436, rounds: 1 }, 525);
  assert.match(line, /1858/, '준비 구간이 보여야 한다');
  assert.match(line, /1381/, 'LLM 구간이 보여야 한다');
  assert.match(line, /436/, '도구 실행 구간이 보여야 한다');
  assert.match(line, /525/, '남은 시간이 보여야 한다');
  assert.match(line, /1라운드|라운드 1|1회/, '몇 라운드를 돌았는지 알아야 한다');
});

// --- 실제 경로에서 로그가 남는지 -------------------------------------------
let server;
let runNlAgent;

const server_ = http.createServer((req, res) => {
  if (req.url === '/api/login') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ categories: [{ id: 1, name: '커피', allocated: 1000, used: 0, remaining: 1000 }], members: [] }));
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TMM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.TMM_PASSWORD = 'pw';
  process.env.GEMINI_API_KEY = 'test-key';
  ({ runNlAgent } = await import('../src/nl-agent.js?case=budget'));
});

after(() => server.close());

test('예산이 모자라 라운드를 못 돌면 소진 내역을 로그에 남긴다', async () => {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  let reply;
  try {
    // createToolkit만으로 예산이 바닥나도록 아주 짧은 데드라인을 준다
    reply = await runNlAgent('이번 달 커피 얼마 남았어?', Date.now() + 50);
  } finally {
    console.warn = original;
  }

  assert.match(reply, /시간이 초과/, '사용자에게는 시간 초과로 회신한다');
  const budget = warned.find((w) => w.includes('예산'));
  assert.ok(budget, '예산 소진 내역이 로그에 남아야 한다');
  assert.match(budget, /준비/, '어느 구간이 얼마를 썼는지 담겨야 한다');
});
