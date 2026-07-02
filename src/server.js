// server.js — 장부장(teambi-agent) 엔트리.
// Teams Outgoing Webhook 수신 서버. 데이터 조작은 전부 teamMoneyManager REST API 경유.
import express from 'express';
import { createWebhookHandler } from './webhook.js';

const PORT = Number(process.env.PORT || 49877);

const app = express();

// HMAC 검증용 원문 바이트 보존 — JSON.stringify 재직렬화는 서명이 어긋나므로 금지
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.get('/health', (_req, res) => res.json({ ok: true, name: 'teambi-agent' }));

app.post('/webhook', createWebhookHandler());

app.listen(PORT, () => {
  console.log(`[teambi-agent] 장부장 대기 중 — http://localhost:${PORT}`);
  if (!process.env.TEAMS_WEBHOOK_SECRET) console.warn('[teambi-agent] ⚠️ TEAMS_WEBHOOK_SECRET 미설정 — 모든 웹훅 요청이 401 처리됩니다');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('[teambi-agent] ℹ️ ANTHROPIC_API_KEY 미설정 — 자연어 처리는 비활성(정형 SMS만 동작)');
});
