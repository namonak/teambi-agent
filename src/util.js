// util.js — 날짜/금액/설정 파싱 공용 유틸.
// 날짜는 서버 로컬 시간 기준(.env의 TZ=Asia/Seoul 전제) — teamMoneyManager와 동일 정책.

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM' (당월)
export function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// 'YYYY-MM-DD' (오늘)
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 1600 → '1,600원'
export function fmtWon(n) {
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

// 'YYYY-MM-DD' → 'MM/DD'
export function fmtDateShort(date) {
  return date.slice(5).replace('-', '/');
}

// TEAMS_CARD_MAP="3900:1,2903:2" → Map { '3900' => 1, '2903' => 2 }
export function parseCardMap(str) {
  const map = new Map();
  if (!str) return map;
  for (const pair of str.split(',')) {
    const [digits, slot] = pair.split(':').map((s) => s.trim());
    const n = Number(slot);
    if (/^\d{3,4}$/.test(digits) && (n === 1 || n === 2)) map.set(digits, n);
  }
  return map;
}

export const cardLabel = (c) => (c === 1 ? '카드1' : c === 2 ? '카드2' : '카드 미지정');
