// teams-notify.js — Teams 채널로 결과를 사후 게시 (Workflows 웹후크).
// Outgoing Webhook은 5초 내 1회 응답만 가능하므로, 느린 작업(자연어)은
// 즉시 "접수" 응답 후 여기로 최종 결과를 게시한다.
//
// 주의: 기존 O365 커넥터 방식 "수신 웹후크"는 2026-05 폐기됨.
// Teams의 Workflows 앱 템플릿 "웹후크 요청이 수신되면 채널에 게시"
// (Post to a channel when a webhook request is received)로 URL을 발급받아
// TEAMS_INCOMING_WEBHOOK_URL에 넣는다. 이 방식은 Adaptive Card 페이로드를 받는다.

export function notifyEnabled() {
  return Boolean(process.env.TEAMS_INCOMING_WEBHOOK_URL);
}

// 텍스트(개행 포함) → Workflows가 받는 Adaptive Card 메시지 페이로드
export function buildCardPayload(text) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: text.split('\n').map((line) => ({
            type: 'TextBlock',
            text: line === '' ? ' ' : line,
            wrap: true,
          })),
        },
      },
    ],
  };
}

export async function postToChannel(text) {
  const url = process.env.TEAMS_INCOMING_WEBHOOK_URL;
  if (!url) throw new Error('TEAMS_INCOMING_WEBHOOK_URL 미설정');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCardPayload(text)),
  });
  // Workflows는 보통 202 Accepted를 반환한다
  if (!res.ok) throw new Error(`채널 게시 실패 (HTTP ${res.status})`);
}
