# 장부장 (teambi-agent)

Teams **단체 채팅**에 앱을 설치한 뒤 @장부장으로 카드 승인 문자와 자연어 요청을 보내면 팀비 지출을 기록·수정·삭제하고 잔액을 알려주는 Bot 앱입니다.

~~~
Teams 단체 채팅 ── @장부장 ──▶ Teams Bot (/api/messages) ──▶ teamMoneyManager REST API
~~~

카드 승인 SMS는 바로 결과를 답하고, 자연어 요청은 먼저 접수한 뒤 같은 대화방에 완료 결과를 보냅니다. 채널과 개인 채팅은 지원하지 않습니다.

## 설정과 실행

~~~
cp .env.example .env
~~~

.env에서 아래 값을 채웁니다.

| 변수 | 값 |
| --- | --- |
| TMM_BASE_URL, TMM_PASSWORD | teamMoneyManager 주소와 로그인 비밀번호 |
| MicrosoftAppId | Teams Developer Portal에서 등록한 Bot 앱 ID |
| MicrosoftAppPassword | 해당 앱의 클라이언트 비밀값 |
| MicrosoftAppTenantId | Microsoft 365 테넌트 ID |
| PUBLIC_BASE_URL | Bot의 HTTPS 공개 주소. 예: https://bot.namonak.dev |
| TEAMS_CARD_MAP | 선택. 예: 3900:1,2903:2 |
| TEAMS_MEMBER_ALIASES | 선택. 예: 홍길동=홍실장,실장님 |
| GEMINI_API_KEY 또는 OPENROUTER_API_KEY | 선택. 자연어 처리용 |

~~~
docker compose up -d --build
curl http://localhost:49877/health
~~~

HTTPS 프록시에서 /api/messages와 /health를 localhost:49877로 전달해야 합니다. 제공한 Caddy 예시를 쓴다면 deploy/Caddyfile.example의 도메인을 실제 주소로 바꾸면 됩니다.

## Teams Bot 앱 등록

1. Teams Developer Portal에서 Bot 앱을 만들고 Messaging endpoint를 PUBLIC_BASE_URL/api/messages로 설정합니다.
2. 발급받은 앱 ID·비밀값·테넌트 ID를 .env에 넣고 컨테이너를 재생성합니다.
3. appPackage/manifest.json의 validDomains를 실제 공개 도메인으로 맞춥니다.
4. 앱 패키지를 만듭니다.

   ~~~
   bash scripts/package-teams-app.sh
   ~~~

5. 생성된 dist/teambi-agent-YYYYMMDD-HHMMSS.zip을 Teams에 업로드하고, 사용할 단체 채팅에 앱을 추가합니다.
6. 해당 대화방에서 @장부장 이번 달 커피 잔액 알려줘처럼 호출합니다.

color.png은 제공한 장부장 이미지, outline.png은 Teams 앱 목록용 단색 윤곽 아이콘입니다. ZIP에는 앱 ID와 아이콘만 들어가며 비밀값은 포함되지 않습니다.

## AI 설정

Gemini가 기본값입니다.

~~~dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=
~~~

OpenRouter를 쓰려면 다음처럼 설정합니다.

~~~dotenv
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=google/gemini-3.5-flash-lite
OPENROUTER_REASONING_EFFORT=minimal
~~~

API 키가 없어도 카드 승인 SMS의 정규식 파싱과 키워드 분류는 동작합니다.

## 개발

~~~
npm test
npm run dev
~~~

배포 코드나 .env를 바꾼 뒤에는 다음처럼 컨테이너를 다시 만듭니다.

~~~
docker compose down
docker compose up -d --build
~~~
