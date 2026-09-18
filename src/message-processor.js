// message-processor.js — Teams 메시지 처리기.
// Activity 중복 제거 → SMS/자연어 라우팅 → 한국어 회신.
import { extractUserText } from './text.js';
import { looksLikeCardSms, parseCardSms } from './sms-parser.js';
import { classifyCategory } from './classify.js';
import { runNlAgent } from './nl-agent.js';
import { describeError, serviceUserMessage } from './errors.js';
import * as tmm from './tmm-client.js';
import { currentPeriod, parseCardMap, fmtWon, fmtDateShort, cardLabel } from './util.js';

const ASYNC_DEADLINE_MS = 25_000;
const ASYNC_MAX_ROUNDS = 6;
const DEDUPE_MAX = 300;
const DEDUPE_TTL_MS = 10 * 60 * 1000;

// activity.id → {state:'inflight'|'done', reply, at}
// Teams는 타임아웃 시 재시도하므로 중복 기입을 막는다.
const dedupe = new Map();

function dedupeSet(id, entry) {
  if (!id) return;
  dedupe.set(id, { ...entry, at: Date.now() });
  // LRU + TTL 정리
  for (const [k, v] of dedupe) {
    if (dedupe.size <= DEDUPE_MAX && Date.now() - v.at < DEDUPE_TTL_MS) break;
    dedupe.delete(k);
  }
}

// 회신 끝에 붙일 잔액 줄. 부가 정보이므로 실패해도 회신을 막지 않고 빈 문자열로 넘어간다.
// (조회 실패 이유는 로그로만 — 사용자는 기입/삭제가 성공했는지가 중요하다)
export async function balanceLineFor(period, categoryId) {
  try {
    const d = await tmm.getDashboard(period);
    const c = d.categories.find((x) => x.id === categoryId);
    return c ? `\n${c.name} 잔액: ${fmtWon(c.remaining)} / ${fmtWon(c.allocated)}` : '';
  } catch (e) {
    console.warn('[message-processor] 잔액 조회 실패:', describeError(e));
    return '';
  }
}

// --- SMS 승인 흐름 ---------------------------------------------------------
async function handleSmsApproval(parsed, cardMap) {
  const period = currentPeriod();
  if (parsed.date.slice(0, 7) !== period) {
    return (
      `⚠️ ${fmtDateShort(parsed.date)}은 지난달(${parsed.date.slice(0, 7)}) 지출이라 등록할 수 없어요.\n` +
      `이 앱은 당월 지출만 기록해요(지난달 마감 데이터 보호). 필요하면 웹에서 확인해 주세요.`
    );
  }

  const card = cardMap.get(parsed.cardDigits) ?? null;
  const { categories } = await tmm.getCategories(period);
  const names = categories.map((c) => c.name);
  const cls = await classifyCategory(parsed.merchant, parsed.time, parsed.amount, names);
  if (!cls) return '⚠️ 이번 달 카테고리가 없어 등록할 수 없어요. 웹에서 카테고리를 먼저 만들어 주세요.';
  const category = categories.find((c) => c.name === cls.name);

  const { transaction } = await tmm.createTransaction({
    date: parsed.date,
    amount: parsed.amount,
    kind: 'common',
    period_category_id: category.id,
    card,
    memo: parsed.merchant ?? null,
  });

  const balanceLine = await balanceLineFor(period, category.id);

  const notes = [];
  if (card === null && parsed.cardDigits) {
    notes.push(`⚠️ 카드번호(${parsed.cardDigits})가 등록돼 있지 않아 카드 미지정으로 기록했어요 (.env TEAMS_CARD_MAP 참고)`);
  }
  if (cls.source !== 'rule') {
    notes.push(`ℹ️ 분류: ${cls.name} (자동 추정) — 틀리면 "그거 ○○(으)로 바꿔줘"라고 말해 주세요`);
  }
  if (parsed.multiple) notes.push('⚠️ 문자 여러 건이 감지되어 첫 건만 등록했어요');
  if (parsed.installment && parsed.installment !== '일시불') notes.push(`ℹ️ 할부(${parsed.installment}) 결제예요`);

  return (
    `✅ 지출 등록 완료 (#${transaction.id})\n` +
    `${fmtDateShort(parsed.date)} · ${fmtWon(parsed.amount)} · ${cls.name} · ${cardLabel(card)}\n` +
    `가맹점: ${parsed.merchant ?? '(미확인)'}` +
    balanceLine +
    (notes.length ? `\n${notes.join('\n')}` : '')
  );
}

