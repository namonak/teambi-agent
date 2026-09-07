// nl-agent.js — 자연어 명령 처리 (Gemini tool-use 루프).
// Teams Outgoing Webhook은 5초 내 1회 응답만 가능하므로:
//   - 수신 시점 기준 4.2초 데드라인, 최대 3라운드
//   - 재시도 없음(SDK maxRetries 0), 남은 시간 < 700ms면 중단
//   - 타임아웃돼도 sideEffects로 "지금까지 처리된 것"을 정직하게 회신
import * as gemini from './gemini.js';
import { createToolkit } from './tools.js';
import { matchMembers } from './names.js';
import { describeError, llmUserMessage, isConfigError } from './errors.js';
import { todayStr, fmtWon } from './util.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_ROUNDS = 3;

// 발화자(Teams from.name) → 프롬프트에 실을 한 줄.
// 목록에 없는 사람은 이름을 지어내지 말고 "없음"을 명시해야 1인칭 지출을 되묻게 된다.
export function speakerLineFor(toolkit, speaker) {
  if (!speaker) return '(알 수 없음)';
  const found = matchMembers(toolkit.members, speaker, toolkit.aliases);
  if (found.length === 1) return `${found[0].name}(id ${found[0].id})`;
  // 후보가 여럿인데 "목록에 없음"이라고 적으면 거짓말이다(성만 같은 동명 팀원 등).
  // 모델이 "없는 사람"으로 단정해 되묻기를 건너뛰지 않도록 모호함을 그대로 알린다.
  if (found.length > 1) return `${speaker} (팀원 여러 명과 일치 — 누구인지 확인 필요)`;
  return `${speaker} (팀원 목록에 없음)`;
}

// export하는 이유는 budgetSummary와 같다 — 프롬프트에 실제로 무엇이 실렸는지
// (특히 팀원별 개인 잔액·발화자) 테스트에서 직접 확인하기 위해서다.
export function buildSystem(toolkit, opts = {}) {
  const now = new Date();
  const catLines = toolkit.categories
    .map((c) => `- ${c.name}(id ${c.id}): 잔액 ${fmtWon(c.remaining)} / ${fmtWon(c.allocated)}`)
    .join('\n');
  // 개인 잔액(remaining)은 당월 dashboard에서만 병합된다. 없으면 이름만 적는다.
  // 별칭은 .env에 적힌 원문("실장님")을 그대로 보여 준다 — 내부 해석 키("실장")가 아니라.
  const memberLines = toolkit.members
    .map((m) => {
      const base =
        m.remaining == null
          ? `- ${m.name}(id ${m.id})`
          : `- ${m.name}(id ${m.id}): 잔액 ${fmtWon(m.remaining)} / ${fmtWon(m.allocation)}`;
      const labels = toolkit.aliasesOf?.(m.name) ?? [];
      return labels.length > 0 ? `${base} [호칭: ${labels.join(', ')}]` : base;
    })
    .join('\n');
  const speakerLine = speakerLineFor(toolkit, opts.speaker);
  return `당신은 팀비 관리 봇 "장부장"이다. Teams 채널 메시지를 해석해 teamMoneyManager에 지출을 기입/수정/삭제한다.

오늘: ${todayStr(now)} (${WEEKDAYS[now.getDay()]}) / 당월: ${toolkit.period}

당월 공용 카테고리(잔액):
${catLines || '- (없음)'}

활성 팀원(개인 잔액):
${memberLines || '- (없음)'}

발화자(이 메시지를 보낸 사람): ${speakerLine}

규칙:
- 위에 적은 공용 카테고리 잔액과 팀원별 개인 잔액은 이번 요청 시점의 최신 값이다. 잔액·팀원 질문은 공용·개인 모두 도구 없이 이 값으로 바로 답한다.
- list_categories는 기입/수정/삭제를 실행한 직후 갱신된 잔액을 확인할 때만 호출한다. 그 외에는 절대 부르지 마라.
- 조회 질문(내역 확인 등)은 필요한 도구를 첫 응답에서 병렬로 모두 호출하고, 결과를 받으면 추가 조회 없이 바로 최종 답변을 작성한다. 도구를 한 번에 하나씩 나눠 부르면 시간 안에 끝나지 않는다.
- 이 앱은 당월 지출만 기입/수정 가능하다. 지난달 요청이면 기입하지 말고 이유를 설명한다.
- "어제", "그저께" 같은 상대 날짜는 오늘 기준으로 해석한다.
- 수정/삭제는 반드시 list_recent_transactions로 대상을 특정한 뒤 실행한다. 특정이 안 되면 실행하지 말고 후보를 보여주며 되묻는다.
- 카테고리 이름의 지출(회식, 커피 등)은 kind=common, 특정 팀원 개인 지출은 kind=personal.
- 사용자가 카드를 말하지 않으면 card는 생략한다.
- "저/제가/나/내/제" 같은 1인칭은 발화자 본인이다. 발화자가 팀원 목록에 있으면 그 이름을 member_name에 넣는다.
- 발화자가 팀원 목록에 없거나 특정되지 않으면 1인칭 지출은 기입하지 말고 누구의 지출인지 되묻는다. 다른 팀원 이름으로 추측해 기입하지 마라.
- member_name에는 직책·호칭(실장님, 팀장님, ~님)을 빼고 팀원 목록의 이름 그대로 넣는다.
- [호칭]이 적힌 팀원은 그 호칭("실장님", "팀장님")으로 불려도 같은 사람이다. 호칭으로 물으면 목록의 이름과 잔액으로 답하고, 답변에서는 "홍길동 실장님"처럼 이름과 호칭을 함께 쓴다. 호칭이 어느 팀원인지 목록에 없으면 추측하지 말고 누구인지 되묻는다.
- 최종 답변은 채널에 그대로 표시된다. 2~4줄의 간결한 한국어로, 처리 결과(금액·카테고리·날짜)를 요약한다. 이모지 하나 정도는 좋다.`;
}

