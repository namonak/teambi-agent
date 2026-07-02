// sms-parser.js — 카드 승인 SMS 정규식 파서 (LLM 불필요).
// 지원 형식 예시:
//   [Web발신]
//   BC바로(0904)승인
//   법인
//   1,600원 일시불
//   06/29 12:56
//   매머드익스프레스 서초마제스타시티점
//   잔여한도1,760원

// 카드줄: "BC바로(0904)승인" / "BC바로(0904)승인취소" — 승인취소를 먼저 매칭
const CARD_LINE_RE = /^(.+?)\((\d{3,4})\)\s*(승인취소|승인)$/;
// 금액줄: "1,600원 일시불" / "-3,000원" / "120,000원 3개월" (할부)
const AMOUNT_RE = /^-?([\d,]+)\s*원(?:\s*(일시불|할부\s*\d*\s*개월|\d+\s*개월))?$/;
// 날짜줄: "06/29 12:56"
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;

const pad = (n) => String(n).padStart(2, '0');

// SMS 경로 감지: [Web발신] 포함 또는 카드 승인 패턴
export function looksLikeCardSms(text) {
  return /\[Web발신\]/.test(text) || /\(\d{3,4}\)\s*승인(취소)?/.test(text);
}

export function parseCardSms(text, now = new Date()) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const cardIdxs = lines
    .map((l, i) => (CARD_LINE_RE.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (cardIdxs.length === 0) return { ok: false, reason: 'no_card_line' };

  // 문자 여러 건을 한 번에 붙여넣은 경우: 첫 건만 파싱하고 표시
  const multiple = cardIdxs.length > 1;
  const block = lines.slice(cardIdxs[0], multiple ? cardIdxs[1] : lines.length);

  const [, cardName, cardDigits, approval] = block[0].match(CARD_LINE_RE);
  const txType = approval === '승인취소' ? 'cancel' : 'approval';

  let amount = null;
  let installment = null;
  let date = null;
  let time = null;
  let dateIdx = -1;

  block.forEach((line, i) => {
    if (line.startsWith('잔여한도')) return; // 잔여한도 줄을 금액으로 오인하지 않기
    if (amount === null) {
      const m = line.match(AMOUNT_RE);
      if (m) {
        amount = parseInt(m[1].replace(/,/g, ''), 10);
        installment = m[2] || null;
        return;
      }
    }
    if (date === null) {
      const m = line.match(DATE_RE);
      if (m) {
        const mo = Number(m[1]);
        const d = Number(m[2]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          // 연도 추론: 올해로 가정, 미래 날짜가 되면 작년 (연말 경계: 1/1에 12/31 문자)
          let year = now.getFullYear();
          if (new Date(year, mo - 1, d).getTime() - now.getTime() > 24 * 3600 * 1000) {
            year -= 1;
          }
          date = `${year}-${pad(mo)}-${pad(d)}`;
          time = `${pad(Number(m[3]))}:${m[4]}`;
          dateIdx = i;
        }
      }
    }
  });

  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'no_amount' }; // 외화승인 등 원화 금액줄 없음
  }
  if (!date) return { ok: false, reason: 'no_date' };

  // 가맹점: 날짜줄 다음의 첫 유효 줄 (잔여한도/금액/카드줄 제외)
  let merchant = null;
  for (let i = dateIdx + 1; i < block.length; i++) {
    const l = block[i];
    if (l.startsWith('잔여한도')) continue;
    if (AMOUNT_RE.test(l)) continue;
    if (CARD_LINE_RE.test(l)) continue;
    merchant = l;
    break;
  }

  return { ok: true, txType, cardName, cardDigits, amount, installment, date, time, merchant, multiple };
}
