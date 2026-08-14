// hmac-reason.test.js — HMAC 검증 실패 사유 구분.
// 실패 5가지는 대응이 전혀 다르다(프록시 설정 / Content-Type / 시크릿 재발급).
// 로그에 사유가 안 남으면 어디를 봐야 할지 알 수 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkTeamsHmac, verifyTeamsHmac } from '../src/hmac.js';

const SECRET = crypto.randomBytes(32).toString('base64');
const BODY = Buffer.from('{"type":"message","text":"hi"}');

const sign = (body, secret = SECRET) =>
  `HMAC ${crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(body).digest('base64')}`;

test('정상 서명 → ok, 사유 없음', () => {
  const r = checkTeamsHmac(BODY, sign(BODY), SECRET);
  assert.equal(r.ok, true);
  assert.equal(r.reason, undefined);
});

test('시크릿 미설정 → 전용 사유', () => {
  const r = checkTeamsHmac(BODY, sign(BODY), '');
  assert.equal(r.ok, false);
  assert.match(r.reason, /TEAMS_WEBHOOK_SECRET.*미설정|미설정.*TEAMS_WEBHOOK_SECRET/);
});

test('Authorization 헤더 없음 → 전용 사유', () => {
  const r = checkTeamsHmac(BODY, undefined, SECRET);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Authorization/);
});

test('본문을 읽지 못함 → Content-Type을 지목', () => {
  // express.json이 파싱하지 않으면 req.rawBody가 undefined가 된다
  const r = checkTeamsHmac(undefined, sign(BODY), SECRET);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Content-Type/);
});

test('서명 불일치 → 시크릿 값을 지목', () => {
  const other = crypto.randomBytes(32).toString('base64');
  const r = checkTeamsHmac(BODY, sign(BODY, other), SECRET);
  assert.equal(r.ok, false);
  assert.match(r.reason, /서명 불일치/);
  assert.match(r.reason, /TEAMS_WEBHOOK_SECRET/);
});

test('본문 변조 → 서명 불일치로 분류', () => {
  const r = checkTeamsHmac(Buffer.from('{"text":"hacked"}'), sign(BODY), SECRET);
  assert.equal(r.ok, false);
  assert.match(r.reason, /서명 불일치/);
});

test('사유 문자열에 시크릿·서명·본문이 새지 않는다', () => {
  const other = crypto.randomBytes(32).toString('base64');
  const auth = sign(BODY, other);
  for (const r of [
    checkTeamsHmac(BODY, auth, SECRET),
    checkTeamsHmac(BODY, undefined, SECRET),
    checkTeamsHmac(undefined, auth, SECRET),
  ]) {
    assert.doesNotMatch(r.reason, /hi/, '본문 내용 노출 금지');
    assert.ok(!r.reason.includes(SECRET), '시크릿 노출 금지');
    assert.ok(!r.reason.includes(auth.slice(5)), '서명 노출 금지');
  }
});

test('verifyTeamsHmac는 기존대로 boolean을 반환한다 (호환)', () => {
  assert.equal(verifyTeamsHmac(BODY, sign(BODY), SECRET), true);
  assert.equal(verifyTeamsHmac(BODY, 'Bearer abc', SECRET), false);
});
