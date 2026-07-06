// server.js — 장부장(teambi-agent) 엔트리.
// Teams Outgoing Webhook 수신 서버. 데이터 조작은 전부 teamMoneyManager REST API 경유.
import express from 'express';
import { createWebhookHandler } from './webhook.js';
import { getProvider } from './llm.js';
import { notifyEnabled } from './teams-notify.js';

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
  const provider = getProvider();
  if (provider) console.log(`[teambi-agent] 🧠 자연어 처리: ${provider.name} (LLM_PROVIDER)`);
  else console.warn('[teambi-agent] ℹ️ LLM API 키 미설정 — 자연어 처리는 비활성(정형 SMS만 동작)');
  if (notifyEnabled()) console.log('[teambi-agent] 📮 자연어 비동기 모드: 즉시 접수 → Workflows 웹후크 사후 게시');
  else console.log('[teambi-agent] ℹ️ TEAMS_INCOMING_WEBHOOK_URL 미설정 — 자연어는 5초 동기 모드');
});
