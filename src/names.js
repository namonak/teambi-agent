// names.js — 팀원 이름 참조의 정규화·매칭 (순수 함수, 네트워크 없음).
// teamMoneyManager 회원 스키마는 {id, name, birthday, active}뿐이라 직책·별칭 데이터가 없고
// 서버 수정은 프로젝트 규칙상 금지다. 그래서 "박실장님" 같은 호칭은 장부장 쪽에서
// 정규화로 벗겨 내고, 이름과 무관한 별칭은 .env(TEAMS_MEMBER_ALIASES)로 흡수한다.

// 끝에 붙는 직책. 길이가 긴 것을 앞에 둬야 '본부장'이 '부장'으로 잘리지 않는다.
// '이사원'처럼 직책으로 끝나는 실명은 정확 일치를 먼저 보므로 영향받지 않는다.
const TITLES = [
  '본부장', '실장', '팀장', '부장', '차장', '과장', '대리', '사원', '주임',
  '이사', '상무', '전무', '대표', '매니저', 'PM', 'PL', '프로', '선임', '책임', '수석',
];
const TITLE_RE = new RegExp(`(?:${TITLES.join('|')})$`, 'i');

// 별칭 키 — 공백 제거 + 끝 '님' 제거만 한다.
// 직책 자체가 별칭('실장님')일 수 있으므로 여기서는 직책을 벗기지 않는다.
export function aliasKey(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, '').replace(/님$/, '');
}

// 사람 참조 문자열 → 이름만 남긴 형태.
// '홍길동 실장님'→'홍길동', '홍길동 (Gildong Hong)'→'홍길동', '홍길동/BI팀'→'홍길동', '실장님'→''
// Teams from.name의 실제 형식이 환경마다 달라(표시명에 영문·부서가 붙는다) 넓게 흡수한다.
export function normalizeMemberRef(s) {
  if (typeof s !== 'string') return '';
  const stripped = s
    .replace(/[(（][^)）]*[)）]?/g, '') // 괄호 부가정보 (닫히지 않아도 제거)
    .replace(/[/|][\s\S]*$/, '') // '/'·'|' 이후 소속 표기
    .replace(/\s+/g, '');
  return stripped.replace(/님$/, '').replace(TITLE_RE, '').replace(/님$/, '');
}

// 참조 → 후보 팀원 배열(0·1·n건). 던지지 않는다 — 판단은 호출부(resolveByName)가 한다.
// 순서: 원문 정확 → 정규화 정확 → 별칭 → 정규화 양방향 부분 일치.
// 정확 일치를 앞에 두는 이유: 실명이 직책으로 끝나도('이사원') 원문이 먼저 이긴다.
export function matchMembers(members, ref, byKey = new Map()) {
  const list = members ?? [];
  const raw = typeof ref === 'string' ? ref : '';

  const exact = list.filter((m) => m.name === raw);
  if (exact.length > 0) return exact;

  const norm = normalizeMemberRef(raw);
  if (norm) {
    const normExact = list.filter((m) => normalizeMemberRef(m.name) === norm);
    if (normExact.length > 0) return normExact;
  }

  // 별칭은 '박 실장님'→'박실장'(공백 제거형)과 '박실장님'→'박'(정규화형) 양쪽 키로 찾는다.
  const aliasName = byKey.get(aliasKey(raw)) ?? (norm ? byKey.get(norm) : undefined);
  if (aliasName) {
    const byAlias = list.filter((m) => m.name === aliasName);
    if (byAlias.length > 0) return byAlias;
  }

  // 정규화 결과가 비면('실장님' 등 이름이 남지 않는 참조) 부분 일치는 건너뛴다.
  // 빈 문자열은 모든 이름에 포함되어 전원이 후보가 되기 때문이다.
  if (!norm) return [];
  return list.filter((m) => {
    const n = normalizeMemberRef(m.name);
    // 정규화 결과가 빈 이름은 건너뛴다 — 명단의 '(미지정)' 행이나 직책과 같은 이름('이사','PM')이
    // 그렇다. ''는 모든 참조에 포함돼(norm.includes('')) 전원 후보가 되는데, 하필 그 행 하나만
    // 걸리면 resolveByName이 모호 오류 없이 통과시켜 엉뚱한 사람에게 조용히 기입된다.
    return n !== '' && (n.includes(norm) || norm.includes(n));
  });
}
