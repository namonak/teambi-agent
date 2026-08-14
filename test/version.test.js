// version.test.js — 기동 로그에 찍히는 빌드 식별 정보.
// Container Manager는 "재시작"으로 이미지가 갱신되지 않아 구버전이 계속 도는 사고가 잦다.
// 로그 한 줄만 보고 어떤 빌드가 도는지 판단할 수 있어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVersionLine, versionInfo, versionLine } from '../src/version.js';

test('versionInfo: package.json의 버전을 읽는다', () => {
  const info = versionInfo();
  assert.match(info.version, /^\d+\.\d+\.\d+/);
});

test('formatVersionLine: 빌드 정보가 다 있으면 버전·커밋·빌드시각을 함께 낸다', () => {
  const line = formatVersionLine({
    version: '0.1.0',
    gitSha: 'aa9a543f0e1d2c3b4a59687',
    buildTime: '2026-08-14T05:30:00Z',
  });
  assert.match(line, /v0\.1\.0/);
  assert.match(line, /aa9a543/);
  assert.doesNotMatch(line, /f0e1d2c/, '커밋은 짧게 7자만');
  assert.match(line, /2026-08-14T05:30:00Z/);
});

test('formatVersionLine: 이미지 빌드 정보가 없으면 로컬 실행으로 표기', () => {
  const line = formatVersionLine({ version: '0.1.0', gitSha: '', buildTime: '' });
  assert.match(line, /v0\.1\.0/);
  assert.match(line, /로컬/);
});

test('formatVersionLine: 커밋만 없어도 빌드 시각은 그대로 낸다', () => {
  const line = formatVersionLine({ version: '0.1.0', gitSha: '', buildTime: '2026-08-14T05:30:00Z' });
  assert.match(line, /2026-08-14T05:30:00Z/);
  assert.doesNotMatch(line, /로컬/);
});

test('versionLine: 빌드 정보가 없어도 예외 없이 한 줄을 만든다', () => {
  assert.equal(typeof versionLine(), 'string');
  assert.ok(versionLine().length > 0);
});
