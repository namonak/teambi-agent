# Claude Code 개발 가이드

> 공통 규칙(Agent Delegation, 커밋 정책, Context DB 등)은 글로벌 설정(`~/.claude/CLAUDE.md`)을 따릅니다.
> 글로벌 미설치 시: `curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash`

---

## Slim 정책

이 파일은 **100줄 이하**를 유지한다. 새 지침 추가 시:
1. 매 턴 참조 필요 → 이 파일에 1줄 추가
2. 상세/예시/테이블 → ref-docs/*.md에 작성 후 여기서 참조
3. ref-docs 헤더: `# 제목 — 한 줄 설명` (모델이 첫 줄만 보고 필요 여부 판단)

---

## PROJECT

### 개요

**teambi-agent (장부장)** — Teams 채널의 카드 승인 SMS·자연어 메시지를 해석해 teamMoneyManager에 팀비 지출을 자동 기입/수정/삭제하는 AI Agent 봇

| 항목 | 값 |
|------|-----|
| 기술 스택 | Node.js 20+ (ESM), Express 4, LLM_PROVIDER=claude(@anthropic-ai/sdk, claude-haiku-4-5)\|gemini(openai SDK 경유) |
| 실행 방법 | `npm run dev` (개발) / `docker compose up -d` (배포, 포트 49877) |
| 테스트 | `npm test` (node:test — parser/classify/hmac/text/providers/teams-notify) |
| 연동 대상 | teamMoneyManager REST API (`TMM_BASE_URL`, 세션 쿠키 로그인) |
| 수신 경로 | Teams Outgoing Webhook `POST /webhook` (HMAC-SHA256 검증, 5초 응답 제한) |
| 상태 | 개발 중 |

### 문서 구조 (소유권 분리)

- **하니스 문서** (`claude/` 하위) — 🔒 dotclaude 소유. `dotclaude-update`가 덮어쓰니 **수정 금지**.
- **프로젝트 스펙** (`specs/` 하위) — 📝 자유롭게 작성. → [SDD 가이드라인](ref-docs/claude/sdd.md) · `/spec-guard`로 정합성 분석

### 하니스 상세 문서 (claude/)

- [Context DB](ref-docs/claude/context-db.md) — SQLite 기반 세션/태스크/결정 저장소
- [Context Monitor](ref-docs/claude/context-monitor.md) — HUD + compaction 감지/복구
- [Hooks](ref-docs/claude/hooks.md) — 5개 자동 실행 Hook 상세
- [컨벤션](ref-docs/claude/conventions.md) — 커밋, 주석, 로깅 규칙
- [셋업](ref-docs/claude/setup.md) — 새 환경 초기 설정
- [Agent Delegation](ref-docs/claude/agent-delegation.md) — 에이전트 위임/파이프라인 상세
- [SDD 가이드라인](ref-docs/claude/sdd.md) — 스펙 문서 작성/관리 규약

> 프로젝트 스펙은 `specs/`에 작성하고, 하니스 문서(`claude/`)는 건드리지 마세요.

### 핵심 규칙

- **비밀값 커밋 금지** — public repo. 비밀번호·API 키·웹훅 시크릿·내부 URL은 `.env`로만 관리 (`.env.example`에 placeholder만)
- **5초 응답 예산** — Teams Outgoing Webhook 제약. LLM 호출은 데드라인 가드(4.2s) 안에서만, SDK `maxRetries: 0`
- **teamMoneyManager 수정 금지** — 모든 데이터 조작은 REST API 경유 (당월만 기입 가능한 앱 정책 준수)
- **회신은 채널에 그대로 노출** — 사용자 대면 한국어 문구, 원시 에러 코드 노출 금지

---

*최종 업데이트: 2026-07-17*
