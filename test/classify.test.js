import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByKeywords, defaultCategory } from '../src/classify.js';

const NAMES = ['야근', '커피', '간식', '회식'];

test('커피: 매머드익스프레스 → 커피', () => {
  const r = classifyByKeywords('매머드익스프레스 서초마제스타시티점', '12:56', NAMES);
  assert.equal(r?.name, '커피');
  assert.equal(r?.source, 'rule');
});

test('간식: GS25 → 간식', () => {
  assert.equal(classifyByKeywords('GS25 서초점', '15:00', NAMES)?.name, '간식');
});

test('회식: 저녁 고기집 → 회식', () => {
  assert.equal(classifyByKeywords('서초갈비', '19:30', NAMES)?.name, '회식');
});

test('회식 키워드라도 낮 시간이면 매칭 안 됨', () => {
  assert.equal(classifyByKeywords('서초갈비', '12:00', NAMES), null);
});

test('야근: 저녁 배달앱 → 야근', () => {
  assert.equal(classifyByKeywords('배달의민족', '20:10', NAMES)?.name, '야근');
});

test('당월에 없는 카테고리는 규칙에서 제외', () => {
  assert.equal(classifyByKeywords('스타벅스', '10:00', ['회식']), null);
});

test('기본값: 낮 → 간식, 저녁 → 야근', () => {
  assert.equal(defaultCategory('14:00', NAMES)?.name, '간식');
  assert.equal(defaultCategory('19:00', NAMES)?.name, '야근');
});

test('기본값: 선호 카테고리가 없으면 존재하는 것 중 선택', () => {
  assert.equal(defaultCategory('14:00', ['운영비'])?.name, '운영비');
});
