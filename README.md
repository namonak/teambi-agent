# 장부장 (teambi-agent)

Teams **단체 채팅**에 앱을 설치한 뒤 @장부장으로 카드 승인 문자와 자연어 요청을 보내면 팀비 지출을 기록·수정·삭제하고 잔액을 알려주는 Bot 앱입니다. Node.js 22+가 필요합니다.

~~~
Teams 단체 채팅 ── @장부장 ──▶ Teams Bot (/api/messages) ──▶ teamMoneyManager REST API
~~~

카드 승인 SMS는 바로 결과를 답하고, 자연어 요청은 완료되면 같은 대화방에 결과를 보냅니다. 채널과 개인 채팅은 지원하지 않습니다.

## 설정과 실행

~~~
cp .env.example .env
~~~

.env에서 아래 값을 채웁니다.

| 변수 | 값 |
| --- | --- |
| TMM_BASE_URL, TMM_PASSWORD | teamMoneyManager 주소와 로그인 비밀번호 |
| MicrosoftAppId, MicrosoftAppPassword, MicrosoftAppTenantId | 아래 Teams Developer CLI 등록 명령이 자동으로 기록 |
| TEAMS_CARD_MAP | 선택. 예: 3900:1,2903:2 |
| TEAMS_MEMBER_ALIASES | 선택. 예: 홍길동=홍실장,실장님 |
| GEMINI_API_KEY 또는 OPENROUTER_API_KEY | 선택. 자연어 처리용 |

~~~
docker compose up -d --build
curl http://localhost:49877/health
~~~

HTTPS 프록시에서 /api/messages와 /health를 localhost:49877로 전달해야 합니다. 제공한 Caddy 예시를 쓴다면 deploy/Caddyfile.example의 도메인을 실제 주소로 바꾸면 됩니다.

## Teams Bot 앱 등록

`team-meal-bot`과 동일하게 Teams Developer CLI가 Bot 등록과 Microsoft 앱 자격 증명 생성을 처리합니다. 먼저 서버를 HTTPS 공개 주소에서 실행하고, 해당 주소의 `/api/messages`가 외부에서 접근되는지 확인하세요.

1. Teams Developer CLI를 설치하고 Microsoft 365 계정으로 로그인합니다.

   ~~~
   npm install -g @microsoft/teams.cli
   teams login
   teams status
   ~~~

   `teams status`의 `Sideloading`이 `enabled`여야 테스트 앱을 설치할 수 있습니다. `disabled`면 Microsoft 365 관리자에게 커스텀 앱 업로드 권한을 요청하세요.

2. 프로젝트 최상단에서 Bot을 등록합니다. 이 명령은 `.env`에 `MicrosoftAppId`, `MicrosoftAppPassword`, `MicrosoftAppTenantId`를 기록하고, Messaging endpoint를 연결합니다.

   ~~~
   teams app create \
     --name teambi-agent \
     --endpoint https://<공개-도메인>/api/messages \
     --env .env
   ~~~

   기존 `.env`에는 `TMM_BASE_URL`, `TMM_PASSWORD`, AI 키 등도 함께 채워 둡니다.

3. `appPackage/manifest.json`의 `validDomains`를 실제 공개 도메인으로 맞춥니다.
4. 앱 패키지를 만듭니다.

   ~~~
   bash scripts/package-teams-app.sh
   ~~~

5. 생성된 `dist/teambi-agent-YYYYMMDD-HHMMSS.zip`을 Teams Developer Portal에서 업로드하고, 사용할 단체 채팅에 앱을 추가합니다.
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

자연어 요청의 LLM 출력은 최대 256토큰으로 제한합니다. 팀비와 무관한 요청에는 도구를 호출하지 않고 아래의 짧은 안내만 응답합니다.

~~~
장부장은 teamMoneyManager 연동 팀비 관리만 도와드릴 수 있어요.
잔액 조회, 지출 등록·수정·삭제, 내역 확인을 말씀해 주세요.
~~~

## 잔액 조회

잔액 요청은 LLM이 말투와 대상을 해석한 뒤 `get_balance` 도구를 호출합니다. 실제 금액 계산과 최종 형식은 teamMoneyManager의 당월 수치로 서버에서 확정하므로 LLM이 합계를 계산하거나 결과를 다시 작성하지 않습니다. 따라서 `저의 잔액`, `잔액이 얼마에요?`처럼 다양한 표현도 처리하면서, LLM 호출은 의도 해석 한 번으로 끝납니다.

~~~
@장부장 잔액이 얼마입니까?
@장부장 커피 얼마나 남았어?
@장부장 최정님 잔액은?
~~~

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
