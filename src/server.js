// server.js — 장부장(teambi-agent) 엔트리.
// Teams Outgoing Webhook 수신 서버. 데이터 조작은 전부 teamMoneyManager REST API 경유.
import express from 'express';
import { createWebhookHandler } from './webhook.js';
import { providerStatus } from './llm.js';
import { notifyEnabled } from './teams-notify.js';
import { versionInfo, versionLine } from './version.js';

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

// 로그를 볼 수 없는 상황에서도 배포 반영 여부를 확인할 수 있도록 버전을 함께 노출한다
app.get('/health', (_req, res) => res.json({ ok: true, name: 'teambi-agent', ...versionInfo() }));

app.post('/webhook', createWebhookHandler());

// 프로세스 레벨 안전망 — 예기치 못한 예외로 컨테이너가 조용히 죽지 않도록 로그를 남긴다.
// (Docker restart:unless-stopped가 최종 복구망이므로 여기선 로깅을 우선한다)
process.on('unhandledRejection', (e) => console.error('[teambi-agent] unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('[teambi-agent] uncaughtException:', e));

const server = app.listen(PORT, () => {
  // 첫 줄에 고정 — 어떤 빌드가 도는지부터 확인할 수 있어야 한다
  console.log(`[teambi-agent] 🏷️ ${versionLine()}`);
  console.log(`[teambi-agent] 장부장 대기 중 — http://localhost:${PORT}`);
  if (!process.env.TEAMS_WEBHOOK_SECRET) console.warn('[teambi-agent] ⚠️ TEAMS_WEBHOOK_SECRET 미설정 — 모든 웹훅 요청이 401 처리됩니다');
  // 프로바이더 선택 결과를 그대로 드러낸다 — 조용한 폴백 때문에 원인 추적이 막혔던 적이 있다
  const llm = providerStatus();
  if (llm.dirty) console.warn(`[teambi-agent] ⚠️ LLM_PROVIDER 값에 공백/개행이 섞여 있어요: ${JSON.stringify(llm.requested)}`);
  if (!llm.known) console.warn(`[teambi-agent] ⚠️ LLM_PROVIDER='${llm.requested}' 는 알 수 없는 값 — ${llm.name}로 폴백합니다 (claude|gemini)`);
  for (const note of llm.config.notes) console.warn(`[teambi-agent] ⚠️ ${note}`);
  if (llm.configured) console.log(`[teambi-agent] 🧠 자연어 처리: ${llm.name} · 모델 ${llm.config.model}`);
  else console.warn(`[teambi-agent] ℹ️ ${llm.hint} 미설정 — 자연어 처리는 비활성(정형 SMS만 동작) [LLM_PROVIDER=${llm.name}]`);
  if (notifyEnabled()) console.log('[teambi-agent] 📮 자연어 비동기 모드: 즉시 접수 → Workflows 웹후크 사후 게시');
  else console.log('[teambi-agent] ℹ️ TEAMS_INCOMING_WEBHOOK_URL 미설정 — 자연어는 5초 동기 모드');
});

server.on('error', (e) => {
  console.error('[teambi-agent] 서버 시작 실패:', e.message);
  process.exit(1);
});
