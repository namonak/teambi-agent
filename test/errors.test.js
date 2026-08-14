import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, llmUserMessage, serviceUserMessage, isConfigError } from '../src/errors.js';

// OpenAI/Anthropic SDK가 실제로 던지는 형태를 모사
const unauthorized = Object.assign(new Error('401 status code (no body)'), { status: 401 });
const forbidden = Object.assign(new Error('403 status code (no body)'), { status: 403 });
const rateLimit = Object.assign(new Error('429 status code (no body)'), { status: 429 });
const overloaded = Object.assign(new Error('503 status code (no body)'), { status: 503 });
const timedOut = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
const unknown = new Error('socket hang up');

// 상위 API가 오류 본문에 정답을 담아 보내는데 SDK 요약만 로그에 남기면 버려진다.
// 예: 404 → "models/xxx is not found for API version v1beta"
const notFoundWithBody = Object.assign(new Error('404 Not Found'), {
  status: 404,
  error: { code: 404, message: 'models/gemini-9.9-flash is not found for API version v1beta' },
});
// Anthropic SDK는 본문을 한 겹 더 감싼다
const anthropicShape = Object.assign(new Error('400 Bad Request'), {
  status: 400,
  error: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } },
});
// Google은 오류를 배열에 담아 보낸다: [{ "error": { "message": ... } }]
const googleArrayShape = Object.assign(new Error('404 status code (no body)'), {
  status: 404,
  error: [{ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users' } }],
});
// SDK가 이미 본문 메시지를 e.message에 넣어준 경우
const alreadyInMessage = Object.assign(new Error('400 max_tokens too large'), {
  status: 400,
  error: { message: 'max_tokens too large' },
});

test('describeError: 상태 코드와 원문을 로그용으로 합친다', () => {
  assert.equal(describeError(rateLimit), 'HTTP 429 429 status code (no body)');
  assert.equal(describeError(timedOut), 'Request timed out.');
  assert.equal(describeError(unknown), 'socket hang up');
});

test('describeError: 상위 API 오류 본문을 함께 남긴다', () => {
  assert.match(describeError(notFoundWithBody), /is not found for API version/);
  assert.match(describeError(notFoundWithBody), /HTTP 404/);
});

test('describeError: 본문이 한 겹 더 감싸인 형태도 꺼낸다', () => {
  assert.match(describeError(anthropicShape), /max_tokens too large/);
});

test('describeError: 배열로 감싼 본문에서도 메시지를 꺼낸다', () => {
  // 이 형태를 못 꺼내 404의 원인("no longer available to new users")을 한동안 놓쳤다
  assert.match(describeError(googleArrayShape), /no longer available to new users/);
});

test('배열 본문도 채널 회신에는 노출되지 않는다', () => {
  assert.doesNotMatch(llmUserMessage(googleArrayShape), /no longer available/);
});

test('describeError: 이미 message에 있으면 중복해서 붙이지 않는다', () => {
  const line = describeError(alreadyInMessage);
  assert.equal(line.match(/max_tokens too large/g).length, 1);
});

test('상위 API 본문은 로그에만 — 채널 회신에는 절대 나오지 않는다', () => {
  assert.doesNotMatch(llmUserMessage(notFoundWithBody), /is not found for API version/);
  assert.doesNotMatch(serviceUserMessage(notFoundWithBody), /is not found for API version/);
});

test('llmUserMessage: 429는 사용량 한도 안내', () => {
  const m = llmUserMessage(rateLimit);
  assert.match(m, /한도/);
  assert.doesNotMatch(m, /no body/); // 원문 노출 금지
});

test('llmUserMessage: 401/403은 설정 문제로 안내하고 재시도를 권하지 않는다', () => {
  // 인증 오류는 기다린다고 낫지 않는다. "잠시 후 다시" 안내는 사용자를 무한 재시도로 몰고,
  // 운영자는 설정 문제라는 신호를 놓친다.
  for (const e of [unauthorized, forbidden]) {
    const m = llmUserMessage(e);
    assert.match(m, /키|설정/, '무엇을 손봐야 하는지 알려야 한다');
    assert.doesNotMatch(m, /잠시 후|다시 시도/, '재시도를 권하면 안 된다');
    assert.doesNotMatch(m, /no body/);
  }
});

test('isConfigError: 401/403만 설정 오류로 분류한다 (로그 레벨 격상용)', () => {
  assert.equal(isConfigError(unauthorized), true);
  assert.equal(isConfigError(forbidden), true);
  assert.equal(isConfigError(rateLimit), false);
  assert.equal(isConfigError(timedOut), false);
  assert.equal(isConfigError(unknown), false);
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
