// tools-no-internal-ids.test.js — 도구 결과에 내부 id가 실리지 않는지.
//
// 프롬프트에서 "(id 11)"을 걷어낸 뒤에도 누수 경로가 하나 남아 있었다. list_categories와
// list_recent_transactions는 서버 응답을 JSON 그대로 모델에게 넘기는데, 거기에
// id·member_id·period_category_id가 들어 있다. 모델은 이걸 회신에 옮겨 적어
// "최정 님(id 2)이십니다" 같은 문구를 채널에 내보냈다.
// 팀원·카테고리는 이름으로만 지정하므로(member_name/category_name) 이 id들은 모델에게
// 쓸모가 0이다. 반면 지출 id는 사용자가 "#7 삭제해줘"로 부르는 번호라 남겨야 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let createToolkit;

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith('/api/transactions')) {
      // 실제 서버는 members·period_categories를 LEFT JOIN해 이름과 id를 함께 준다.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          transactions: [
            {
              id: 7,
              date: '2026-09-01',
              amount: 6500,
              kind: 'personal',
              card: 1,
              memo: '카페',
              member_id: 11,
              period_category_id: null,
              member_name: '홍길동',
              category_name: null,
            },
            {
              id: 8,
              date: '2026-09-02',
              amount: 12000,
              kind: 'common',
              card: 2,
              memo: null,
              member_id: null,
              period_category_id: 1,
              member_name: null,
              category_name: '커피',
            },
          ],
        }),
      );
    }
    if (req.url.startsWith('/api/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          categories: [{ id: 1, name: '커피', allocated: 200000, used: 72000, remaining: 128000 }],
          members: [{ member_id: 11, name: '홍길동', allocation: 180000, used: 6500, remaining: 173500 }],
        }),
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ members: [{ id: 11, name: '홍길동', active: 1 }] }));
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

test('list_categories 결과에 카테고리 내부 id가 없다', async () => {
  const tk = await createToolkit();
  const { content, is_error } = await tk.run('list_categories', {});
  assert.equal(is_error, false, content);
  const rows = JSON.parse(content);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, undefined, '이름으로만 지정하므로 id는 모델에게 쓸모가 없다');
  assert.equal(rows[0].name, '커피', '이름과 금액은 그대로 남아야 답변을 만들 수 있다');
  assert.equal(rows[0].remaining, 128000);
  assert.doesNotMatch(content, /"id"/);
});

test('list_recent_transactions는 지출 id만 남기고 팀원·카테고리 id는 지운다', async () => {
  const tk = await createToolkit();
  const { content, is_error } = await tk.run('list_recent_transactions', {});
  assert.equal(is_error, false, content);
  const rows = JSON.parse(content);

  assert.equal(rows[0].id, 7, '사용자가 "#7 삭제해줘"로 부르는 번호라 남긴다');
  assert.equal(rows[0].member_id, undefined, '모델이 회신에 옮겨 적던 내부 id');
  assert.equal(rows[0].period_category_id, undefined);
  assert.equal(rows[0].member_name, '홍길동', '이름이 남아야 누구 지출인지 답할 수 있다');
  assert.equal(rows[1].category_name, '커피');
  assert.doesNotMatch(content, /member_id|period_category_id/);
});

test('기입·수정·삭제 회신 문구에는 내부 id가 섞이지 않는다', async () => {
  const tk = await createToolkit();
  const { content } = await tk.run('list_recent_transactions', { limit: 1 });
  // summarize가 만드는 사용자 대면 문구는 #지출번호만 쓴다 — (id N) 형태가 나오면 안 된다.
  assert.doesNotMatch(content, /\(id \d+\)/);
});
