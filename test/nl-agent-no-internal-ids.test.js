// nl-agent-no-internal-ids.test.js — 팀원·카테고리의 내부 id가 프롬프트로 새어 나가는지.
//
// "제가 누구죠?"에 봇이 "○○ 님(id 2)이십니다"라고 채널에 답했다. 원인은 프롬프트다 —
// buildSystem이 이름 바로 옆에 `(id 11)`을 붙여 두니 모델이 그대로 베껴 썼다.
// 이 id는 모델에게 쓸모도 없다: TOOL_DEFS 어느 도구도 팀원/카테고리 id를 인자로 받지 않고,
// create/update_transaction은 member_name·category_name을 서버에서 이름으로 해석한다.
// 사람에게 보여도 되는 유일한 번호는 지출 번호(#7)뿐이다(list_recent_transactions 결과).
//
// 그래서 여기서 못 박는 것: 프롬프트 어디에도 `(id N)` 형태가 없을 것,
// 그리고 id를 남기는 유일한 경로인 운영 로그(speakerLineFor withId)는 그대로 살아 있을 것.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let createToolkit;
let buildSystem;
let speakerLineFor;

// 개인 잔액이 병합되는 경우와 아닌 경우를 모두 돌려 보기 위해 갈아끼운다.
let dashboardMembers = [
  { member_id: 11, name: '홍길동', allocation: 180000, used: 52000, remaining: 128000, ratio: 0.288 },
  { member_id: 12, name: '김철수', allocation: 180000, used: 0, remaining: 180000, ratio: 0 },
];

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith('/api/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          categories: [
            { id: 1, name: '커피', allocated: 200000, used: 72000, remaining: 128000 },
            { id: 2, name: '회식', allocated: 500000, used: 120000, remaining: 380000 },
          ],
          members: dashboardMembers,
        }),
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
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
  ({ buildSystem, speakerLineFor } = await import('../src/nl-agent.js'));
});

after(() => server.close());

const ID_IN_TEXT = /\(id \d+\)/;

test('시스템 프롬프트 어디에도 내부 id가 실리지 않는다 (잔액 병합·발화자 해석 조합 전부)', async () => {
  const saved = dashboardMembers;
  try {
    // 개인 잔액이 병합된 경우 / dashboard.members가 빈 경우(과거 월·서버 구버전) 둘 다.
    for (const members of [saved, []]) {
      dashboardMembers = members;
      const tk = await createToolkit();
      // 발화자가 팀원으로 특정되는 경우 / 특정되지 않는 경우 둘 다.
      for (const speaker of ['홍길동', '방문객']) {
        const sys = buildSystem(tk, { speaker });
        assert.doesNotMatch(
          sys,
          ID_IN_TEXT,
          `프롬프트에 id가 있으면 모델이 회신에 그대로 옮긴다 (members=${members.length}, speaker=${speaker})`,
        );
      }
    }
  } finally {
    dashboardMembers = saved;
  }
});

test('팀원·카테고리 줄은 이름과 금액만 담는다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk, { speaker: '홍길동' });
  const lines = sys.split('\n');
  assert.equal(lines.find((l) => l.startsWith('- 홍길동')), '- 홍길동: 잔액 128,000원 / 180,000원');
  assert.equal(lines.find((l) => l.startsWith('- 커피')), '- 커피: 잔액 128,000원 / 200,000원');
  assert.equal(
    lines.find((l) => l.startsWith('발화자')),
    '발화자(이 메시지를 보낸 사람): 홍길동',
    '발화자 줄도 이름만 — 여기가 "(id 2)이십니다" 사고의 발원지였다',
  );
});

// 로그는 어느 로스터 행에 붙었는지 확인해야 하므로 id가 필요하다. 채널에는 절대 가지 않는다.
test('speakerLineFor: 프롬프트용은 이름만, 로그용(withId)은 id를 유지한다', async () => {
  const tk = await createToolkit();
  assert.equal(speakerLineFor(tk, '홍길동'), '홍길동');
  assert.equal(speakerLineFor(tk, '홍길동', {}), '홍길동', '옵션 객체를 줘도 기본은 id 없음');
  assert.equal(speakerLineFor(tk, '홍길동', { withId: true }), '홍길동(id 11)');
  // 해석 실패 분기는 원래 id가 없다 — 옵션과 무관하게 같은 문구여야 한다.
  assert.equal(speakerLineFor(tk, '방문객', { withId: true }), '방문객 (팀원 목록에 없음)');
  assert.equal(speakerLineFor(tk, null, { withId: true }), '(알 수 없음)');
});

// list_categories·list_recent_transactions는 원본 JSON(id, member_id, period_category_id)을
// 그대로 돌려주므로, 프롬프트에서 id를 지워도 모델은 도구 결과로 id를 다시 보게 된다.
test('내부 id를 회신에 쓰지 말라는 규칙이 프롬프트에 있다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk, { speaker: '홍길동' });
  assert.match(sys, /팀원·카테고리의 내부 id는 회신에 절대 쓰지 마라/);
  assert.match(sys, /지출 번호\(#7\)/, '지출 번호는 사람에게 보여도 되는 유일한 번호다');
});
