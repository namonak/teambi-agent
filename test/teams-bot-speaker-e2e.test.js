// Teams Bot의 자연어 처리에서도 from.name이 실제 LLM 프롬프트까지 이어지는지 확인한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let processor;
const systemPrompts = [];
const envBackup = {};
const setEnv = (k, v) => {
  envBackup[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const send = (obj, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=t; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith('/api/dashboard')) return send({
      categories: [{ id: 1, name: '커피', allocated: 200000, used: 72000, remaining: 128000 }],
      members: [{ member_id: 11, name: '홍길동', allocation: 180000, used: 52000, remaining: 128000, ratio: 0.288 }],
    });
    if (req.url.startsWith('/api/members')) return send({ members: [{ id: 11, name: '홍길동', active: 1 }] });
    if (req.url.endsWith('/chat/completions')) {
      const parsed = JSON.parse(body);
      systemPrompts.push(parsed.messages.find((message) => message.role === 'system')?.content ?? '');
      return send({
        id: 'test', object: 'chat.completion', created: 0, model: 'fake',
        choices: [{ index: 0, message: { role: 'assistant', content: '✅ 확인했어요.' }, finish_reason: 'stop' }],
      });
    }
    return send({ error: `unexpected ${req.method} ${req.url}` }, 404);
  });
});

before(async () => {
  server = server_;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  setEnv('TMM_BASE_URL', base);
  setEnv('TMM_PASSWORD', 'pw');
  setEnv('LLM_PROVIDER', 'gemini');
  setEnv('GEMINI_API_KEY', 'test-key');
  setEnv('GEMINI_BASE_URL', `${base}/llm/`);
  ({ createMessageProcessor: processor } = await import('../src/message-processor.js?case=teams-bot-speaker'));
  processor = processor();
});

after(() => {
  server.close();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const speakerLine = (system) => system.split('\n').find((line) => line.startsWith('발화자'));

async function followUpFor(activity) {
  const outcome = await processor({ type: 'message', ...activity });
  assert.match(outcome.reply, /접수했어요/);
  assert.equal(typeof outcome.followUp, 'function');
  return outcome.followUp();
}

test('Bot 사후 처리: from.name이 모델 프롬프트의 발화자 줄까지 도달한다', async () => {
  systemPrompts.length = 0;
  assert.equal(await followUpFor({ id: 'bot-speaker-1', text: '커피 4,500원 기입해줘', from: { id: 'u1', name: '홍길동' } }), '✅ 확인했어요.');
  assert.equal(speakerLine(systemPrompts.at(-1)), '발화자(이 메시지를 보낸 사람): 홍길동');
});

test('Bot 사후 처리: 표시명 형식이 달라도 같은 팀원으로 실린다', async () => {
  systemPrompts.length = 0;
  await followUpFor({ id: 'bot-speaker-2', text: '커피 4,500원 기입해줘', from: { id: 'u2', name: '홍길동 (Hong Gildong)' } });
  assert.equal(speakerLine(systemPrompts.at(-1)), '발화자(이 메시지를 보낸 사람): 홍길동');
});

test('Bot 사후 처리: from.name이 없으면 이름을 지어내지 않는다', async () => {
  systemPrompts.length = 0;
  await followUpFor({ id: 'bot-speaker-3', text: '커피 4,500원 기입해줘', from: { id: 'u3' } });
  assert.equal(speakerLine(systemPrompts.at(-1)), '발화자(이 메시지를 보낸 사람): (알 수 없음)');
});
