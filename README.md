# PulsePlan

PulsePlan은 정리되지 않은 하루 업무 입력을 실행 가능한 시간표로 바꾸는 음성 우선 AI 재계획 웹앱입니다. 회의 메모, 급한 요청, 마감, 고정 일정, 집중 시간대를 한 번에 말하거나 붙여 넣으면 계획을 제안하고, 변경이 생기면 남은 일정을 다시 배치합니다.

데모 URL: https://pulseplan.livelywater-3bbbfa13.eastus.azurecontainerapps.io

## 무엇이 구현됐나

- 음성 입력 우선 UI: Web Speech API ko-KR, 부분 결과 표시, 텍스트 폴백
- PRD P0 플로우: 입력 캡처 → 항목 추출 → 점수 계산 → 시간표 제안 → 배치 근거 설명
- 재계획: 긴급 업무를 추가하면 남은 시간 기준으로 재배치
- SSE 스트리밍: 계획 생성 상태, 도구 단계, 결과를 순차적으로 노출
- Copilot SDK 구동: 서버 전용 SDK 세션이 4개 도구(항목 추출→점수→시간표→설명)를 실제로 호출하고, Foundry 모델이 최종 요약을 생성
- Azure AI Foundry(BYOK): Azure OpenAI `gpt-4o`를 provider로 연결, MCP(Azure MCP) 설정, 위험 작업 승인 게이트
- Azure 배포 산출물: Dockerfile, azure.yaml, standalone Next.js 빌드 설정

## 기술 선택

- Next.js App Router + TypeScript
- 서버 전용 Copilot SDK 래퍼와 Azure AI Foundry 환경 변수 연결
- Azure MCP 로컬 서버 설정 화이트리스트
- 로컬 기본값은 결정적 플래너로 동작하고, Azure 자격이 있으면 Copilot 경로를 시도한 뒤 폴백

## 빠른 시작

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 을 열고 음성 또는 텍스트로 하루 상황을 입력합니다.

검증:

```bash
npm run build
npm run lint
node harness/run.mjs
```

## 환경 변수

예시는 [.env.example](.env.example)에 있습니다.

- AZURE_OPENAI_ENDPOINT
- AZURE_OPENAI_API_KEY
- AZURE_OPENAI_DEPLOYMENT
- AZURE_OPENAI_API_VERSION
- NEXT_PUBLIC_DEMO_URL

Azure 자격이 없더라도 로컬 플래너 경로로 앱과 harness는 동작합니다. Azure 자격이 있으면 Foundry 기반 Copilot 세션을 시도합니다.

## 배포

현재 **Azure Container Apps**에 배포되어 있습니다(위 데모 URL이 실제 응답).
모델 계층은 **Azure AI Foundry(Azure OpenAI `gpt-4o`)** 위에서 BYOK로 동작하며,
컨테이너 안에서 Copilot SDK CLI(리눅스 바이너리)가 실제로 구동됩니다.

### CI/CD

- [.github/workflows/ci.yml](.github/workflows/ci.yml): push/PR마다 lint → build → harness 자가 점검
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml): main push 시 ACR 빌드 후 Container Apps 배포(OIDC)

배포 시크릿(저장소 Settings → Secrets): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
`AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`.

### 수동 배포(로컬 Docker 사용)

```bash
az containerapp env create -g pulseplan-rg -n pulseplan-env -l eastus
az acr create -g pulseplan-rg -n <acr> --sku Basic --admin-enabled true
docker build -t <acr>.azurecr.io/pulseplan:v1 .
az acr login -n <acr> && docker push <acr>.azurecr.io/pulseplan:v1
az containerapp create -g pulseplan-rg -n pulseplan --environment pulseplan-env \
  --image <acr>.azurecr.io/pulseplan:v1 --target-port 3000 --ingress external \
  --secrets aoai-key=<key> \
  --env-vars AZURE_OPENAI_ENDPOINT=<ep> AZURE_OPENAI_DEPLOYMENT=gpt-4o \
    AZURE_OPENAI_API_VERSION=2024-10-21 AZURE_OPENAI_API_KEY=secretref:aoai-key
```

배포 전제:

- 상주 프로세스가 가능한 Azure Container Apps 호스팅(min-replicas 1로 콜드스타트 완화)
- 모델 키는 Container Apps 시크릿(`secretref`)으로 주입, 코드/이미지에 미포함
- Copilot CLI 리눅스 바이너리를 Dockerfile에서 명시적으로 포함(`COPILOT_CLI_PATH`)
- Azure MCP는 로컬 az login 또는 배포 시 관리 ID 사용

## 책임 AI와 데이터 처리

- 계획 생성은 제안이며, 적용은 사용자가 승인합니다.
- 위험한 도구 호출은 승인 게이트를 통해 차단되도록 설계했습니다.
- 사용자 입력은 데이터로만 취급하며, 프롬프트 인젝션 지시를 실행하지 않습니다.
- 데모 구현은 인메모리 저장소를 사용하며 입력 데이터는 세션 범위를 넘겨 영구 저장하지 않습니다.

## 구조

- [app/page.tsx](app/page.tsx): 음성 우선 화면, 스트리밍 결과 렌더링, 승인 및 재계획 UX
- [app/api/agent/route.ts](app/api/agent/route.ts): transcript 기반 계획 생성 SSE 엔드포인트
- [app/api/replan/route.ts](app/api/replan/route.ts): 변경 입력 기반 재계획 엔드포인트
- [lib/planner.ts](lib/planner.ts): 추출, 점수화, 스케줄링, 설명, 재계획 로직
- [lib/copilot.ts](lib/copilot.ts): Copilot SDK, Azure Foundry, MCP, 승인 게이트 래퍼
- [lib/normalize.ts](lib/normalize.ts): 한국어 STT 시간/숫자 정규화

## 현재 범위

이 구현은 PRD의 MVP와 차별화 포인트 중 다음을 직접 반영합니다.

- FR-1 입력 캡처
- FR-2 항목 추출 미리보기
- FR-3 점수와 시간표 제안
- FR-4 배치 근거와 가정 노출
- FR-5 승인과 다시 생성
- FR-6 긴급 업무 재계획
- FR-7 STT 견고성 정규화
- FR-8 SDK, SSE, MCP, 승인 게이트 코드 경로