// --- SMS 승인취소 흐름 -----------------------------------------------------
// 당월 거래에서 금액(+카드, +가맹점 메모)이 일치하는 건을 찾아 정확히 1건이면 삭제.
async function handleSmsCancel(parsed, cardMap) {
  const period = currentPeriod();
  const card = cardMap.get(parsed.cardDigits) ?? null;
  const { transactions } = await tmm.listTransactions({ period });

  const byAmount = transactions.filter((t) => t.amount === parsed.amount);
  const byCard = card === null ? byAmount : byAmount.filter((t) => t.card === card || t.card === null);
  // 가맹점 메모까지 일치하면 최우선, 아니면 금액+카드 일치로 완화
  const byMemo = parsed.merchant ? byCard.filter((t) => t.memo && (t.memo.includes(parsed.merchant) || parsed.merchant.includes(t.memo))) : [];
  const candidates = byMemo.length > 0 ? byMemo : byCard;

  if (candidates.length === 1) {
    const target = candidates[0];
    await tmm.deleteTransaction(target.id);
    const balanceLine = await balanceLineFor(period, target.period_category_id);
    return (
      `↩️ 승인취소 처리: #${target.id} 삭제\n` +
      `${fmtDateShort(target.date)} · ${fmtWon(target.amount)} · ${target.category_name ?? target.member_name ?? ''}${target.memo ? ` · ${target.memo}` : ''}` +
      balanceLine
    );
  }

  if (candidates.length === 0) {
    return `❓ 승인취소 문자와 일치하는 지출(${fmtWon(parsed.amount)})을 당월에서 찾지 못했어요.\n웹에서 직접 확인해 주세요.`;
  }
  const list = candidates.slice(0, 3).map((t) => `- #${t.id} ${fmtDateShort(t.date)} ${fmtWon(t.amount)}${t.memo ? ` ${t.memo}` : ''}`).join('\n');
  return `⚠️ 승인취소 대상 후보가 ${candidates.length}건이라 자동 삭제하지 않았어요:\n${list}\n"#id 삭제해줘"라고 말하거나 웹에서 처리해 주세요.`;
}

// Teams activity의 발화자 표시명. 형식은 테넌트마다 다르므로(영문 표시명·부서 접미 등)
// 여기서는 형태만 다듬어 넘기고, 팀원 해석은 nl-agent(matchMembers)에 맡긴다.
// 이 값은 시스템 프롬프트에 그대로 실리므로 줄바꿈을 공백으로 눕히고 길이를 자른다 —
// 표시명에 개행이 들어오면 가짜 규칙 줄을 프롬프트에 끼워 넣을 수 있다.
const SPEAKER_MAX = 64;
export function speakerFromActivity(activity) {
  const name = activity?.from?.name;
  if (typeof name !== 'string') return null;
  const flat = name.replace(/\s+/g, ' ').trim();
  // 자르기는 코드포인트 단위로 한다 — slice는 UTF-16 코드 유닛을 자르므로 이모지가 섞인
  // 표시명에서 짝 잃은 서로게이트가 남고, 그 문자열이 실린 프롬프트를 400으로 거절하는
  // 게이트웨이가 있다(원인 파악이 어려운 실패다).
  const cut = [...flat].slice(0, SPEAKER_MAX).join('');
  return cut || null;
}

// --- 자연어 비동기 처리 ---------------------------------------------------
async function processNlAsync(text, speaker) {
  let result;
  try {
    result = await runNlAgent(text, Date.now() + ASYNC_DEADLINE_MS, { maxRounds: ASYNC_MAX_ROUNDS, speaker });
  } catch (e) {
    console.error('[message-processor] 비동기 처리 오류:', e);
    result = '😵 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  }
  return result;
}

// --- Teams Bot 메시지 처리 -------------------------------------------------
// 자연어는 즉시 접수 응답 뒤에 followUp으로 처리한다. Bot adapter가 그 결과를
// 원래 대화 참조로 능동 전송한다.
export function createMessageProcessor() {
  const cardMap = parseCardMap(process.env.TEAMS_CARD_MAP);

  return async function processActivity(activity = {}) {
    if (activity.type && activity.type !== 'message') return { reply: '' };

    // Teams 재시도 대비
    const id = activity.id;
    const seen = id ? dedupe.get(id) : undefined;
    if (seen?.state === 'done') return { reply: seen.reply };
    if (seen?.state === 'inflight') return { reply: '⏳ 같은 메시지를 처리 중이에요…' };
    dedupeSet(id, { state: 'inflight' });

    const text = extractUserText(activity);
    const speaker = speakerFromActivity(activity); // "제가"가 누구인지의 유일한 근거
    let reply;

    try {
      if (!text) {
        reply = '❓ 메시지가 비어 있어요. 카드 승인 문자를 붙여넣거나, "어제 회식 8만원 카드1"처럼 말해 주세요.';
      } else if (looksLikeCardSms(text)) {
        const parsed = parseCardSms(text);
        if (!parsed.ok) {
          reply =
            '❓ 카드 승인 문자를 인식하지 못했어요.\n문자 전체를 그대로 붙여넣거나, "어제 회식 8만원 카드1"처럼 말해 주세요.';
        } else if (parsed.txType === 'cancel') {
          reply = await handleSmsCancel(parsed, cardMap);
        } else {
          reply = await handleSmsApproval(parsed, cardMap);
        }
      } else {
        // Teams from.name의 실제 형식을 실서버 로그로 확정하기 위한 1줄(본문·금액은 남기지 않는다).
        console.info('[message-processor] 발화자 from.name=%j', speaker);
        reply = '⏳ 접수했어요! 처리가 끝나면 결과를 이 대화방에 알려드릴게요.';
        dedupeSet(id, { state: 'done', reply });
        return { reply, followUp: () => processNlAsync(text, speaker) };
      }
    } catch (e) {
      console.error('[message-processor] 처리 오류:', describeError(e));
      reply = `😵 ${serviceUserMessage(e)}`;
    }

    dedupeSet(id, { state: 'done', reply });
    return { reply };
  };
}
