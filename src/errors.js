// errors.js — 외부 호출 실패를 "로그용 문자열"과 "채널 회신 문구"로 매핑하는 단일 지점.
// 원칙: 원문 메시지는 채널에 절대 노출하지 않고(내부 정보 유출 방지) 로그에만 남긴다.
// 이 파일이 없던 시절 nl-agent/tools/webhook이 각자 분기를 들고 있어 문구가 어긋났다.

// 상위 API가 오류 본문에 정답을 담아 보낸다(예: "This model ... is no longer available
// to new users"). SDK 요약 메시지만 남기면 그 정답이 버려진다.
// 본문 모양이 제각각이라 세 가지를 모두 훑는다:
//   {message}                      — OpenAI 호환
//   {error:{message}}              — 한 겹 감싼 형태
//   [{error:{message}}]            — Google이 실제로 보내는 형태(배열)
const pick = (o) => o?.message ?? o?.error?.message ?? null;
const upstreamMessage = (e) => {
  const body = e?.error ?? e?.body;
  return pick(Array.isArray(body) ? body[0] : body);
};

// 로그용 — 상태 코드가 있으면 앞에 붙이고 원문을 그대로 남긴다.
// 여기서 나온 문자열은 로그 전용이다. 채널 회신에는 아래 두 함수만 쓴다.
export function describeError(e) {
  const detail = e?.message ?? e?.name ?? String(e);
  const head = e?.status ? `HTTP ${e.status} ${detail}` : detail;
  const upstream = upstreamMessage(e);
  return upstream && !detail.includes(upstream) ? `${head} — ${upstream}` : head;
}

// SDK 타임아웃은 status가 없고 메시지/이름으로만 구분된다.
// (OpenAI SDK: APIConnectionTimeoutError 'Request timed out.')
const isTimeout = (e) => !e?.status && /timed?\s?out|timeout/i.test(`${e?.name ?? ''} ${e?.message ?? ''}`);

// 키가 틀렸거나 권한이 없는 경우 — 기다려도 낫지 않으므로 재시도를 권하지 않고
// 로그도 error로 올려 운영자가 알아채게 한다.
export const isConfigError = (e) => e?.status === 401 || e?.status === 403;

// LLM 호출 실패 → 채널 회신 문구
export function llmUserMessage(e) {
  if (isConfigError(e)) {
    return '🔑 AI 서비스 인증에 실패했어요. 서버의 API 키 설정을 확인해 주세요.';
  }
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
