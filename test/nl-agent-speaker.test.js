// nl-agent-speaker.test.js — 발화자(Teams from.name)와 호칭이 시스템 프롬프트에 실리는지.
//
// "○○님과 제가 6,500원씩 썼어요"에 봇이 엉뚱한 팀원으로 기입한 사고가 있었다.
// webhook은 from.name을 게시 머리말에만 쓰고 runNlAgent엔 넘기지 않았고, 프롬프트에도
// 발화자 줄이 없어 모델이 "제가"를 팀원 목록에서 임의로 골랐다.
// 여기서 검증하는 것은 그 경로다 — 발화자 줄, 1인칭 규칙, 호칭(별칭) 렌더.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let createToolkit;
let buildSystem;
let speakerLineFor;

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
        members: [
          { id: 11, name: '홍길동', active: 1 },
          { id: 12, name: '김철수', active: 1 },
          // 성이 같은 두 명 — 발화자 표시명이 성만 담고 올 때 모호함이 드러나야 한다.
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
  ({ buildSystem, speakerLineFor } = await import('../src/nl-agent.js'));
});

after(() => server.close());

const speakerLine = (sys) => sys.split('\n').find((l) => l.startsWith('발화자'));

test('발화자를 팀원으로 해석해 프롬프트에 이름을 싣는다 (내부 id 없이)', async () => {
  const tk = await createToolkit();
  // Teams 표시명은 환경마다 형식이 다르다 — 어느 형식이든 같은 사람으로 붙어야 한다.
  for (const from of ['홍길동', '홍길동 (Gildong Hong)', '홍길동/BI팀', '홍길동 실장님']) {
    const sys = buildSystem(tk, { speaker: from });
    assert.equal(speakerLine(sys), '발화자(이 메시지를 보낸 사람): 홍길동', from);
  }
});

test('팀원 목록에 없는 발화자는 원문과 함께 "없음"으로 명시한다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk, { speaker: '방문객' });
  assert.equal(speakerLine(sys), '발화자(이 메시지를 보낸 사람): 방문객 (팀원 목록에 없음)');
});

// 후보가 여럿일 때 "목록에 없음"이라고 적으면 사실과 다르다. 모델은 그 줄을 근거로
// "발화자가 팀원이 아니다"라고 단정해 버려, 되묻지도 않고 1인칭 지출을 흘려보낸다.
test('발화자가 여러 팀원과 일치하면 "없음"이 아니라 모호함으로 알린다', async () => {
  const tk = await createToolkit();
  for (const from of ['박', '박 팀장님']) {
    const sys = buildSystem(tk, { speaker: from });
    assert.equal(
      speakerLine(sys),
      `발화자(이 메시지를 보낸 사람): ${from} (팀원 여러 명과 일치 — 누구인지 확인 필요)`,
      from,
    );
    assert.ok(!sys.includes(`${from} (팀원 목록에 없음)`), '목록에 있는 사람을 없다고 하면 안 된다');
  }
  assert.equal(speakerLineFor(tk, '박정민'), '박정민', '전체 이름이면 그대로 특정된다');
});

test('발화자 정보가 없으면 (알 수 없음) — undefined/NaN이 새어 나가지 않는다', async () => {
  const tk = await createToolkit();
  for (const sys of [buildSystem(tk), buildSystem(tk, {}), buildSystem(tk, { speaker: '' })]) {
    assert.equal(speakerLine(sys), '발화자(이 메시지를 보낸 사람): (알 수 없음)');
    assert.doesNotMatch(sys, /undefined|NaN|null/);
  }
});

test('speakerLineFor: 별칭으로 불린 발화자도 해석한다', async () => {
  process.env.TEAMS_MEMBER_ALIASES = '홍길동=홍실장,실장님';
  try {
    const tk = await createToolkit();
    assert.equal(speakerLineFor(tk, '실장님'), '홍길동');
    assert.equal(speakerLineFor(tk, null), '(알 수 없음)');
  } finally {
    delete process.env.TEAMS_MEMBER_ALIASES;
  }
});

test('1인칭·호칭 규칙이 프롬프트에 들어 있다', async () => {
  const tk = await createToolkit();
  const sys = buildSystem(tk, { speaker: '홍길동' });
  assert.match(sys, /"저\/제가\/나\/내\/제" 같은 1인칭은 발화자 본인이다/);
  assert.match(sys, /다른 팀원 이름으로 추측해 기입하지 마라/);
  assert.match(sys, /직책·호칭\(실장님, 팀장님, ~님\)을 빼고/);
  assert.match(sys, /호칭으로 물으면/);
  assert.match(sys, /추측하지 말고 누구인지 되묻는다/);
  // 라운드를 아끼는 기존 규칙이 함께 남아 있어야 한다(예산 회귀 방지).
  assert.match(sys, /list_categories는 기입\/수정\/삭제를 실행한 직후/);
  assert.match(sys, /잔액·팀원 질문은 공용·개인 모두 도구 없이/);
});

test('별칭이 없으면 팀원 줄에 [호칭]이 붙지 않는다', async () => {
  delete process.env.TEAMS_MEMBER_ALIASES;
  const tk = await createToolkit();
  const sys = buildSystem(tk, { speaker: '홍길동' });
  assert.doesNotMatch(sys, /\[호칭:/, '설정하지 않은 호칭을 모델이 지어내면 안 된다');
});

test('별칭이 있으면 팀원 줄에 원문 호칭이 붙는다 (내부 키는 노출하지 않는다)', async () => {
  process.env.TEAMS_MEMBER_ALIASES = '홍길동=실장님,홍실장';
  try {
    const tk = await createToolkit();
    const sys = buildSystem(tk, { speaker: '홍길동' });
    const line = sys.split('\n').find((l) => l.startsWith('- 홍길동'));
    assert.equal(line, '- 홍길동: 잔액 128,000원 / 180,000원 [호칭: 실장님, 홍실장]');
    const other = sys.split('\n').find((l) => l.startsWith('- 김철수'));
    assert.equal(other, '- 김철수: 잔액 180,000원 / 180,000원', '별칭 없는 팀원은 그대로');
  } finally {
    delete process.env.TEAMS_MEMBER_ALIASES;
  }
});
