// nl-agent.js — 자연어 명령 처리 (Claude tool-use 루프).
// Teams Outgoing Webhook은 5초 내 1회 응답만 가능하므로:
//   - 수신 시점 기준 4.2초 데드라인, 최대 3라운드
//   - 재시도 없음(llm.js: maxRetries 0), 남은 시간 < 700ms면 중단
//   - 타임아웃돼도 sideEffects로 "지금까지 처리된 것"을 정직하게 회신
import { getAnthropic, hasApiKey, MODEL } from './llm.js';
import { createToolkit } from './tools.js';
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
- 사용자가 카드를 말하지 않으면 card는 생략한다.
- 최종 답변은 채널에 그대로 표시된다. 2~4줄의 간결한 한국어로, 처리 결과(금액·카테고리·날짜)를 요약한다. 이모지 하나 정도는 좋다.`;
}

function sideEffectsSummary(sideEffects) {
  if (sideEffects.length === 0) return '';
  return `\n지금까지 처리된 것:\n${sideEffects.map((s) => `- ${s.action}: ${s.summary}`).join('\n')}`;
}

export async function runNlAgent(text, deadline) {
  if (!hasApiKey()) {
    return '🤖 자연어 명령은 서버에 ANTHROPIC_API_KEY 설정 후 사용할 수 있어요.\n카드 승인 문자를 그대로 붙여넣으면 바로 등록됩니다.';
  }

  const client = getAnthropic();
  let toolkit;
  try {
    toolkit = await createToolkit();
  } catch (e) {
    return `⚠️ teamMoneyManager 연결에 실패했어요: ${e.message}`;
  }

  const system = buildSystem(toolkit);
  const messages = [{ role: 'user', content: text }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = deadline - Date.now();
    if (remaining < 700) break;

    let resp;
    try {
      resp = await client.messages.create(
        { model: MODEL, max_tokens: 1024, system, tools: toolkit.tools, messages },
        { timeout: remaining },
      );
    } catch (e) {
      // API 오류/타임아웃 — 원시 에러를 채널에 노출하지 않는다
      console.warn('[nl-agent] Claude API 오류:', e?.status ?? '', e?.name ?? e?.message);
      return `😵 AI 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.${sideEffectsSummary(toolkit.sideEffects)}`;
    }

    if (resp.stop_reason !== 'tool_use') {
      const answer = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return answer || `✅ 처리했어요.${sideEffectsSummary(toolkit.sideEffects)}`;
    }

    // 모든 tool_use를 실행하고, tool_result는 하나의 user 메시지로 반환 (병렬 도구 규칙)
    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const { content, is_error } = await toolkit.run(block.name, block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, content, is_error });
    }
    messages.push({ role: 'user', content: results });
  }

  return `⏱️ 응답 시간이 초과됐어요.${sideEffectsSummary(toolkit.sideEffects) || ' 처리된 내역은 없습니다.'}\n웹에서 확인하거나 다시 시도해 주세요.`;
}
