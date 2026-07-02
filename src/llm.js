// llm.js — Anthropic 클라이언트 싱글턴.
// Teams Outgoing Webhook의 5초 응답 예산 때문에 재시도 없이(maxRetries: 0) 사용한다.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

let client = null;

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic() {
  if (!hasApiKey()) return null;
  if (!client) client = new Anthropic({ maxRetries: 0 }); // 타임아웃은 호출별로 지정
  return client;
}
