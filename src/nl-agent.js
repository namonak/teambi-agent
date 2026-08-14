// nl-agent.js — 자연어 명령 처리 (LLM tool-use 루프, 프로바이더 중립).
// .env의 LLM_PROVIDER(claude|gemini)에 따라 llm.js가 고른 프로바이더로 동작한다.
// Teams Outgoing Webhook은 5초 내 1회 응답만 가능하므로:
//   - 수신 시점 기준 4.2초 데드라인, 최대 3라운드
//   - 재시도 없음(각 프로바이더 maxRetries 0), 남은 시간 < 700ms면 중단
//   - 타임아웃돼도 sideEffects로 "지금까지 처리된 것"을 정직하게 회신
import { getProvider, setupMessage } from './llm.js';
import { createToolkit } from './tools.js';
import { describeError, llmUserMessage, isConfigError } from './errors.js';
import { todayStr, fmtWon } from './util.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_ROUNDS = 3;

function buildSystem(toolkit) {
  const now = new Date();
  const catLines = toolkit.categories
    .map((c) => `- ${c.name}(id ${c.id}): 잔액 ${fmtWon(c.remaining)} / ${fmtWon(c.allocated)}`)
    .join('\n');
  const memberLine = toolkit.members.map((m) => `${m.name}(id ${m.id})`).join(', ');
  return `당신은 팀비 관리 봇 "장부장"이다. Teams 채널 메시지를 해석해 teamMoneyManager에 지출을 기입/수정/삭제한다.

오늘: ${todayStr(now)} (${WEEKDAYS[now.getDay()]}) / 당월: ${toolkit.period}

당월 공용 카테고리(잔액):
${catLines || '- (없음)'}

활성 팀원: ${memberLine || '(없음)'}

규칙:
- 이 앱은 당월 지출만 기입/수정 가능하다. 지난달 요청이면 기입하지 말고 이유를 설명한다.
- "어제", "그저께" 같은 상대 날짜는 오늘 기준으로 해석한다.
- 수정/삭제는 반드시 list_recent_transactions로 대상을 특정한 뒤 실행한다. 특정이 안 되면 실행하지 말고 후보를 보여주며 되묻는다.
- 카테고리 이름의 지출(회식, 커피 등)은 kind=common, 특정 팀원 개인 지출은 kind=personal.
- 여러 건을 기입해야 하면 create_transaction을 한 응답에서 여러 개 병렬로 호출한다(한 건씩 나눠 부르지 말 것).
- 사용자가 카드를 말하지 않으면 card는 생략한다.
- 최종 답변은 채널에 그대로 표시된다. 2~4줄의 간결한 한국어로, 처리 결과(금액·카테고리·날짜)를 요약한다. 이모지 하나 정도는 좋다.`;
}

function sideEffectsSummary(sideEffects) {
  if (sideEffects.length === 0) return '';
  return `\n지금까지 처리된 것:\n${sideEffects.map((s) => `- ${s.action}: ${s.summary}`).join('\n')}`;
}

// opts.maxRounds — 라운드 수 (기본 3; 비동기 모드에선 여유 있게)
export async function runNlAgent(text, deadline, opts = {}) {
  const provider = getProvider();
  if (!provider) return setupMessage();
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;

  let toolkit;
  try {
    toolkit = await createToolkit();
  } catch (e) {
    return `⚠️ teamMoneyManager 연결에 실패했어요: ${e.message}`;
  }

  const system = buildSystem(toolkit);
  const tools = provider.toTools(toolkit.tools);
  const messages = provider.initMessages(system, text);

  for (let round = 0; round < maxRounds; round++) {
    const remaining = deadline - Date.now();
    if (remaining < 700) break;

    let resp;
    try {
      resp = await provider.call({ system, messages, tools, timeout: remaining });
    } catch (e) {
      // 원문은 채널에 노출하지 않고 로그에만 남긴다(어느 한도를 넘겼는지 등은 로그로 확인).
      // 설정 오류(401/403)는 저절로 낫지 않으니 error로 올려 눈에 띄게 한다.
      const log = isConfigError(e) ? console.error : console.warn;
      log(`[nl-agent] ${provider.name} 호출 실패:`, describeError(e));
      return `${llmUserMessage(e)}${sideEffectsSummary(toolkit.sideEffects)}`;
    }

    if (!resp.isToolUse) {
      return resp.text || `✅ 처리했어요.${sideEffectsSummary(toolkit.sideEffects)}`;
    }

    provider.appendAssistant(messages, resp.assistant);
    const results = [];
    for (const tc of resp.toolCalls) {
      const { content, is_error } = await toolkit.run(tc.name, tc.input);
      results.push({ id: tc.id, content, is_error });
    }
    provider.appendToolResults(messages, results);
  }

  if (toolkit.sideEffects.length > 0) {
    return `⏱️ 응답 시간이 초과됐어요.${sideEffectsSummary(toolkit.sideEffects)}\n⚠️ 위 내역은 이미 기입됐어요 — 같은 명령을 다시 보내면 중복 기입됩니다. 웹에서 확인해 주세요.`;
  }
  return '⏱️ 응답 시간이 초과됐어요. 처리된 내역은 없습니다.\n다시 시도해 주세요.';
}
