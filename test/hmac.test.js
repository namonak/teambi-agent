import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyTeamsHmac } from '../src/hmac.js';

const SECRET = crypto.randomBytes(32).toString('base64');

function sign(body, secret = SECRET) {
  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(body)
    .digest('base64');
  return `HMAC ${sig}`;
}

test('올바른 서명 → 통과', () => {
  const body = Buffer.from(JSON.stringify({ type: 'message', text: 'hi' }));
  assert.equal(verifyTeamsHmac(body, sign(body), SECRET), true);
});

test('본문 변조 → 거부', () => {
  const body = Buffer.from('{"text":"hi"}');
  const auth = sign(body);
  assert.equal(verifyTeamsHmac(Buffer.from('{"text":"hacked"}'), auth, SECRET), false);
});

test('다른 시크릿 서명 → 거부', () => {
  const body = Buffer.from('{"text":"hi"}');
  const other = crypto.randomBytes(32).toString('base64');
  assert.equal(verifyTeamsHmac(body, sign(body, other), SECRET), false);
});

test('시크릿 미설정 → 전부 거부 (fail-closed)', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyTeamsHmac(body, sign(body), ''), false);
  assert.equal(verifyTeamsHmac(body, sign(body), undefined), false);
});

test('Authorization 헤더 형식 오류 → 거부', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyTeamsHmac(body, 'Bearer abc', SECRET), false);
  assert.equal(verifyTeamsHmac(body, undefined, SECRET), false);
});
