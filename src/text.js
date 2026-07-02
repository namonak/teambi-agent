// text.js — Teams 메시지 텍스트 정제.
// Outgoing Webhook의 activity.text에는 봇 멘션(<at>장부장</at>)과
// (textFormat이 html인 경우) HTML 태그·엔티티가 섞여 온다.
export function extractUserText(activity) {
  let t = activity?.text ?? '';
  t = t.replace(/<at>.*?<\/at>/gis, ''); // 봇 멘션 제거
  t = t.replace(/<br\s*\/?>/gi, '\n'); // 개행 보존
  t = t.replace(/<\/(p|div)>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ''); // 잔여 태그 제거
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return t.replace(/\r\n/g, '\n').trim();
}
