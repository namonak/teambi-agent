# 장부장 (teambi-agent)

Teams 단체 채팅에서 카드 승인 문자와 자연어 요청을 받아 팀비 지출을 기록·수정·삭제하고 잔액을 알려 주는 봇입니다.

- GitHub 저장소: [namonak/teambi-agent](https://github.com/namonak/teambi-agent)
- 운영 주소: `https://teambi-agent.namonak.dev`
- 구성: Node.js(ESM), Express 4, Microsoft Agents SDK, Docker Compose
- 연동 대상: teamMoneyManager REST API(팀비 장부 서버)
- 동작 범위: 단체 채팅만 지원합니다. 채널과 개인 채팅은 지원하지 않습니다.

```text
Teams 단체 채팅 → @장부장 → 장부장 서버(/api/messages) → teamMoneyManager REST API
```

## 사용 방법

Teams에서 `@장부장`을 입력한 뒤, 목록에 나오는 봇 멘션을 선택하고 요청을 함께 보내 주세요.

| 요청 | 처리 방식 |
| --- | --- |
| 카드 승인 문자 붙여넣기 | 정규식으로 바로 읽어 지출을 등록하고 즉시 답합니다. |
| 자연어 요청 (등록·수정·삭제·내역 확인) | AI가 해석해 처리하고, 완료되면 같은 대화방에 결과를 보냅니다. |
| 잔액 문의 | teamMoneyManager의 당월 수치로 서버에서 계산해 답합니다. |
| 팀비와 관계없는 요청 | 처리할 수 있는 일을 짧게 안내합니다. |

```text
@장부장 이번 달 커피 잔액 알려줘
@장부장 최정님 잔액은?
@장부장 실장님, 김철수 선임님 제외하고 모두 12,000원 개인사용했습니다.
```

### 잔액 조회

- AI는 말투와 대상만 해석해 `get_balance` 도구를 호출합니다. 금액 계산과 답변 형식은 서버가 정합니다.
- 「제 잔액」, 「잔액이 얼마에요?」처럼 표현이 달라도 처리하며, AI 호출은 의도 해석 한 번으로 끝납니다.
- 개인 잔액 답변 형식

  ```text
  🐣 홍길동 님
  - 할당량: 70,000원
  - 사용량: 42,500원
  - 잔액: 27,500원

  이번 달 개인 잔액을 알려 드립니다 💛
  ```

### 호칭과 제외 대상

- 호칭 설정: `TEAMS_MEMBER_ALIASES=홍길동=실장님,홍실장;김철수=팀장님,김팀장`처럼 적으면 「실장님」만 입력해도 홍길동으로 인식합니다.
- `=` 왼쪽 이름은 teamMoneyManager 활성 팀원 이름과 같아야 합니다.
- 호칭이 설정되지 않은 직책만 부르면 추측해서 기록하지 않고 이름을 다시 묻습니다.
- 「대상 제외하고 모두/전원/나머지」 요청은 활성 팀원 전체에서 해당 사람을 뺀 개인 지출로 등록합니다. 금액은 각 사람의 사용액으로 읽습니다.
- 제외 대상이 특정되지 않거나, 제외한 사람이 포함되거나, 남은 사람이 빠지거나, 같은 사람이 중복되면 저장 전에 막습니다.
- 이 검증은 위 문장 형식에만 적용됩니다. 제외 대상은 쉼표로 나열해서 입력해 주세요.

## 환경 설정

```bash
cp .env.example .env
```

| 환경 변수 | 값 |
| --- | --- |
| `PORT` | 서버 포트 (비우면 `49877`) |
| `TMM_BASE_URL`, `TMM_PASSWORD` | teamMoneyManager 주소와 로그인 비밀번호 |
| `MicrosoftAppId`, `MicrosoftAppPassword`, `MicrosoftAppTenantId` | Teams 봇 자격 증명. `teams app create --env .env`가 자동으로 기록합니다. 값이 없으면 `/api/messages`가 503을 반환합니다. |
| `LLM_PROVIDER` | `gemini`(기본값) 또는 `openrouter` |
| `GEMINI_API_KEY` 또는 `OPENROUTER_API_KEY` | 자연어 처리용 키 (필요할 때만) |
| `TEAMS_CARD_MAP` | 카드 문자 식별번호와 카드 슬롯 연결 (필요할 때만). 예: `3900:1,2903:2` |
| `TEAMS_MEMBER_ALIASES` | 호칭과 실제 이름 연결 (필요할 때만) |
| `TZ` | 시간대. 문자 날짜와 당월 판단 기준 |

- AI 키가 없어도 카드 승인 문자 읽기와 키워드 분류는 동작합니다.
- 자연어 요청의 AI 출력은 최대 256토큰으로 제한합니다.
- OpenRouter를 쓸 때는 아래처럼 설정해 주세요.

  ```dotenv
  LLM_PROVIDER=openrouter
  OPENROUTER_API_KEY=sk-or-v1-...
  OPENROUTER_MODEL=google/gemini-3.5-flash-lite
  OPENROUTER_REASONING_EFFORT=minimal
  ```

- 자연어 요청 내용(가맹점, 금액, 팀원 이름)은 AI 제공자에게 전송됩니다. Gemini 무료 사용량은 입력이 모델 학습에 쓰일 수 있고, OpenRouter는 여러 제공자로 요청을 보낼 수 있으니 회사 데이터 정책을 확인한 뒤 사용해 주세요.
- `.env`를 바꾼 뒤에는 컨테이너를 다시 만들어야 반영됩니다.

## 로컬 개발

준비물: Node 22 이상, npm, bash, zip, unzip

```bash
npm ci
npm test
npm run dev    # .env를 읽어 실행하고, 파일이 바뀌면 다시 시작합니다
```

Teams 없이 자연어 처리를 확인하려면 아래 명령을 실행해 주세요. 질문과 `speaker`(요청한 사람 이름, 「제 잔액」의 기준)를 바꿔 가며 확인할 수 있고, `@장부장`은 입력하지 않습니다.

```bash
node --env-file=.env --input-type=module <<'JS'
import { runNlAgent } from './src/nl-agent.js';

const reply = await runNlAgent(
  '제 잔액 알려주세요',
  Date.now() + 60000,
  { speaker: '홍길동', maxRounds: 5 },
);
console.log(reply);
JS
```

- 실제 `.env`를 쓰면 실제 AI와 장부 서버에 연결됩니다. 등록·수정·삭제 문장은 실제 데이터를 바꾸므로, 쓰기 확인은 테스트용 장부 서버에서 해 주세요.
- 이 방법은 Teams 멘션 수신, 인증, 화면 표시를 확인하지 않습니다.

## 보안 검사

`.github/workflows/security.yml`이 main 푸시, PR, 수동 실행, 매일 03:20 KST에 실행됩니다.

- 의존성 검사: 테스트 뒤 `npm audit --omit=dev --audit-level=moderate` 실행
- 이미지 검사: Docker 이미지를 빌드해 Trivy(컨테이너 이미지 취약점 검사 도구) v0.76.2로 수정 가능한 HIGH·CRITICAL 취약점 검사
- 차단 기준: 두 검사 중 하나라도 취약점을 찾으면 워크플로가 실패합니다.
- 운영 이미지: 실행에 쓰지 않는 npm과 npx를 삭제합니다. 컨테이너 안에서는 `node`만 사용해 주세요.
- Dependabot: GitHub 취약점 알림과 자동 보안 업데이트를 켜 두었습니다.

## 서버 배포

1. 저장소를 내려받고 `.env`를 설정합니다.

   ```bash
   git clone https://github.com/namonak/teambi-agent.git ~/workspace/teambi-agent
   cd ~/workspace/teambi-agent
   cp .env.example .env
   chmod 600 .env
   ```

2. 기본 `docker-compose.yml`은 49877 포트를 모든 주소에 엽니다. 같은 서버의 Caddy로만 받도록 `compose.server.yml`을 만들어 주세요. 이 파일은 서버에만 두며 Git에 올리지 않습니다.

   ```yaml
   services:
     teambi-agent:
       ports: !override
         - "127.0.0.1:49877:49877"
   ```

3. Caddyfile에 아래 설정을 추가하고, `caddy validate`로 검사한 뒤 `caddy reload`로 재시작 없이 반영합니다. HTTPS 인증서는 Caddy가 자동으로 발급하고 갱신합니다.

   ```caddyfile
   teambi-agent.namonak.dev {
       reverse_proxy 127.0.0.1:49877
   }
   ```

4. 실행하고 상태를 확인합니다. 루트 주소(`/`)는 페이지가 없어 404를 반환합니다.

   ```bash
   docker compose -f docker-compose.yml -f compose.server.yml up -d --build
   curl https://teambi-agent.namonak.dev/health
   ```

운영 기준

- 자동 실행: Compose의 `restart: unless-stopped`로 서버를 재부팅해도 다시 실행됩니다. 컨테이너 상태 검사(HEALTHCHECK)는 30초마다 `/health`를 확인합니다.
- 기동 로그에 커밋 해시를 남기려면 `GIT_SHA=$(git rev-parse HEAD)`를 앞에 붙여 실행해 주세요.
- Caddy를 함께 새로 띄우는 서버라면 `deploy/docker-compose.caddy.yml`과 `deploy/Caddyfile.example`을 사용할 수 있습니다.
- 도메인 변경 시 함께 바꿀 항목: DNS·Caddy, Teams 봇 메시지 엔드포인트, `appPackage/manifest.json`의 `validDomains`

코드나 `.env` 변경 반영

```bash
cd ~/workspace/teambi-agent
git pull --ff-only
docker compose -f docker-compose.yml -f compose.server.yml up -d --build --force-recreate
```

## Teams 앱 등록과 설치

1. Teams Developer CLI를 설치하고 Microsoft 365 계정으로 로그인합니다. `teams status`의 `Sideloading`이 `enabled`여야 앱을 설치할 수 있습니다. `disabled`이면 Microsoft 365 관리자에게 사용자 지정 앱 업로드 권한을 요청해 주세요.

   ```bash
   npm install -g @microsoft/teams.cli
   teams login
   teams status
   ```

2. 서버가 HTTPS로 공개된 상태에서 봇을 등록합니다. 이 명령은 `.env`에 Microsoft 앱 자격 증명을 기록하고 메시지 엔드포인트를 연결합니다.

   ```bash
   teams app create \
     --name teambi-agent \
     --endpoint https://teambi-agent.namonak.dev/api/messages \
     --env .env
   ```

3. ZIP을 만듭니다: `bash scripts/package-teams-app.sh`
4. Teams 앱 관리 화면에서 **사용자 지정 앱 업로드**로 `dist/teambi-agent-YYYYMMDD-HHMMSS.zip`을 올린 뒤 사용할 단체 채팅에 추가해 주세요.

- ZIP에는 앱 ID와 아이콘(`color.png`, `outline.png`)만 들어가고 비밀값은 들어가지 않습니다.
- 현재 manifest 버전: 1.0.1
- 업데이트: manifest의 `version`을 올리고 새 ZIP을 같은 방법으로 업로드해 주세요. 앱을 삭제하고 다시 설치할 필요는 없습니다.

## 운영 로그 전달

장부장은 별도 로그 파일 없이 표준 출력으로 기록합니다. 문제가 생기면 요청을 재현한 직후 운영 서버에서 아래 명령을 실행해 주세요. 명령을 실행한 폴더에 로그 파일이 만들어집니다.

```bash
docker logs --timestamps --since 30m teambi-agent > teambi-agent.log 2>&1
```

- 함께 전달할 내용: `teambi-agent.log`, 요청 시각(한국 시간), 실제 요청 문장, 기대한 대상과 실제 응답
- 오래된 문제는 `--since 30m`을 `--since 24h`처럼 늘려 주세요. 삭제하고 다시 만든 컨테이너의 이전 로그는 가져올 수 없습니다.
- 로그에는 발화자 해석과 오류만 남고 AI 도구 인자 전체는 남지 않습니다. 대상 누락 문제는 요청 문장과 실제 등록 결과가 있어야 확인할 수 있습니다.
- 로그에 비밀값이 있으면 가린 뒤 전달해 주세요. `.env`와 `.env.bak`는 전달하지 않습니다.
