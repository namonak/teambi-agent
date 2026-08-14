// gemini-thought-signature.test.js — 도구 루프에서 thought signature 왕복.
//
// Gemini 3는 thinking을 끌 수 없고, 응답의 extra_content.google.thought_signature에
// 추론 맥락을 담아 보낸다. 공식 문서: "You MUST always resend all thought blocks
// exactly as they were received from the model."
// 이 서명을 다음 라운드에 그대로 돌려주지 않으면 여러 라운드짜리 도구 호출에서
// 추론 맥락이 끊긴다. 지금은 응답 메시지 객체를 통째로 되돌려줘서 보존되는데,
// 메시지를 부분 조립하도록 바꾸면 조용히 깨지므로 여기서 고정한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const SIGNATURE = 'SIG-ABC123';
const received = [];
let server;
let gemini;

const server_ = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'list_categories', arguments: '{}' } },
              ],
              extra_content: { google: { thought_signature: SIGNATURE } },
            },
          },
        ],
      }),
    );
  });
});

before(async () => {
  server = server_;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  gemini = await import('../src/gemini.js');
});

after(() => server.close());

test('도구 루프 다음 라운드에 thought signature를 그대로 되돌려준다', async () => {
  received.length = 0;
  const messages = gemini.initMessages('SYS', '팀원별 잔액 알려줘');

  const round1 = await gemini.call({ messages, tools: [], timeout: 5000 });
  assert.equal(round1.isToolUse, true);
  assert.equal(
    round1.assistant?.extra_content?.google?.thought_signature,
    SIGNATURE,
    '응답에서 서명을 잃지 않아야 한다',
  );

  gemini.appendAssistant(messages, round1.assistant);
  gemini.appendToolResults(messages, [{ id: 'c1', content: '[]', is_error: false }]);
  await gemini.call({ messages, tools: [], timeout: 5000 });

  const sent = received.at(-1).messages.find((m) => m.role === 'assistant');
  assert.ok(sent, '2라운드 요청에 assistant 메시지가 실려야 한다');
  assert.equal(
    sent.extra_content?.google?.thought_signature,
    SIGNATURE,
    '서명을 그대로 되돌려주지 않으면 추론 맥락이 끊긴다',
  );
  assert.equal(sent.tool_calls[0].id, 'c1', 'tool_call도 함께 보존되어야 한다');
});
