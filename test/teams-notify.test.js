import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardPayload, notifyEnabled } from '../src/teams-notify.js';

test('Adaptive Card 페이로드 구조 (Workflows 형식)', () => {
  const p = buildCardPayload('첫줄\n둘째줄');
  assert.equal(p.type, 'message');
  assert.equal(p.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const card = p.attachments[0].content;
  assert.equal(card.type, 'AdaptiveCard');
  assert.equal(card.body.length, 2);
  assert.equal(card.body[0].text, '첫줄');
  assert.equal(card.body[1].text, '둘째줄');
  assert.equal(card.body[0].wrap, true);
});

test('빈 줄은 공백 TextBlock으로 (렌더 누락 방지)', () => {
  const p = buildCardPayload('a\n\nb');
  assert.equal(p.attachments[0].content.body[1].text, ' ');
});

test('notifyEnabled: URL 없으면 false', () => {
  if (!process.env.TEAMS_INCOMING_WEBHOOK_URL) assert.equal(notifyEnabled(), false);
});
