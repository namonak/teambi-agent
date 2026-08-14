FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# 기동 로그에 찍을 빌드 식별 정보를 굽는다.
# COPY src 뒤에 두어야 소스가 바뀔 때 캐시가 깨지고 빌드 시각이 갱신된다.
# GIT_SHA는 선택 — 넘기지 않으면 빌드 시각만으로 식별한다.
ARG GIT_SHA=
RUN printf '{"gitSha":"%s","buildTime":"%s"}\n' \
      "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /app/build-info.json

ENV NODE_ENV=production
EXPOSE 49877

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||49877)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
