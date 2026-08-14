// webhook-balance.test.js — 회신에 붙는 잔액 줄 생성.
// 잔액은 부가 정보라 조회가 실패해도 기입/삭제 회신은 성공으로 나가야 하고,
// 대신 실패 이유는 로그에 남아야 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let webhook;
let mode = 'ok'; // 'ok' | 'error'

const server_ = http.createServer((req, res) => {
  if (req.url === '/api/login') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=test; Path=/' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (mode === 'error') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: '내부 DB 접속 문자열 노출 금지' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      categories: [{ id: 7, name: '커피', allocated: 210000, used: 166600, remaining: 43400 }],
    }),
  );
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TMM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.TMM_PASSWORD = 'pw';
  webhook = await import('../src/webhook.js');
});

after(() => server.close());

test('조회 성공: 카테고리 이름과 잔액/예산을 한 줄로 만든다', async () => {
  mode = 'ok';
  const line = await webhook.balanceLineFor('2026-08', 7);
  assert.match(line, /^\n커피 잔액: /);
  assert.match(line, /43,400원 \/ 210,000원$/);
});

test('해당 카테고리가 없으면 빈 문자열 (회신에 아무것도 붙지 않음)', async () => {
  mode = 'ok';
  const line = await webhook.balanceLineFor('2026-08', 999);
  assert.equal(line, '');
});

test('조회 실패해도 빈 문자열을 반환하고, 이유는 로그에만 남긴다', async () => {
  mode = 'error';
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    const line = await webhook.balanceLineFor('2026-08', 7);
    assert.equal(line, '', '실패는 회신을 막지 않아야 한다');
  } finally {
    console.warn = original;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /잔액 조회 실패/);
});
