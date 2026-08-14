// version.js — 지금 도는 빌드가 무엇인지 식별하는 정보.
// Container Manager는 "재시작"이나 "중지 → 시작"으로 이미지가 갱신되지 않아
// 구버전이 계속 도는 사고가 잦다. 기동 로그 한 줄로 판단할 수 있어야 한다.
//
// build-info.json은 Dockerfile이 이미지 빌드 시점에 굽는다(COPY src 뒤에 두어
// 소스가 바뀌면 반드시 갱신된다). 로컬 실행에는 없으므로 없어도 동작해야 한다.
import { readFileSync } from 'node:fs';

const read = (path) => {
  try {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  } catch {
    return null; // build-info.json은 로컬 실행 시 정상적으로 없다
  }
};

export function versionInfo() {
  const pkg = read('../package.json') ?? {};
  const build = read('../build-info.json') ?? {};
  return {
    version: pkg.version ?? '0.0.0',
    gitSha: build.gitSha ?? '',
    buildTime: build.buildTime ?? '',
  };
}

export function formatVersionLine({ version, gitSha, buildTime }) {
  const parts = [`v${version}`];
  if (gitSha) parts.push(`커밋 ${gitSha.slice(0, 7)}`);
  parts.push(buildTime ? `빌드 ${buildTime}` : '로컬 실행');
  return parts.join(' · ');
}

export const versionLine = () => formatVersionLine(versionInfo());
