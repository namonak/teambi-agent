// util.js — 날짜/금액/설정 파싱 공용 유틸.
// 날짜는 서버 로컬 시간 기준(.env의 TZ=Asia/Seoul 전제) — teamMoneyManager와 동일 정책.
import { aliasKey } from './names.js';

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

// TEAMS_MEMBER_ALIASES="홍길동=홍실장,실장님;김철수=김팀장" →
//   { byKey: Map{'홍실장'→'홍길동','실장'→'홍길동','김팀장'→'김철수'},
//     labelsOf: Map{'홍길동'→['홍실장','실장님'], ...} }
// 팀원 명단·직책은 public repo에 둘 수 없어 .env로만 받는다(서버 스키마에 직책 필드가 없음).
// byKey는 해석용(공백 제거+끝 '님' 제거), labelsOf는 프롬프트 표시용이라 표기·순서를 보존한다.
// 이름·라벨은 시스템 프롬프트의 팀원 줄('- 홍길동: 잔액 … [호칭: …]')에 그대로 실린다.
// .env 값에 개행이 섞여 있으면 "- 규칙: …" 같은 가짜 줄을 프롬프트에 끼워 넣을 수 있어
// 발화자(webhook.speakerFromActivity)와 같은 방식으로 한 줄로 눕힌다.
const flatten = (s) => s.replace(/\s+/g, ' ').trim();

export function parseMemberAliases(str) {
  const byKey = new Map();
  const labelsOf = new Map();
  if (!str) return { byKey, labelsOf };
  for (const entry of String(str).split(';')) {
    // 첫 '='만 구분자로 본다 — split('=')이면 '홍길동=A=B'의 '=B'가 조용히 사라져
    // 운영자는 .env에 적은 별칭이 왜 안 먹는지 알 수 없다.
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const name = flatten(entry.slice(0, eq));
    const rawAliases = entry.slice(eq + 1);
    if (!name || !rawAliases) continue; // '이름=별칭' 형식이 아니면 조용히 건너뛴다
    const labels = labelsOf.get(name) ?? [];
    for (const raw of rawAliases.split(',')) {
      const label = flatten(raw);
      const key = aliasKey(label);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, name); // 같은 별칭이 겹치면 먼저 적은 쪽이 이긴다
      labels.push(label);
    }
    if (labels.length > 0) labelsOf.set(name, labels);
  }
  return { byKey, labelsOf };
}

export const cardLabel = (c) => (c === 1 ? '카드1' : c === 2 ? '카드2' : '카드 미지정');
