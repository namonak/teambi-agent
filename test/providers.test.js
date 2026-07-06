import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../src/providers/claude.js';
import * as gemini from '../src/providers/gemini.js';

const TOOL = {
  name: 'create_transaction',
  description: '지출 1건을 기입한다.',
  input_schema: {
    type: 'object',
    properties: { amount: { type: 'integer' } },
    required: ['amount'],
    additionalProperties: false,
  },
};

test('claude.toTools: Anthropic 포맷 그대로', () => {
  const t = claude.toTools([TOOL]);
  assert.equal(t[0].input_schema.type, 'object');
  assert.equal(t[0].name, 'create_transaction');
});

test('gemini.toTools: OpenAI function 포맷으로 변환', () => {
  const t = gemini.toTools([TOOL]);
  assert.equal(t[0].type, 'function');
  assert.equal(t[0].function.name, 'create_transaction');
  assert.deepEqual(t[0].function.parameters, TOOL.input_schema);
});

test('claude.initMessages: system은 messages에 넣지 않음', () => {
  const m = claude.initMessages('SYS', '안녕');
  assert.equal(m.length, 1);
  assert.equal(m[0].role, 'user');
});

test('gemini.initMessages: system을 첫 메시지로', () => {
  const m = gemini.initMessages('SYS', '안녕');
  assert.equal(m[0].role, 'system');
  assert.equal(m[0].content, 'SYS');
  assert.equal(m[1].role, 'user');
});

test('claude.appendToolResults: 하나의 user 메시지로 묶임 (병렬 도구 규칙)', () => {
  const messages = [];
  claude.appendToolResults(messages, [
    { id: 'a', content: 'r1', is_error: false },
    { id: 'b', content: 'r2', is_error: true },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content.length, 2);
  assert.equal(messages[0].content[0].type, 'tool_result');
  assert.equal(messages[0].content[1].is_error, true);
});

test('gemini.appendToolResults: tool_call_id별 개별 tool 메시지', () => {
  const messages = [];
  gemini.appendToolResults(messages, [
    { id: 'a', content: 'r1', is_error: false },
    { id: 'b', content: 'r2', is_error: true },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'tool');
  assert.equal(messages[0].tool_call_id, 'a');
  assert.equal(messages[1].tool_call_id, 'b');
});

test('configured: 키 없으면 false', () => {
  // 테스트 환경에는 두 키 모두 없음을 전제
  if (!process.env.ANTHROPIC_API_KEY) assert.equal(claude.configured(), false);
  if (!process.env.GEMINI_API_KEY) assert.equal(gemini.configured(), false);
});
