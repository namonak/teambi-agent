// tools-personal.test.js — list_members 도구를 뺀 뒤에도 개인 지출 기입이 동작하는지.
//
// list_members는 시스템 프롬프트의 '활성 팀원:' 줄과 완전히 중복이고 네트워크 조회도
// 아니어서(이미 로드된 배열을 되돌려줄 뿐) 제거했다. 정보량 0인데 LLM 라운드 하나를
// 통째로 소모해 4.2초 예산을 무너뜨렸기 때문이다.
// 팀원 이름 → id 해석은 resolveByName이 toolkit의 members로 처리하므로 영향이 없어야
// 하는데, 그게 실제로 그런지 여기서 못 박는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let createToolkit;
let lastCreateBody = null;

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'POST' && req.url === '/api/transactions') {
      lastCreateBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, transaction: { id: 7, ...lastCreateBody } }));
    }
    if (req.url.startsWith('/api/dashboard')) {
      // 실제 서버와 동일하게 members는 member_id 키 + 금액 필드를 갖는다.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          categories: [{ id: 1, name: '커피', allocated: 10000, used: 0, remaining: 10000 }],
          members: [
            { member_id: 11, name: '홍길동', allocation: 180000, used: 52000, remaining: 128000, ratio: 0.288 },
            { member_id: 12, name: '김철수', allocation: 180000, used: 0, remaining: 180000, ratio: 0 },
          ],
        }),
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        categories: [{ id: 1, name: '커피', allocated: 10000, used: 0, remaining: 10000 }],
        members: [
          { id: 11, name: '홍길동', active: 1 },
          { id: 12, name: '김철수', active: 1 },
        ],
      }),
    );
  });
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TMM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.TMM_PASSWORD = 'pw';
  ({ createToolkit } = await import('../src/tools.js'));
});

after(() => server.close());

test('도구 목록에 list_members가 없다', async () => {
  const tk = await createToolkit();
  const names = tk.tools.map((t) => t.name);
  assert.ok(!names.includes('list_members'), '프롬프트와 중복되는 도구는 라운드만 낭비한다');
  assert.ok(names.includes('list_categories'), '갱신된 잔액을 얻는 유일한 수단이라 남긴다');
});

test('팀원 이름으로 개인 지출을 기입할 수 있다 (list_members 없이)', async () => {
  const tk = await createToolkit();
  lastCreateBody = null;

  const r = await tk.run('create_transaction', {
    amount: 5000,
    kind: 'personal',
    member_name: '김철수',
  });

  assert.equal(r.is_error, false, r.content);
  assert.equal(lastCreateBody.member_id, 12, '이름이 id로 해석되어야 한다');
  assert.equal(lastCreateBody.kind, 'personal');
  assert.equal(lastCreateBody.period_category_id, null, '개인 지출은 카테고리를 비운다');
});

test('없는 팀원 이름은 후보를 제시하는 오류로 되돌려준다', async () => {
  const tk = await createToolkit();
  const r = await tk.run('create_transaction', { amount: 5000, kind: 'personal', member_name: '없는사람' });
  assert.equal(r.is_error, true);
  assert.match(r.content, /홍길동/, 'LLM이 스스로 고쳐 부를 수 있게 후보를 준다');
});

test('toolkit.members는 그대로 남아 이름 해석에 쓰인다', async () => {
  const tk = await createToolkit();
  assert.deepEqual(
    tk.members.map((m) => m.name),
    ['홍길동', '김철수'],
  );
});
