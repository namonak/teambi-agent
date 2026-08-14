// tmm-warmup.test.js — 기동 시 teamMoneyManager 세션 준비.
//
// 측정: 세션 없는 첫 요청의 createToolkit이 1,858ms였다(로그인 왕복 포함).
// Teams 동기 예산이 4.2초뿐이라 첫 요청은 이것만으로 44%를 잃고 타임아웃했다.
// 기동 시점에 미리 로그인해 두면 첫 요청도 두 번째 요청과 같은 조건이 된다.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let tmm;
let loginCount = 0;
let loginOk = true;

const server_ = http.createServer((req, res) => {
  if (req.url === '/api/login') {
    loginCount += 1;
    if (!loginOk) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '비밀번호 불일치' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=test; Path=/' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ members: [{ id: 1, name: '홍길동', active: 1 }] }));
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TMM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.TMM_PASSWORD = 'pw';
  tmm = await import('../src/tmm-client.js');
});

after(() => server.close());
beforeEach(() => {
  loginCount = 0;
  loginOk = true;
});

test('warmUp: 세션을 미리 만들어 두면 이후 요청이 로그인을 다시 하지 않는다', async () => {
  await tmm.warmUp();
  assert.equal(loginCount, 1, '워밍업이 로그인을 한 번 수행해야 한다');

  await tmm.getMembers();
  assert.equal(loginCount, 1, '준비된 세션을 재사용해 추가 로그인이 없어야 한다');
});

test('warmUp: 이미 세션이 있으면 다시 로그인하지 않는다', async () => {
  await tmm.warmUp();
  assert.equal(loginCount, 0, '앞 테스트의 세션이 살아 있으면 로그인이 발생하지 않는다');
});

test('warmUp: 실패는 예외로 알리되 이후 요청을 막지 않는다', async () => {
  // 기동을 멈추지 않고 경고만 남기려면 호출부가 실패를 잡을 수 있어야 한다
  const fresh = await import('../src/tmm-client.js?case=fail');
  loginOk = false;
  await assert.rejects(() => fresh.warmUp(), /로그인 실패|401/);

  loginOk = true;
  const { members } = await fresh.getMembers();
  assert.equal(members.length, 1, '워밍업이 실패해도 요청 시점에 다시 로그인해 동작해야 한다');
});
