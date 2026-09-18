// server.js — 장부장(teambi-agent) 엔트리.
// Teams Bot 수신 서버. 데이터 조작은 전부 teamMoneyManager REST API 경유.
import express from 'express';
import { authorizeJWT } from '@microsoft/agents-hosting';
import { createTeamsBot, teamsMessagesHandler } from './teams-bot.js';
import * as gemini from './gemini.js';
import * as tmm from './tmm-client.js';
import { describeError } from './errors.js';
import { versionInfo, versionLine } from './version.js';

const PORT = Number(process.env.PORT || 49877);

const app = express();

// 로그를 볼 수 없는 상황에서도 배포 반영 여부를 확인할 수 있도록 버전을 함께 노출한다
app.get('/health', (_req, res) => res.json({ ok: true, name: 'teambi-agent', ...versionInfo() }));

const teamsBot = createTeamsBot();
if (teamsBot) app.post('/api/messages', express.json(), authorizeJWT(teamsBot.auth), teamsMessagesHandler(teamsBot));
else app.post('/api/messages', (_req, res) => res.status(503).json({ error: 'Teams Bot 설정이 필요합니다.' }));

// 프로세스 레벨 안전망 — 예기치 못한 예외로 컨테이너가 조용히 죽지 않도록 로그를 남긴다.
// (Docker restart:unless-stopped가 최종 복구망이므로 여기선 로깅을 우선한다)
process.on('unhandledRejection', (e) => console.error('[teambi-agent] unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('[teambi-agent] uncaughtException:', e));

const server = app.listen(PORT, () => {
  // 첫 줄에 고정 — 어떤 빌드가 도는지부터 확인할 수 있어야 한다
  console.log(`[teambi-agent] 🏷️ ${versionLine()}`);
  console.log(`[teambi-agent] 장부장 대기 중 — http://localhost:${PORT}`);
  if (!teamsBot) console.warn('[teambi-agent] ⚠️ MicrosoftAppId 또는 MicrosoftAppPassword 미설정 — Teams Bot 요청을 받을 수 없습니다');
  // 실제 설정을 그대로 드러낸다 — 값이 오염돼도 조용히 넘어가면 원인 추적이 막힌다
  const llm = gemini.status();
  for (const note of llm.notes) console.warn(`[teambi-agent] ⚠️ ${note}`);
  if (llm.configured) console.log(`[teambi-agent] 🧠 자연어 처리: ${llm.name} · 모델 ${llm.model}`);
  else console.warn(`[teambi-agent] ℹ️ ${llm.hint} 미설정 — 자연어 처리는 비활성(정형 SMS만 동작)`);
  if (teamsBot) console.log('[teambi-agent] 🤖 Teams Bot: 그룹 채팅 멘션 수신 · 자연어 즉시 접수 → 사후 응답');

  // 세션 없는 첫 요청은 로그인 왕복까지 물어 준비에만 1.8초를 쓴다(측정값).
  // 첫 요청 지연을 줄이기 위해 미리 만들어 둔다.
  // 실패해도 기동은 계속한다 — 요청 시점에 다시 로그인한다.
  const warmStart = Date.now();
  tmm.warmUp().then(
    () => console.log(`[teambi-agent] 🔑 teamMoneyManager 세션 준비 완료 (${Date.now() - warmStart}ms)`),
    (e) => console.warn('[teambi-agent] ⚠️ teamMoneyManager 세션 준비 실패 — 첫 요청이 느려집니다:', describeError(e)),
  );
});

server.on('error', (e) => {
  console.error('[teambi-agent] 서버 시작 실패:', e.message);
  process.exit(1);
});
