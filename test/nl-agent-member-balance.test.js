// nl-agent-member-balance.test.js — 잔액은 LLM이 해석하되, 실제 금액은 도구가 확정한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let createToolkit;
let buildSystem;

// 테스트별로 dashboard.members를 갈아끼운다 (과거 월·서버 구버전은 []를 준다).
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
          categories: [{ id: 1, name: '커피', allocated: 200000, used: 72000, remaining: 128000 }],
          members: dashboardMembers,
        }),
      );
    }
    // /api/members — 여기엔 금액이 없다. 병합 전 상태가 정확히 이 모양이었다.
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
  ({ buildSystem } = await import('../src/nl-agent.js'));
});

after(() => server.close());

test('createToolkit이 dashboard.members의 개인 잔액을 팀원 배열에 병합한다', async () => {
  const tk = await createToolkit();
  const hong = tk.members.find((m) => m.name === '홍길동');
  assert.equal(hong.remaining, 128000, '개인 잔액이 없으면 모델은 답할 근거가 없다');
  assert.equal(hong.allocation, 180000);
  assert.equal(hong.used, 52000);
});

test('시스템 프롬프트에는 이름만 싣고 잔액 조회 도구 사용을 지시한다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk);
  const line = sys.split('\n').find((l) => l.includes('홍길동'));
  assert.ok(line, '팀원 줄이 있어야 한다');
  assert.equal(line, '- 홍길동');
  assert.doesNotMatch(sys, /128,000원|180,000원/);
  assert.match(sys, /잔액·남은 예산 질문에는 반드시 get_balance/);
});

test('dashboard.members가 비어도 예외 없이 이름만으로 렌더된다', async () => {
  const saved = dashboardMembers;
  dashboardMembers = []; // 과거 월·서버 구버전
  try {
    const tk = await createToolkit();
    const sys = buildSystem(tk);
    const line = sys.split('\n').find((l) => l.includes('홍길동'));
    assert.equal(line, '- 홍길동', '금액이 없으면 이름만 (undefined원 금지)');
    assert.doesNotMatch(sys, /NaN|undefined/);
  } finally {
    dashboardMembers = saved;
  }
});

test('병합 후에도 members[].id가 보존돼 이름 해석이 깨지지 않는다', async () => {
  const tk = await createToolkit();
  assert.deepEqual(
    tk.members.map((m) => m.id),
    [11, 12],
    'dashboard의 member_id로 덮어쓰면 resolveByName이 무너진다',
  );
});

test('get_balance가 전체·카테고리·개인·발화자 잔액을 확정 응답으로 반환한다', async () => {
  const tk = await createToolkit({ speaker: '홍길동 (Hong Gildong)' });

  assert.deepEqual(await tk.run('get_balance', { scope: 'total' }), {
    content: `📊 ${tk.period} 잔액\n전체 436,000원\n공용 128,000원 · 개인 308,000원`,
    is_error: false,
    final: true,
  });
  assert.deepEqual(await tk.run('get_balance', { scope: 'category', name: '커피' }), {
    content: '📁 커피 잔액: 128,000원\n예산 200,000원 · 사용 72,000원',
    is_error: false,
    final: true,
  });
  assert.deepEqual(await tk.run('get_balance', { scope: 'member', name: '김철수' }), {
    content: '👤 김철수 개인 잔액: 180,000원\n할당 180,000원 · 사용 0원',
    is_error: false,
    final: true,
  });
  assert.deepEqual(await tk.run('get_balance', { scope: 'self' }), {
    content: '👤 홍길동 개인 잔액: 128,000원\n할당 180,000원 · 사용 52,000원',
    is_error: false,
    final: true,
  });
});
