// nl-agent-personal-split.test.js — 명시적인 인원별 지출은 공용으로 저장하면 안 된다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const text = '박형진 팀장님, 이태호, 백승정, 저 11,500원씩 사용했습니다~';
const submitted = [];
let mode = 'wrong-kind';
let selectedMembers;
let server;
let runNlAgent;

const send = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith('/api/dashboard')) {
      return send(res, {
        categories: [{ id: 1, name: '간식', allocated: 100000, used: 0, remaining: 100000 }],
        members: [
          { member_id: 11, name: '박형진', allocation: 70000, used: 0, remaining: 70000 },
          { member_id: 12, name: '이태호', allocation: 70000, used: 0, remaining: 70000 },
          { member_id: 13, name: '백승정', allocation: 70000, used: 0, remaining: 70000 },
          { member_id: 14, name: '최정', allocation: 70000, used: 0, remaining: 70000 },
        ],
      });
    }
    if (req.url === '/api/members') {
      return send(res, {
        members: [
          { id: 11, name: '박형진', active: 1 },
          { id: 12, name: '이태호', active: 1 },
          { id: 13, name: '백승정', active: 1 },
          { id: 14, name: '최정', active: 1 },
        ],
      });
    }
    if (req.method === 'POST' && req.url === '/api/transactions') {
      const transaction = JSON.parse(body);
      submitted.push(transaction);
      return send(res, { transaction: { id: submitted.length, ...transaction } });
    }
    if (req.url.endsWith('/chat/completions')) {
      const request = JSON.parse(body);
      if (request.messages.at(-1)?.role === 'user') {
        const amount = request.messages.at(-1).content.includes('12,000') ? 12000 : 11500;
        const toolCalls = mode === 'wrong-kind'
          ? [{ id: 'wrong-1', type: 'function', function: { name: 'create_transaction', arguments: '{"amount":11500,"kind":"common","category_name":"간식"}' } }]
          : (selectedMembers ?? [
              ['박형진', 11], ['이태호', 12], ['백승정', 13], ['최정', 14],
            ]).map(([member_name, id]) => ({ id: `personal-${id}`, type: 'function', function: { name: 'create_transaction', arguments: JSON.stringify({ amount, kind: 'personal', member_name }) } }));
        return send(res, { choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }] });
      }
      return send(res, { choices: [{ message: { role: 'assistant', content: '✅ 개인 지출 4건을 등록했어요.' } }] });
    }
    return send(res, { error: `unexpected ${req.method} ${req.url}` }, 404);
  });
});

before(async () => {
  server = server_;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.TMM_BASE_URL = base;
  process.env.TMM_PASSWORD = 'pw';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BASE_URL = `${base}/llm/`;
  process.env.TEAMS_MEMBER_ALIASES = '박형진=팀장님,실장님';
  ({ runNlAgent } = await import('../src/nl-agent.js?case=personal-split'));
});

after(() => server.close());

test('인원별 지출을 공용으로 요청한 모델은 저장 전에 차단한다', async () => {
  mode = 'wrong-kind';
  submitted.length = 0;
  const reply = await runNlAgent(text, Date.now() + 5000, { speaker: '최정' });

  assert.equal(submitted.length, 0, '공용 거래가 하나라도 저장되면 안 된다');
  assert.match(reply, /개인 지출.*등록하지 않았/, '사용자는 재확인 방법을 받아야 한다');
});

test('인원별 지출은 각 팀원의 개인 지출로 등록한다', async () => {
  mode = 'personal';
  submitted.length = 0;
  const reply = await runNlAgent(text, Date.now() + 5000, { speaker: '최정' });

  assert.equal(reply, '✅ 개인 지출 4건을 등록했어요.');
  assert.deepEqual(
    submitted.map(({ kind, member_id, period_category_id, amount }) => ({ kind, member_id, period_category_id, amount })),
    [
      { kind: 'personal', member_id: 11, period_category_id: null, amount: 11500 },
      { kind: 'personal', member_id: 12, period_category_id: null, amount: 11500 },
      { kind: 'personal', member_id: 13, period_category_id: null, amount: 11500 },
      { kind: 'personal', member_id: 14, period_category_id: null, amount: 11500 },
    ],
  );
});

const exclusionText = '실장님, 이태호 선임님 제외하고 모두 12,000원 개인사용했습니다.';

test('호칭으로 제외한 사람을 포함하면 저장 전에 차단한다', async () => {
  mode = 'personal';
  selectedMembers = [['박형진', 11], ['백승정', 13], ['최정', 14]];
  submitted.length = 0;
  const reply = await runNlAgent(exclusionText, Date.now() + 5000, { speaker: '최정' });
  assert.equal(submitted.length, 0);
  assert.match(reply, /개인 지출.*등록하지 않았/);
});

test('제외하고 모두 요청은 남은 팀원만 등록한다 (각·씩 없이도)', async () => {
  mode = 'personal';
  selectedMembers = [['백승정', 13], ['최정', 14]];
  for (const request of [exclusionText, exclusionText.replace('모두', '모두 각')]) {
    submitted.length = 0;
    await runNlAgent(request, Date.now() + 5000, { speaker: '최정' });
    assert.deepEqual(submitted.map(({ member_id, kind, amount }) => ({ member_id, kind, amount })), [
      { member_id: 13, kind: 'personal', amount: 12000 },
      { member_id: 14, kind: 'personal', amount: 12000 },
    ]);
  }
});

test('제외 후 남은 팀원을 빠뜨리면 저장 전에 차단한다', async () => {
  mode = 'personal';
  selectedMembers = [['백승정', 13]];
  submitted.length = 0;
  await runNlAgent(exclusionText, Date.now() + 5000, { speaker: '최정' });
  assert.equal(submitted.length, 0);
});

test('제외한 호칭이 미등록이면 추측해 저장하지 않는다', async () => {
  mode = 'personal';
  selectedMembers = [['백승정', 13], ['최정', 14]];
  for (const ref of ['방문객 선임님', '선임님']) {
    submitted.length = 0;
    await runNlAgent(`${ref} 제외하고 모두 12,000원 개인사용했습니다.`, Date.now() + 5000, { speaker: '최정' });
    assert.equal(submitted.length, 0, ref);
  }
});

test('제외 후 한 명만 남아도 개인 지출을 등록한다', async () => {
  mode = 'personal';
  selectedMembers = [['최정', 14]];
  submitted.length = 0;
  await runNlAgent('실장님, 이태호, 백승정 제외하고 모두 12,000원 개인사용했습니다.', Date.now() + 5000, { speaker: '최정' });
  assert.deepEqual(submitted.map(t => t.member_id), [14]);
});

test('본인 제외는 발화자 이름으로 해석한다', async () => {
  mode = 'personal';
  selectedMembers = [['박형진', 11], ['이태호', 12], ['백승정', 13]];
  submitted.length = 0;
  await runNlAgent('저를 제외하고 모두 12,000원 개인사용했습니다.', Date.now() + 5000, { speaker: '최정' });
  assert.deepEqual(submitted.map(t => t.member_id), [11, 12, 13]);
});

test('같은 대상의 중복 등록 호출은 저장 전에 차단한다', async () => {
  mode = 'personal';
  selectedMembers = [['백승정', 13], ['백승정', 13], ['최정', 14]];
  submitted.length = 0;
  await runNlAgent(exclusionText, Date.now() + 5000, { speaker: '최정' });
  assert.equal(submitted.length, 0);
});
