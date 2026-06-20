FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-bookworm AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone 산출물(서버 + 추적된 node_modules)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Copilot CLI 는 런타임에 동적으로 spawn 되므로 Next 파일 트레이싱이 잡지 못한다.
# CLI 로더와 리눅스 플랫폼 바이너리를 명시적으로 포함한다.
COPY --from=build /app/node_modules/@github ./node_modules/@github

# SDK 가 CLI 경로를 잘못 해석하는 문제를 우회(= npm-loader.js 명시).
ENV COPILOT_CLI_PATH=/app/node_modules/@github/copilot/npm-loader.js
# CLI 가 설정/캐시를 쓸 수 있는 디렉터리.
ENV COPILOT_HOME=/tmp/copilot

EXPOSE 3000
CMD ["node", "server.js"]