// nl-agent-member-balance.test.js — 팀원별 개인 잔액이 시스템 프롬프트까지 실려 나가는지.
//
// /api/dashboard는 members[](member_id + 금액)로 개인 잔액을 이미 내려주는데,
// createToolkit이 categories만 꺼내 쓰는 바람에 모델은 개인 잔액을 본 적이 없었다.
// 게다가 규칙이 잔액 질문에 도구 호출을 금지해(라운드 절약) 조회 우회로도 없었다.
// 그래서 "홍길동 잔액 얼마야?"에 "확인할 수 없다"고 답했다.
// 신규 도구 없이(=라운드 추가 없이) 프롬프트 선주입으로 해결한 것이 여기서 검증하는 경로다.
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

test('시스템 프롬프트에 팀원 이름과 잔액이 같은 줄에 실린다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk);
  const line = sys.split('\n').find((l) => l.includes('홍길동'));
  assert.ok(line, '팀원 줄이 있어야 한다');
  assert.match(line, /128,000원/, '이름과 잔액이 붙어 있어야 모델이 연결한다');
  assert.match(line, /180,000원/, '배정액도 같이 보여 준다');
  assert.ok(
    sys.split('\n').find((l) => l.includes('김철수'))?.includes('180,000원'),
    '팀원마다 한 줄씩 나와야 한다',
  );
});

test('dashboard.members가 비어도 예외 없이 이름만으로 렌더된다', async () => {
  const saved = dashboardMembers;
  dashboardMembers = []; // 과거 월·서버 구버전
  try {
    const tk = await createToolkit();
    const sys = buildSystem(tk);
    const line = sys.split('\n').find((l) => l.includes('홍길동'));
    assert.equal(line, '- 홍길동(id 11)', '금액이 없으면 이름만 (undefined원 금지)');
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
