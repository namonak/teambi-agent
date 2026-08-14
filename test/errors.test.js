import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, llmUserMessage, serviceUserMessage } from '../src/errors.js';

// OpenAI/Anthropic SDK가 실제로 던지는 형태를 모사
const rateLimit = Object.assign(new Error('429 status code (no body)'), { status: 429 });
const overloaded = Object.assign(new Error('503 status code (no body)'), { status: 503 });
const timedOut = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
const unknown = new Error('socket hang up');

test('describeError: 상태 코드와 원문을 로그용으로 합친다', () => {
  assert.equal(describeError(rateLimit), 'HTTP 429 429 status code (no body)');
  assert.equal(describeError(timedOut), 'Request timed out.');
  assert.equal(describeError(unknown), 'socket hang up');
});

test('llmUserMessage: 429는 사용량 한도 안내', () => {
  const m = llmUserMessage(rateLimit);
  assert.match(m, /한도/);
  assert.doesNotMatch(m, /no body/); // 원문 노출 금지
});

test('llmUserMessage: 5xx는 일시적 불안정 안내 (429와 구분)', () => {
  const m = llmUserMessage(overloaded);
  assert.match(m, /일시/);
  assert.notEqual(m, llmUserMessage(rateLimit));
});

test('llmUserMessage: 타임아웃은 전용 안내', () => {
  const m = llmUserMessage(timedOut);
  assert.match(m, /시간/);
  assert.notEqual(m, llmUserMessage(overloaded));
});

test('llmUserMessage: 그 외는 일반 안내로 수렴하고 원문을 노출하지 않는다', () => {
  const m = llmUserMessage(unknown);
  assert.doesNotMatch(m, /socket hang up/);
});

test('serviceUserMessage: 상태 코드만 노출하고 원문은 감춘다', () => {
  const e = Object.assign(new Error('DB connection string leaked'), { status: 500 });
  const m = serviceUserMessage(e);
  assert.match(m, /HTTP 500/);
  assert.doesNotMatch(m, /leaked/);
});

test('serviceUserMessage: 상태 코드가 없으면 내부 정보 없이 일반 안내', () => {
  const m = serviceUserMessage(new Error('ECONNREFUSED 10.0.0.5:49876'));
  assert.doesNotMatch(m, /10\.0\.0\.5/);
});
