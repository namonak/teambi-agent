// webhook-speaker-e2e.test.js — 발화자(Teams from.name)가 웹훅 핸들러부터 LLM에 실제로
// 나가는 시스템 프롬프트까지 끊기지 않고 이어지는지.
//
// 이 배선이 끊겨서 "제가 6,500원 썼어요"가 엉뚱한 팀원에게 기입됐다. 단위 테스트는
// speakerFromActivity(webhook)와 buildSystem(nl-agent)을 따로만 못 박고 있어서,
// 그 사이 연결(runNlAgent에 speaker를 넘기는 인자, buildSystem에 speaker를 넘기는 인자)을
// 셋 다 지워도 전부 통과했다. 그래서 여기서는 모킹 없이 진짜 경로로 확인한다:
//   HMAC 서명된 요청 → createWebhookHandler() → runNlAgent → gemini(openai SDK)
// gemini.js는 GEMINI_BASE_URL로 엔드포인트를 재정의할 수 있으므로(프록시·테스트용),
// 가짜 서버 하나가 teamMoneyManager와 Gemini, 채널 게시까지 모두 받아 준다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = crypto.randomBytes(32).toString('base64');

let server;
let createWebhookHandler;
let handler;
const systemPrompts = []; // 모델이 실제로 받은 system 메시지
let postedText = null; // 채널에 사후 게시된 본문
let onPosted = null;

const envBackup = {};
const setEnv = (k, v) => {
  envBackup[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

const MEMBERS = [
  { id: 11, name: '홍길동', active: 1 },
  { id: 12, name: '김철수', active: 1 },
];

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (obj, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    // --- 가짜 teamMoneyManager (fixture 모양은 nl-agent-member-balance.test.js와 동일) ---
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith('/api/dashboard')) {
      return send({
        categories: [{ id: 1, name: '커피', allocated: 200000, used: 72000, remaining: 128000 }],
        members: [
          { member_id: 11, name: '홍길동', allocation: 180000, used: 52000, remaining: 128000, ratio: 0.288 },
          { member_id: 12, name: '김철수', allocation: 180000, used: 0, remaining: 180000, ratio: 0 },
        ],
      });
    }
    if (req.url.startsWith('/api/members')) return send({ members: MEMBERS });

    // --- 가짜 Gemini (OpenAI 호환 /chat/completions) ---
    // 도구를 부르지 않는 최소 응답을 돌려줘 runNlAgent가 1라운드에 텍스트로 끝나게 한다.
    if (req.url.endsWith('/chat/completions')) {
      const parsed = JSON.parse(body);
      systemPrompts.push(parsed.messages.find((m) => m.role === 'system')?.content ?? '');
      return send({
        id: 'test',
        object: 'chat.completion',
        created: 0,
        model: 'fake',
        choices: [{ index: 0, message: { role: 'assistant', content: '✅ 확인했어요.' }, finish_reason: 'stop' }],
      });
    }

    // --- 가짜 Teams Workflows 채널 게시(비동기 모드) ---
    if (req.url === '/teams-post') {
      postedText = body;
      onPosted?.();
      return send({ ok: true }, 202);
    }

    return send({ error: `unexpected ${req.method} ${req.url}` }, 404);
  });
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // gemini.js는 모듈 최상단에서 GEMINI_BASE_URL을 읽는다 — 반드시 import 전에 설정한다.
  setEnv('TMM_BASE_URL', base);
  setEnv('TMM_PASSWORD', 'pw');
  setEnv('GEMINI_API_KEY', 'test-key');
  setEnv('GEMINI_BASE_URL', `${base}/llm/`);
  setEnv('TEAMS_WEBHOOK_SECRET', SECRET);
  setEnv('TEAMS_INCOMING_WEBHOOK_URL', undefined); // 기본은 동기 모드
  ({ createWebhookHandler } = await import('../src/webhook.js'));
  handler = createWebhookHandler();
});