function sideEffectsSummary(sideEffects) {
  if (sideEffects.length === 0) return '';
  return `\n지금까지 처리된 것:\n${sideEffects.map((s) => `- ${s.action}: ${s.summary}`).join('\n')}`;
}

// 타임아웃 시 어느 구간이 예산을 먹었는지 로그 한 줄로 남긴다.
// 이게 없어서 컨테이너에 들어가 구간별로 재야 했다(범인은 createToolkit 1,858ms였다).
// 라운드 수만으로는 왜 더 필요했는지 알 수 없어 호출한 도구 이름도 싣는다.
// 인자 값은 담지 않는다 — 금액·가맹점이 로그에 남지 않도록.
export function budgetSummary(spent, remaining) {
  const trace = spent.calls?.length
    ? `${spent.rounds}라운드: ${spent.calls.map((names) => names.join('+')).join(' → ')}`
    : `${spent.rounds}라운드`;
  return (
    `준비 ${spent.toolkit}ms · LLM ${spent.llm}ms(${trace}) · ` +
    `도구 ${spent.tools}ms · 남은 시간 ${remaining}ms`
  );
}

// opts.maxRounds — 라운드 수 (기본 3; 비동기 모드에선 여유 있게)
// opts.speaker — Teams from.name. 1인칭("제가")을 누구로 볼지의 유일한 근거다.
export async function runNlAgent(text, deadline, opts = {}) {
  if (!gemini.configured()) return gemini.setupMessage();
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const spent = { toolkit: 0, llm: 0, tools: 0, rounds: 0, calls: [] };
  const since = (t) => Date.now() - t;

  let toolkit;
  const tToolkit = Date.now();
  try {
    toolkit = await createToolkit();
  } catch (e) {
    return `⚠️ teamMoneyManager 연결에 실패했어요: ${e.message}`;
  }
  spent.toolkit = since(tToolkit);

  // Teams from.name의 실제 형식이 환경마다 달라(영문 표시명·부서 접미 등) 해석 결과를
  // 요청당 1줄 남긴다. 본문·금액은 담지 않는다.
  console.info('[nl-agent] 발화자 해석: %s', speakerLineFor(toolkit, opts.speaker));

  const system = buildSystem(toolkit, { speaker: opts.speaker });
  const tools = gemini.toTools(toolkit.tools);
  const messages = gemini.initMessages(system, text);

  for (let round = 0; round < maxRounds; round++) {
    const remaining = deadline - Date.now();
    if (remaining < 700) break;

    let resp;
    const tLlm = Date.now();
    try {
      resp = await gemini.call({ system, messages, tools, timeout: remaining });
    } catch (e) {
      spent.llm += since(tLlm);
      // 원문은 채널에 노출하지 않고 로그에만 남긴다(어느 한도를 넘겼는지 등은 로그로 확인).
      // 설정 오류(401/403)는 저절로 낫지 않으니 error로 올려 눈에 띄게 한다.
      const log = isConfigError(e) ? console.error : console.warn;
      log('[nl-agent] gemini 호출 실패:', describeError(e));
      log(`[nl-agent] 예산 소진 — ${budgetSummary(spent, deadline - Date.now())}`);
      return `${llmUserMessage(e)}${sideEffectsSummary(toolkit.sideEffects)}`;
    }
    spent.llm += since(tLlm);
    spent.rounds += 1;

    if (!resp.isToolUse) {
      return resp.text || `✅ 처리했어요.${sideEffectsSummary(toolkit.sideEffects)}`;
    }

    spent.calls.push(resp.toolCalls.map((tc) => tc.name));

    gemini.appendAssistant(messages, resp.assistant);
    const results = [];
    const tTools = Date.now();
    for (const tc of resp.toolCalls) {
      const { content, is_error } = await toolkit.run(tc.name, tc.input);
      results.push({ id: tc.id, content, is_error });
    }
    spent.tools += since(tTools);
    gemini.appendToolResults(messages, results);
  }

  console.warn(`[nl-agent] 예산 소진 — ${budgetSummary(spent, deadline - Date.now())}`);
  if (toolkit.sideEffects.length > 0) {
    return `⏱️ 응답 시간이 초과됐어요.${sideEffectsSummary(toolkit.sideEffects)}\n⚠️ 위 내역은 이미 기입됐어요 — 같은 명령을 다시 보내면 중복 기입됩니다. 웹에서 확인해 주세요.`;
  }
  return '⏱️ 응답 시간이 초과됐어요. 처리된 내역은 없습니다.\n다시 시도해 주세요.';
}
