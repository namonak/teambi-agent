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
          // 같은 성이 둘 — 성만 말하면 모호해야 하고, 직책을 붙이면 정확히 해석돼야 한다.
          { id: 13, name: '박정민', active: 1 },
          { id: 14, name: '박형준', active: 1 },
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
    ['홍길동', '김철수', '박정민', '박형준'],
  );
});

// --- 호칭·직책 해석 --------------------------------------------------------
// "박실장님과 제가 6500원씩 썼어요"에서 봇이 엉뚱한 팀원으로 기입한 사고의 절반은
// 여기(이름 해석)였다. 서버 스키마에 직책이 없어 장부장이 흡수해야 한다.

async function memberIdFor(name) {
  const tk = await createToolkit();
  lastCreateBody = null;
  const r = await tk.run('create_transaction', { amount: 5000, kind: 'personal', member_name: name });
  assert.equal(r.is_error, false, r.content);
  return lastCreateBody.member_id;
}

test('직책·호칭을 붙여 불러도 이름으로 해석된다', async () => {
  assert.equal(await memberIdFor('박정민 실장님'), 13);
  assert.equal(await memberIdFor('박형준 팀장'), 14);
  assert.equal(await memberIdFor('홍길동님'), 11);
});

test('성만 말하면 모호 오류로 되돌려 준다 (추측 기입 금지)', async () => {
  const tk = await createToolkit();
  const r = await tk.run('create_transaction', { amount: 5000, kind: 'personal', member_name: '박' });
  assert.equal(r.is_error, true);
  assert.match(r.content, /모호/);
  assert.match(r.content, /박정민/);
  assert.match(r.content, /박형준/);
});

test('별칭 설정이 없으면 직책만으로는 기입하지 않는다', async () => {
  delete process.env.TEAMS_MEMBER_ALIASES;
  const tk = await createToolkit();
  const r = await tk.run('create_transaction', { amount: 5000, kind: 'personal', member_name: '실장님' });
  assert.equal(r.is_error, true, '누구인지 모르는 채 아무나 고르면 안 된다');
  assert.match(r.content, /찾을 수 없음/);
});

test('.env 별칭을 설정하면 직책·별명으로도 기입된다', async () => {
  process.env.TEAMS_MEMBER_ALIASES = '박정민=박실장,실장님';
  try {
    for (const ref of ['박실장', '실장님', '박 실장님']) {
      assert.equal(await memberIdFor(ref), 13, ref);
    }
    const tk = await createToolkit();
    assert.equal(tk.aliases.get('실장'), '박정민', '해석 키는 님을 뗀 형태');
    assert.deepEqual(tk.aliasesOf('박정민'), ['박실장', '실장님'], '표시용 라벨은 원문 그대로');
    assert.deepEqual(tk.aliasesOf('홍길동'), [], '별칭 없는 팀원은 빈 배열');
  } finally {
    delete process.env.TEAMS_MEMBER_ALIASES;
  }
});

// --- 별칭 설정 오류 신호 --------------------------------------------------
// .env의 별칭 대상 이름이 활성 명단과 다르면(오타 '박정민 실장=박실장', 퇴사 등)
// 그 별칭은 영영 해석되지 않는데 겉으로는 아무 일도 일어나지 않는다.
// 운영자가 알아챌 유일한 단서가 이 로그 한 줄이다.
async function warningsFromCreateToolkit() {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    await createToolkit();
  } finally {
    console.warn = original;
  }
  return warned;
}

test('별칭 대상이 활성 팀원에 없으면 경고를 한 줄 남긴다', async () => {
  process.env.TEAMS_MEMBER_ALIASES = '박정민 실장=박실장'; // 이름 칸에 직책까지 적은 오타
  try {
    const warned = await warningsFromCreateToolkit();
    assert.equal(warned.length, 1, '요청마다 한 줄이면 충분하다');
    assert.match(warned[0], /TEAMS_MEMBER_ALIASES/);
    assert.match(warned[0], /박정민 실장/, '어느 항목이 문제인지 알아야 고칠 수 있다');
  } finally {
    delete process.env.TEAMS_MEMBER_ALIASES;
  }
});

test('별칭 대상이 실제 팀원이면 경고하지 않는다', async () => {
  process.env.TEAMS_MEMBER_ALIASES = '박정민=박실장,실장님';
  try {
    assert.deepEqual(await warningsFromCreateToolkit(), [], '정상 설정에 잡음을 내면 경고가 무시된다');
  } finally {
    delete process.env.TEAMS_MEMBER_ALIASES;
  }
});

test('별칭 설정이 아예 없으면 경고하지 않는다', async () => {
  delete process.env.TEAMS_MEMBER_ALIASES;
  assert.deepEqual(await warningsFromCreateToolkit(), []);
});

test('카테고리 이름 해석은 기존 부분 일치 그대로다', async () => {
  const tk = await createToolkit();
  lastCreateBody = null;
  const r = await tk.run('create_transaction', { amount: 4500, kind: 'common', category_name: '커피' });
  assert.equal(r.is_error, false, r.content);
  assert.equal(lastCreateBody.period_category_id, 1);
  assert.equal(lastCreateBody.member_id, null);
});
