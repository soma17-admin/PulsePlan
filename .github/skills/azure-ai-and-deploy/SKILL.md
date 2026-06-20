---
name: azure-ai-and-deploy
description: 모델 계층을 Azure AI Foundry/Azure OpenAI로 구동하고 PulsePlan을 Azure에 배포할 때 반드시 사용한다. Foundry 모델 배포·Copilot SDK BYOK 연결, Azure Container Apps/azd 배포, Dockerfile, Key Vault 시크릿, 관리 ID(Azure MCP 인증), Cosmos DB 등 클라우드 네이티브를 다룬다. "Azure", "Foundry", "배포", "데모 URL", "모델 연결" 요청에 적용한다. 평가 기준 3(18%)의 핵심 — 모델이 Foundry 위에서 돌고 클라우드 네이티브일수록 고득점, 단순 끼워넣기는 감점.
---

# Azure AI & Deploy (평가 기준 3, 18%)

**모델 계층 = Azure AI Foundry**, **상주 프로세스 가능한 Azure 호스트**에 배포. + 클라우드 네이티브 가점.

## A. 모델 계층 = Azure AI Foundry (최고점 조건)

1. **Azure AI Foundry 프로젝트** 생성 → 모델(GPT-4o/GPT-5 계열) **배포(deployment)**.
2. **엔드포인트 + 키 + deployment 이름** 확보.
3. Copilot SDK를 **BYOK로 이 Foundry 모델에 연결**. 환경 변수 예:

```bash
AZURE_OPENAI_ENDPOINT="https://<resource>.openai.azure.com"
AZURE_OPENAI_API_KEY="<key>"
AZURE_OPENAI_DEPLOYMENT="<deployment-name>"
AZURE_OPENAI_API_VERSION="<version>"
```

> BYOK 정확한 설정 키/필드는 설치된 SDK 버전 BYOK 문서 확인. BYOK는 **키 기반 인증만** 지원.
> 앱은 `process.env`에서만 읽고 클라이언트로 보내지 않는다.

**의미 있는 Azure 활용으로 가점**(단순 끼워넣기 감점):
- 추론을 실제 Foundry로 라우팅 + **Azure MCP**로 자연어 리소스 제어(`mcp-integration`).
- (가점) **Azure AI Speech**로 서버 STT, **Azure AI Search**로 검색/임베딩.

## B. 호스팅 — 상주 프로세스 필요

Copilot SDK·MCP(npx)는 상주 프로세스가 필요하다.
- ✅ **Azure Container Apps**(권장, `azd up`) / ✅ App Service(Linux)
- ❌ Static Web Apps 단독(SDK·MCP 못 돎)

## C. 가장 빠른 배포: `azd up`

```bash
azd version            # 없으면 설치
azd auth login
azd init               # 최초 1회: Container Apps 템플릿
azd up                 # 빌드→인프라(Bicep)→배포. 끝나면 데모 URL 출력
```

> ⏱️ 빈 앱 상태에서 **일찍 한 번 `azd up`** 해서 파이프라인부터 검증. 데모 URL은 README에 기입.

## D. Dockerfile (번들 CLI + npx 주의)

SDK 번들 CLI와 **Azure MCP를 띄울 npx/Node**가 런타임 이미지에 있어야 한다 — **Node 공식 이미지** 사용.

```dockerfile
FROM node:20-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm AS run     # MCP가 npx로 패키지를 받으니 slim보다 표준 이미지 권장
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/@github ./node_modules/@github
EXPOSE 3000
CMD ["node", "server.js"]
```

> `next.config.js`에 `output: "standalone"`. Azure MCP를 쓰면 컨테이너에서 `npx`가 동작해야 한다.

## E. 인증/시크릿 — Key Vault + 관리 ID

두 종류의 자격을 구분하라:
- **모델(BYOK) 키**: Key Vault/Container Apps 시크릿 → 앱 환경 변수.
- **Azure MCP(리소스 접근)**: 로컬은 `az login`, 배포는 **Managed Identity**(키 없이 안전).

```bash
az containerapp secret set -n <app> -g <rg> --secrets aoai-key=<AZURE_OPENAI_API_KEY>
# 컨테이너 앱에 시스템 할당 관리 ID 부여 → Azure MCP가 그 ID로 인증
az containerapp identity assign -n <app> -g <rg> --system-assigned
```

- `.env.local`은 gitignore. 키를 코드/로그/응답에 절대 노출 금지(기준 6, harness 점검).

## F. 운영 점검

- 컨테이너는 플랫폼이 주는 `PORT`(보통 3000)에서 리슨.
- 첫 SDK/MCP 호출은 CLI·npx 기동으로 콜드 스타트가 길 수 있음 → 타임아웃·헬스체크 여유.

## 체크리스트

- [ ] 추론이 **Azure AI Foundry**를 실제로 거친다.
- [ ] `azd up` 성공, 데모 URL 200 + 스트리밍 확인.
- [ ] 모델 키=Key Vault/시크릿, Azure MCP=관리 ID. 레포·로그에 키 없음.
- [ ] (가점) Azure MCP/Speech/Search/Cosmos 등 클라우드 네이티브 요소.