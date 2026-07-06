# 장부장 (teambi-agent)

Microsoft Teams 채널에 **카드 승인 문자를 붙여넣거나 자연어로 말하면**, 팀비 관리 웹앱([teamMoneyManager](https://github.com/leonardo204/teamMoneyManager) 계열의 REST API를 제공하는 앱)에 지출을 자동으로 **기입·수정·삭제**해 주는 AI Agent 봇입니다.

```
Teams 채널 ── @장부장 멘션 ──▶ teambi-agent ── REST API ──▶ teamMoneyManager
                (Outgoing Webhook, HMAC)      (세션 로그인)
```

## 사용 예시

**카드 승인 문자 붙여넣기** (AI 불필요 — 정규식 파싱, 즉시 등록):

> @장부장 [Web발신]
> BC바로(0904)승인
> 법인
> 1,600원 일시불
> 06/29 12:56
> 매머드익스프레스 서초마제스타시티점
> 잔여한도1,760원

봇 응답:

> ✅ 지출 등록 완료 (#123)
> 06/29 · 1,600원 · 커피 · 카드1
> 가맹점: 매머드익스프레스 서초마제스타시티점
> 커피 잔액: 43,400원 / 210,000원

**자연어** (Claude 또는 Gemini API 키 설정 시 — 아래 [AI 프로바이더](#ai-프로바이더-claude--gemini) 참조):

> @장부장 어제 회식 8만원 카드1로 썼어
> @장부장 아까 그 커피 1,600원짜리 2,000원으로 수정해줘
> @장부장 이번 달 커피 얼마 남았어?

**승인취소 문자**를 붙여넣으면 일치하는 지출 1건을 찾아 자동 삭제합니다(후보가 여럿이면 자동 삭제하지 않고 후보를 보여줍니다).

## 동작 방식

| 입력 | 처리 | AI 필요 |
|---|---|---|
| 카드 승인 SMS | 정규식 파싱 → 키워드 분류(커피/간식/회식/야근) → 즉시 기입 | ❌ (분류 애매할 때만 폴백) |
| 승인취소 SMS | 금액+카드+가맹점 매칭 → 1건이면 자동 삭제 | ❌ |
| 자연어 | LLM tool-use 루프(Claude/Gemini 선택) — 조회/기입/수정/삭제 도구 6종 | ✅ |

- **teamMoneyManager는 수정하지 않습니다.** 모든 조작은 기존 REST API(`/api/transactions` 등)로 수행합니다.
- Teams Outgoing Webhook의 **HMAC-SHA256 서명을 검증**하고, 재시도로 인한 **중복 기입을 방지**(activity.id 기준)합니다.
- Teams의 **5초 응답 제한**에 맞춰 AI 호출은 4.2초 데드라인 안에서만 수행하고, 타임아웃 시에도 처리된 내역을 정직하게 회신합니다.

## 설치

### 1. 설정

```bash
cp .env.example .env
# .env를 열어 값 입력:
#   TMM_BASE_URL      teamMoneyManager 주소 (같은 서버면 http://localhost:49876)
#   TMM_PASSWORD      teamMoneyManager 로그인 비밀번호
#   TEAMS_CARD_MAP    카드 문자 식별번호 → 카드슬롯 매핑 (예: 3900:1,2903:2)
#   ANTHROPIC_API_KEY (선택) 자연어 처리용 — console.anthropic.com에서 발급
#   TEAMS_WEBHOOK_SECRET  아래 3단계에서 발급받아 입력
```

### 2. 실행

```bash
# Docker (권장)
docker compose up -d --build

# 또는 로컬
npm install
npm run dev
```

`GET /health`로 기동 확인: `curl http://localhost:49877/health`

### 3. Teams Outgoing Webhook 등록

1. Teams → 대상 팀 → ⋯ → **팀 관리 → 앱 → 발신 웹후크 만들기** (Create an outgoing webhook)
2. 이름 `장부장`, 콜백 URL `https://<공개주소>/webhook` 입력 → 만들기
3. 생성 직후 **1회만 표시되는 보안 토큰**을 복사해 `.env`의 `TEAMS_WEBHOOK_SECRET`에 저장 → 재시작
4. 채널에서 `@장부장 <문자 붙여넣기 또는 자연어>`로 사용

> **공개 주소**: Teams가 이 서버로 직접 POST하므로 `/webhook`이 HTTPS로 인터넷에서 접근 가능해야 합니다.
>
> **장부장은 teamMoneyManager와 같은 서버에 둘 필요가 없습니다.** 인바운드(Teams → 장부장)만 본인이 통제하는 HTTPS 주소면 되고, 아웃바운드(장부장 → teamMoneyManager)는 `TMM_BASE_URL`로 공개 주소를 호출할 뿐입니다. 따라서 **본인 소유 도메인**(예: `bot.joannes.kr`)에 장부장만 올리고, `.env`에서 `TMM_BASE_URL=https://<teamMoneyManager 공개주소>` 로 가리키면 됩니다.
>
공개 HTTPS 주소를 붙이는 방법은 환경에 따라 둘 중 하나:

**A) 이미 리버스 프록시가 있는 경우 (Synology NAS, Nginx 등)** — 권장. 새 웹서버를 띄우지 말고 기존 프록시에 경로만 추가한다.

- 루트 `docker-compose.yml`로 장부장만 기동(호스트 49877 포트 노출):
  ```bash
  docker compose up -d --build
  ```
- 리버스 프록시에서 `bot.joannes.kr` → `localhost:49877` 로 전달.
  - **Synology DSM**: 제어판 → 로그인 포털 → 고급 → 리버스 프록시 → 생성
    - 소스: HTTPS / `bot.joannes.kr` / 443
    - 대상: HTTP / `localhost` / 49877
    - (`bot.joannes.kr` 인증서가 이미 있으면 그대로 물린다. `Authorization` 헤더는 그대로 전달되어 HMAC 검증 정상 동작.)

**B) 프록시가 없는 빈 서버** — [`deploy/`](deploy/)의 Caddy 예시로 자동 HTTPS까지 한 번에:
```bash
cp deploy/Caddyfile.example deploy/Caddyfile   # 도메인 수정
docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d --build
```
Caddy가 Let's Encrypt 인증서를 자동 발급한다. (80/443 포트가 비어 있어야 함.)

어느 쪽이든 Teams 웹훅 콜백 URL은 `https://bot.joannes.kr/webhook`.

### 4. (선택·권장) 자연어 비동기 모드 — Workflows 웹후크

Outgoing Webhook은 **5초 내 1회 응답**만 허용해서, 자연어 다건 등록이나 느린 AI 응답은 시간이 부족할 수 있습니다. Teams **Workflows 웹후크**를 연결하면 자연어 요청에 "⏳ 접수했어요"로 즉답하고, 실제 결과(최대 25초 처리, 무료 티어 429 자동 재시도 포함)를 채널에 따로 게시합니다.

1. Teams에서 결과를 올릴 **채널 이름 옆 ⋯ → 워크플로**(Workflows) 클릭
2. 템플릿 검색: **"웹후크 요청이 수신되면 채널에 게시"** (Post to a channel when a webhook request is received) → 선택
3. 팀/채널 확인 → **흐름 추가** → 생성된 **HTTP POST URL 복사**
4. `.env`의 `TEAMS_INCOMING_WEBHOOK_URL=`에 붙여넣고 컨테이너 재생성(`docker compose down && docker compose up -d`)

> - 기존 O365 커넥터 방식 "수신 웹후크"는 **2026년 5월 폐기**됐습니다 — 반드시 Workflows 앱으로 만드세요.
> - 사후 게시 메시지는 Teams 정책상 "Workflows(Flow bot)" 이름으로 표시됩니다(장부장 이름/아이콘 커스텀 불가).
> - **사후 게시는 원 메시지의 스레드(답장)가 아니라 채널의 새 글로 올라옵니다.** 스레드 답장 UX가 더 중요하면 이 모드를 끄고(URL 비우기) 동기 모드로 쓰세요 — 동기 모드도 다건 병렬 기입 유도가 적용되어 3~4건까지는 대부분 5초 안에 처리됩니다.
> - 미설정 시 기존처럼 5초 동기 모드로 동작합니다. 카드 SMS 기입은 어차피 빨라서 항상 즉답합니다.

## 제약 사항 (Teams Outgoing Webhook)

- 봇을 **@멘션한 메시지에만** 반응합니다 (채널 전용, 개인 채팅 불가)
- **5초 내 1회 응답** 제한 — 자연어는 위 4번(비동기 모드)으로 우회 가능
- 더 나은 UX(멘션 불필요, 버튼 카드, 능동 알림)가 필요하면 Azure Bot Service 기반 정식 봇으로 업그레이드하는 경로가 있습니다

## 개발

```bash
npm test          # 단위 테스트 (파서/분류/HMAC/텍스트 정제)
npm run dev       # watch 모드
```

```
src/
├── server.js      # Express 엔트리 (POST /webhook, GET /health)
├── webhook.js     # HMAC 검증 → 중복제거 → SMS/자연어 라우팅 → 회신
├── hmac.js        # Teams HMAC-SHA256 검증
├── text.js        # 멘션/HTML 정제
├── sms-parser.js  # 카드 SMS 정규식 파서
├── classify.js    # 카테고리 분류 (키워드 → LLM 폴백 → 기본값)
├── nl-agent.js    # LLM tool-use 루프 (동기 4.2s / 비동기 25s, 프로바이더 중립)
├── llm.js         # 프로바이더 선택기 (LLM_PROVIDER=claude|gemini)
├── teams-notify.js# Workflows 웹후크 사후 게시 (Adaptive Card)
├── providers/
│   ├── claude.js  # Anthropic Messages API
│   └── gemini.js  # Gemini (OpenAI 호환 엔드포인트)
├── tools.js       # LLM 도구 6종
├── tmm-client.js  # teamMoneyManager REST 클라이언트
└── util.js        # 날짜/금액/설정 유틸
```

## AI 프로바이더 (Claude / Gemini)

자연어 처리와 분류 폴백에 쓸 LLM을 `.env`의 `LLM_PROVIDER`로 선택합니다:

```
LLM_PROVIDER=claude   # 기본값. ANTHROPIC_API_KEY 필요
LLM_PROVIDER=gemini   # GEMINI_API_KEY 필요 (OpenAI 호환 엔드포인트 경유)
```

| | Claude (기본) | Gemini |
|---|---|---|
| 모델 | `claude-haiku-4-5` (`ANTHROPIC_MODEL`로 변경) | `gemini-2.5-flash` (`GEMINI_MODEL`로 변경) |
| 키 발급 | [console.anthropic.com](https://console.anthropic.com) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| 비용 | 유료 — 팀 사용량 기준 **월 몇백 원** | **무료 티어 있음** (카드 등록 불필요, 예: 15 RPM · 1,000 RPD) |
| 데이터 | 학습에 사용 안 함 | ⚠️ **무료 티어는 입력·출력이 Google 제품 개선(학습)에 사용될 수 있음** — 가맹점명·금액·팀원 이름이 전송되므로 회사 데이터 정책 확인 후 사용 |

프로바이더를 바꾸면 컨테이너를 **재생성**해야 적용됩니다: `docker compose down && docker compose up -d`

## 비용

카드 문자 기입은 대부분 키워드 분류로 처리되어 **API 호출이 발생하지 않습니다**. LLM이 쓰이는 것은 자연어 명령과 분류가 애매한 소수 케이스뿐이라, Claude 기준 월 몇백 원 수준이며 Gemini 무료 티어로는 0원까지 가능합니다(위 데이터 정책 주의).
