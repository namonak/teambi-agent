import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUserText } from '../src/text.js';

test('봇 멘션 제거', () => {
  assert.equal(extractUserText({ text: '<at>장부장</at> 어제 회식 8만원' }), '어제 회식 8만원');
});

test('HTML(br/div) → 개행 보존 + 태그 제거', () => {
  const t = extractUserText({ text: '<div><at>장부장</at> [Web발신]<br>BC바로(0904)승인<br>1,600원 일시불</div>' });
  assert.equal(t, '[Web발신]\nBC바로(0904)승인\n1,600원 일시불');
});

test('HTML 엔티티 복원', () => {
  assert.equal(extractUserText({ text: 'A&amp;B &lt;식당&gt;&nbsp;점심' }), 'A&B <식당> 점심');
});

test('빈/누락 text', () => {
  assert.equal(extractUserText({}), '');
  assert.equal(extractUserText(undefined), '');
});
