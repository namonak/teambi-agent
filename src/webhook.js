// webhook.js — Teams Outgoing Webhook 핸들러.
// HMAC 검증 → activity.id 중복 제거 → SMS/자연어 라우팅 → 한국어 회신.
// 회신은 항상 {type:'message', text} + HTTP 200 (HMAC 실패만 401).
import { verifyTeamsHmac } from './hmac.js';
import { extractUserText } from './text.js';
import { looksLikeCardSms, parseCardSms } from './sms-parser.js';
import { classifyCategory } from './classify.js';
import { runNlAgent } from './nl-agent.js';
import { notifyEnabled, postToChannel } from './teams-notify.js';
import * as tmm from './tmm-client.js';
import { currentPeriod, parseCardMap, fmtWon, fmtDateShort, cardLabel } from './util.js';

const DEADLINE_MS = 4200; // Teams 5초 제한 대비 응답 예산 (동기 모드)
const ASYNC_DEADLINE_MS = 25_000; // 비동기 모드(사후 게시) 처리 예산
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

const msg = (text) => ({ type: 'message', text });

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

  // 기입 후 잔액 조회 (실패해도 회신은 성공으로)
  let balanceLine = '';
  try {
    const d = await tmm.getDashboard(period);
    const c = d.categories.find((x) => x.id === category.id);
    if (c) balanceLine = `\n${c.name} 잔액: ${fmtWon(c.remaining)} / ${fmtWon(c.allocated)}`;
  } catch (e) { console.warn('[webhook] 잔액 조회 실패:', e.message); }

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
    let balanceLine = '';
    try {
      const d = await tmm.getDashboard(period);
      const c = d.categories.find((x) => x.id === target.period_category_id);
      if (c) balanceLine = `\n${c.name} 잔액: ${fmtWon(c.remaining)} / ${fmtWon(c.allocated)}`;
    } catch (e) { console.warn('[webhook] 잔액 조회 실패:', e.message); }
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

// --- 자연어 비동기 처리 (즉시 접수 응답 → 완료 후 Workflows 웹후크로 게시) ----
async function processNlAsync(text, requester) {
  let result;
  try {
    result = await runNlAgent(text, Date.now() + ASYNC_DEADLINE_MS, {
      maxRounds: ASYNC_MAX_ROUNDS,
      retry429: true,
    });
  } catch (e) {
    console.error('[webhook] 비동기 처리 오류:', e);
    result = '😵 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  }
  const quoted = text.replace(/\s+/g, ' ').slice(0, 40);
  const head = `📣 ${requester ? `${requester}님 ` : ''}요청 결과 — 「${quoted}${text.length > 40 ? '…' : ''}」`;
  try {
    await postToChannel(`${head}\n${result}`);
  } catch (e) {
    // 게시 실패해도 기입 자체는 완료됐을 수 있음 — 로그만 남긴다
    console.error('[webhook] 채널 게시 실패:', e.message);
  }
}

// --- 메인 핸들러 -----------------------------------------------------------
export function createWebhookHandler() {
  const cardMap = parseCardMap(process.env.TEAMS_CARD_MAP);

  return async function webhook(req, res) {
    // 1) HMAC 검증 (원문 바이트는 server.js의 express.json verify 훅이 보존)
    if (!verifyTeamsHmac(req.rawBody, req.headers.authorization, process.env.TEAMS_WEBHOOK_SECRET)) {
      console.warn('[webhook] HMAC 검증 실패');
      return res.status(401).json(msg('인증에 실패했어요. 웹훅 보안 토큰 설정을 확인해 주세요.'));
    }

    const activity = req.body ?? {};
    if (activity.type && activity.type !== 'message') return res.json(msg(''));

    // 2) 중복 제거 (Teams 타임아웃 재시도 대비)
    const id = activity.id;
    const seen = id ? dedupe.get(id) : undefined;
    if (seen?.state === 'done') return res.json(msg(seen.reply));
    if (seen?.state === 'inflight') return res.json(msg('⏳ 같은 메시지를 처리 중이에요…'));
    dedupeSet(id, { state: 'inflight' });

    const deadline = Date.now() + DEADLINE_MS;
    const text = extractUserText(activity);
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
      } else if (notifyEnabled()) {
        // 비동기 모드: 5초 제한을 피해 즉시 접수 응답, 결과는 채널에 사후 게시.
        // 처리 지속을 위해 응답을 먼저 보내고 백그라운드로 이어간다.
        reply = '⏳ 접수했어요! 처리가 끝나면 결과를 채널에 올릴게요.';
        dedupeSet(id, { state: 'done', reply });
        res.json(msg(reply));
        processNlAsync(text, activity.from?.name);
        return;
      } else {
        reply = await runNlAgent(text, deadline);
      }
    } catch (e) {
      console.error('[webhook] 처리 오류:', e);
      reply = `😵 처리 중 문제가 생겼어요: ${e.status ? `서버 응답 ${e.status}` : '내부 오류'}. 잠시 후 다시 시도해 주세요.`;
    }

    dedupeSet(id, { state: 'done', reply });
    return res.json(msg(reply));
  };
}
