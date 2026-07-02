import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCardSms, parseCardSms } from '../src/sms-parser.js';

const NOW = new Date(2026, 6, 2); // 2026-07-02

const SAMPLE = `[Web발신]
BC바로(0904)승인
법인
1,600원 일시불
06/29 12:56
매머드익스프레스 서초마제스타시티점
잔여한도1,760원`;

test('감지: [Web발신] 문자', () => {
  assert.equal(looksLikeCardSms(SAMPLE), true);
});

test('감지: 자연어는 SMS 아님', () => {
  assert.equal(looksLikeCardSms('어제 회식 8만원 카드1로 썼어'), false);
});

test('기본 승인 문자 파싱', () => {
  const p = parseCardSms(SAMPLE, NOW);
  assert.equal(p.ok, true);
  assert.equal(p.txType, 'approval');
  assert.equal(p.cardName, 'BC바로');
  assert.equal(p.cardDigits, '0904');
  assert.equal(p.amount, 1600);
  assert.equal(p.date, '2026-06-29');
  assert.equal(p.time, '12:56');
  assert.equal(p.merchant, '매머드익스프레스 서초마제스타시티점');
  assert.equal(p.multiple, false);
});

test('잔여한도 줄을 금액으로 오인하지 않음', () => {
  const p = parseCardSms(SAMPLE, NOW);
  assert.equal(p.amount, 1600); // 1,760이 아님
});

test('승인취소 문자', () => {
  const sms = SAMPLE.replace('승인', '승인취소');
  const p = parseCardSms(sms, NOW);
  assert.equal(p.ok, true);
  assert.equal(p.txType, 'cancel');
  assert.equal(p.amount, 1600);
});

test('할부 문자', () => {
  const sms = SAMPLE.replace('1,600원 일시불', '120,000원 3개월');
  const p = parseCardSms(sms, NOW);
  assert.equal(p.ok, true);
  assert.equal(p.amount, 120000);
  assert.match(p.installment, /3\s*개월/);
});

test('외화승인(원화 금액줄 없음) → 인식 실패', () => {
  const sms = `[Web발신]\nBC바로(0904)승인\nUSD 12.50\n06/29 12:56\nAMAZON.COM`;
  const p = parseCardSms(sms, NOW);
  assert.equal(p.ok, false);
  assert.equal(p.reason, 'no_amount');
});

test('연말 경계: 1/1에 12/31 문자 → 작년으로 해석', () => {
  const jan1 = new Date(2027, 0, 1);
  const sms = SAMPLE.replace('06/29 12:56', '12/31 21:10');
  const p = parseCardSms(sms, jan1);
  assert.equal(p.date, '2026-12-31');
});

test('문자 여러 건 붙여넣기 → 첫 건만 + multiple 표시', () => {
  const sms = `${SAMPLE}\n[Web발신]\nBC바로(0904)승인\n법인\n5,000원 일시불\n06/30 09:00\n스타벅스 서초점\n잔여한도1,000원`;
  const p = parseCardSms(sms, NOW);
  assert.equal(p.ok, true);
  assert.equal(p.amount, 1600);
  assert.equal(p.multiple, true);
});

test('카드줄 없음 → 실패', () => {
  const p = parseCardSms('[Web발신]\n그냥 광고 문자입니다', NOW);
  assert.equal(p.ok, false);
  assert.equal(p.reason, 'no_card_line');
});
