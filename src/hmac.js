// hmac.js — Teams Outgoing Webhook HMAC-SHA256 검증.
// Teams는 요청에 `Authorization: HMAC <base64서명>` 헤더를 붙인다.
// 서명 = HMAC-SHA256(요청 원문 바이트, base64디코드(웹훅 보안 토큰)).
import crypto from 'node:crypto';

// 실패 사유를 함께 돌려준다. 다섯 가지 실패는 대응이 전혀 다른데
// (프록시 설정 / Content-Type / 시크릿 재발급) 로그가 한 줄이면 구분할 수 없다.
// reason에는 시크릿·서명·본문을 절대 담지 않는다 — 분류만 남긴다.
export function checkTeamsHmac(rawBody, authHeader, secretB64) {
  const fail = (reason) => ({ ok: false, reason });

  if (!secretB64) return fail('TEAMS_WEBHOOK_SECRET 미설정 — 모든 요청을 거부합니다');
  if (typeof authHeader !== 'string' || !authHeader.startsWith('HMAC ')) {
    return fail('Authorization 헤더 없음 또는 HMAC 형식 아님 — 리버스 프록시가 헤더를 전달하는지 확인');
  }
  if (!Buffer.isBuffer(rawBody)) {
    return fail('요청 본문을 읽지 못함 — Content-Type이 application/json인지 확인');
  }

  let expected;
  try {
    expected = crypto.createHmac('sha256', Buffer.from(secretB64, 'base64')).update(rawBody).digest();
  } catch {
    return fail('TEAMS_WEBHOOK_SECRET이 base64가 아님');
  }

  let given;
  try {
    given = Buffer.from(authHeader.slice(5).trim(), 'base64');
  } catch {
    return fail('Authorization 헤더의 서명이 base64가 아님');
  }

  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  return ok
    ? { ok: true }
    : fail('서명 불일치 — TEAMS_WEBHOOK_SECRET 값이 Teams의 것과 같은지 확인');
}

export const verifyTeamsHmac = (rawBody, authHeader, secretB64) =>
  checkTeamsHmac(rawBody, authHeader, secretB64).ok;
