// errors.js — 외부 호출 실패를 "로그용 문자열"과 "채널 회신 문구"로 매핑하는 단일 지점.
// 원칙: 원문 메시지는 채널에 절대 노출하지 않고(내부 정보 유출 방지) 로그에만 남긴다.
// 이 파일이 없던 시절 nl-agent/tools/webhook이 각자 분기를 들고 있어 문구가 어긋났다.

// 로그용 — 상태 코드가 있으면 앞에 붙이고 원문을 그대로 남긴다.
export function describeError(e) {
  const detail = e?.message ?? e?.name ?? String(e);
  return e?.status ? `HTTP ${e.status} ${detail}` : detail;
}

// SDK 타임아웃은 status가 없고 메시지/이름으로만 구분된다.
// (OpenAI SDK: APIConnectionTimeoutError 'Request timed out.')
const isTimeout = (e) => !e?.status && /timed?\s?out|timeout/i.test(`${e?.name ?? ''} ${e?.message ?? ''}`);

// LLM 호출 실패 → 채널 회신 문구
export function llmUserMessage(e) {
  if (e?.status === 429) {
    return '⏳ AI 사용량 한도에 걸렸어요. 잠시 후(분당 한도) 또는 내일(일일 한도) 다시 시도해 주세요.';
  }
  if (e?.status >= 500) return '🔧 AI 서비스가 일시적으로 불안정해요. 잠시 후 다시 시도해 주세요.';
  if (isTimeout(e)) return '⏱️ AI 응답이 제한 시간 안에 오지 않았어요. 다시 시도해 주세요.';
  return '😵 AI 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

// teamMoneyManager 등 외부 서비스 호출 실패 → 채널 회신 문구
export function serviceUserMessage(e) {
  return e?.status
    ? `외부 서비스 처리 중 오류가 발생했어요 (HTTP ${e.status})`
    : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
