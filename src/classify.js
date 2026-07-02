// classify.js — 가맹점명 → 카테고리 분류 (3단계).
//   1) 키워드 규칙 (비용 0, 즉시)
//   2) Claude 폴백 (ANTHROPIC_API_KEY 설정 시, 단발 호출)
//   3) 기본값 (시간대 기반) + 회신에 자동추정 표시
// 카테고리 후보는 당월 실데이터(period_categories) 기준 — 없는 이름은 절대 만들지 않는다.
import { getAnthropic, MODEL } from './llm.js';

const RULES = [
  {
    name: '커피',
    words: [
      '커피', '카페', '스타벅스', '이디야', '투썸', '컴포즈', '메가엠지씨', '메가커피',
      '빽다방', '폴바셋', '할리스', '커피빈', '매머드', '테라로사', '블루보틀',
      '파스쿠찌', '엔제리너스', '더벤티', '공차', '스무디',
    ],
  },
  {
    name: '간식',
    words: [
      'GS25', '지에스25', 'CU', '씨유', '세븐일레븐', '이마트24', '미니스톱', '편의점',
      '파리바게', '뚜레쥬르', '베이커리', '던킨', '배스킨', '베스킨', '제과', '떡',
      '와플', '디저트', '마트', '다이소',
    ],
  },
  {
    // 저녁 시간대 + 술/고기집 계열 → 회식
    name: '회식',
    minTime: '17:00',
    words: [
      '고기', '갈비', '삼겹', '곱창', '족발', '보쌈', '횟집', '회관', '호프', '주점',
      '포차', '이자카야', '와인', '맥주', '치킨', '바베큐', '숯불', '오마카세',
    ],
  },
  {
    // 저녁 시간대 + 식사/배달 계열 → 야근 식대
    name: '야근',
    minTime: '17:00',
    words: [
      '배달의민족', '요기요', '쿠팡이츠', '김밥', '국밥', '버거', '맥도날드', '버거킹',
      '롯데리아', '서브웨이', '분식', '도시락', '덮밥', '국수', '식당', '샐러드', '포케',
      '피자', '중화', '짬뽕',
    ],
  },
];

// 1단계: 키워드 규칙. 매칭 실패 시 null.
export function classifyByKeywords(merchant, time, categoryNames) {
  if (!merchant) return null;
  const upper = merchant.toUpperCase();
  for (const rule of RULES) {
    if (!categoryNames.includes(rule.name)) continue;
    if (rule.minTime && time && time < rule.minTime) continue;
    if (rule.words.some((w) => upper.includes(w.toUpperCase()))) {
      return { name: rule.name, source: 'rule' };
    }
  }
  return null;
}

// 2단계: Claude 폴백 (키 없으면 null). 알려진 카테고리 이름만 허용.
export async function classifyWithClaude(merchant, time, amount, categoryNames) {
  const client = getAnthropic();
  if (!client || !merchant || categoryNames.length === 0) return null;
  try {
    const resp = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 64,
        system: `당신은 법인카드 지출 분류기다. 가맹점 정보를 보고 반드시 다음 중 하나의 카테고리 이름만 출력한다(다른 말 금지): ${categoryNames.join(', ')}`,
        messages: [
          { role: 'user', content: `가맹점: ${merchant}\n결제시각: ${time ?? '모름'}\n금액: ${amount}원` },
        ],
      },
      { timeout: 2500 },
    );
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const name = categoryNames.find((n) => text === n || text.includes(n));
    return name ? { name, source: 'llm' } : null;
  } catch {
    return null; // 분류 폴백 실패는 치명적이지 않음 → 3단계로
  }
}

// 3단계: 기본값 — 17시 이전 간식, 이후 야근 (해당 카테고리가 없으면 존재하는 것 중 선택)
export function defaultCategory(time, categoryNames) {
  if (categoryNames.length === 0) return null;
  const prefer = time && time >= '17:00' ? ['야근', '회식', '간식', '커피'] : ['간식', '커피', '야근', '회식'];
  const name = prefer.find((n) => categoryNames.includes(n)) ?? categoryNames[0];
  return { name, source: 'default' };
}

// 통합: 규칙 → LLM → 기본값
export async function classifyCategory(merchant, time, amount, categoryNames) {
  return (
    classifyByKeywords(merchant, time, categoryNames) ??
    (await classifyWithClaude(merchant, time, amount, categoryNames)) ??
    defaultCategory(time, categoryNames)
  );
}