after(() => {
  server.close();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Teams가 보내는 것과 같은 모양의 요청을 만든다: 원문 바이트 + HMAC 서명 헤더.
function signedRequest(activity) {
  const rawBody = Buffer.from(JSON.stringify(activity));
  const signature = crypto.createHmac('sha256', Buffer.from(SECRET, 'base64')).update(rawBody).digest('base64');
  return {
    rawBody,
    body: JSON.parse(rawBody.toString('utf8')),
    headers: { authorization: `HMAC ${signature}` },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function post(activity) {
  const req = signedRequest(activity);
  const res = fakeRes();
  await handler(req, res);
  return res;
}

const speakerLine = (sys) => sys.split('\n').find((l) => l.startsWith('발화자'));
const lastSystem = () => systemPrompts.at(-1);

test('동기 경로: from.name이 모델이 받는 시스템 프롬프트의 발화자 줄까지 도달한다', async () => {
  systemPrompts.length = 0;
  const res = await post({
    type: 'message',
    id: 'e2e-sync-1',
    text: '커피 4,500원 기입해줘',
    from: { id: 'u1', name: '홍길동' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, '✅ 확인했어요.', '모델 응답이 그대로 회신돼야 진짜 경로를 탄 것이다');
  assert.equal(systemPrompts.length, 1, '가짜 Gemini가 실제로 호출돼야 한다');
  assert.equal(speakerLine(lastSystem()), '발화자(이 메시지를 보낸 사람): 홍길동');
  assert.ok(
    lastSystem().includes('발화자(이 메시지를 보낸 사람): 홍길동'),
    'webhook → runNlAgent → buildSystem 중 하나라도 speaker를 흘리면 여기서 깨진다',
  );
});

test('동기 경로: 표시명 형식이 달라도 같은 팀원으로 실린다', async () => {
  systemPrompts.length = 0;
  await post({
    type: 'message',
    id: 'e2e-sync-2',
    text: '커피 4,500원 기입해줘',
    from: { id: 'u2', name: '김철수 (Cheolsu Kim)' },
  });
  assert.equal(speakerLine(lastSystem()), '발화자(이 메시지를 보낸 사람): 김철수');
});

test('동기 경로: from.name이 없으면 (알 수 없음)으로 실린다 — 이름을 지어내지 않는다', async () => {
  systemPrompts.length = 0;
  await post({ type: 'message', id: 'e2e-sync-3', text: '커피 4,500원 기입해줘', from: { id: 'u3' } });
  assert.equal(speakerLine(lastSystem()), '발화자(이 메시지를 보낸 사람): (알 수 없음)');
});

// 비동기 모드(TEAMS_INCOMING_WEBHOOK_URL 설정)는 즉시 "접수" 응답을 내보내고 백그라운드로
// 이어간다. 이 분기는 runNlAgent 호출 인자가 동기 경로와 따로라 따로 못 박아야 한다.
test('비동기 경로: 사후 게시 모드에서도 발화자가 프롬프트에 실린다', async () => {
  systemPrompts.length = 0;
  postedText = null;
  const posted = new Promise((r) => {
    onPosted = r;
  });
  process.env.TEAMS_INCOMING_WEBHOOK_URL = `${process.env.TMM_BASE_URL}/teams-post`;
  try {
    const res = await post({
      type: 'message',
      id: 'e2e-async-1',
      text: '커피 4,500원 기입해줘',
      from: { id: 'u1', name: '홍길동 실장님' },
    });
    assert.match(res.payload.text, /접수했어요/, '비동기 모드는 먼저 접수 응답을 낸다');
    await posted; // 백그라운드 처리가 채널 게시까지 끝날 때까지 기다린다
  } finally {
    delete process.env.TEAMS_INCOMING_WEBHOOK_URL;
    onPosted = null;
  }

  assert.equal(systemPrompts.length, 1);
  assert.equal(speakerLine(lastSystem()), '발화자(이 메시지를 보낸 사람): 홍길동');
  assert.match(postedText, /확인했어요/, '결과가 채널에 게시된다');
});
