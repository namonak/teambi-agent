// hmac.js — Teams Outgoing Webhook HMAC-SHA256 검증.
// Teams는 요청에 `Authorization: HMAC <base64서명>` 헤더를 붙인다.
// 서명 = HMAC-SHA256(요청 원문 바이트, base64디코드(웹훅 보안 토큰)).
import crypto from 'node:crypto';

export function verifyTeamsHmac(rawBody, authHeader, secretB64) {
  if (!secretB64) return false; // 시크릿 미설정 → 전부 거부(fail-closed)
  if (typeof authHeader !== 'string' || !authHeader.startsWith('HMAC ')) return false;
  if (!Buffer.isBuffer(rawBody)) return false;

  let expected;
  try {
    expected = crypto
      .createHmac('sha256', Buffer.from(secretB64, 'base64'))
      .update(rawBody)
      .digest();
  } catch {
    return false;
  }

  let given;
  try {
    given = Buffer.from(authHeader.slice(5).trim(), 'base64');
  } catch {
    return false;
  }

  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
