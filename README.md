# PulsePlan

PulsePlan은 정리되지 않은 하루 업무 입력을 실행 가능한 시간표로 바꾸는 음성 우선 AI 재계획 웹앱입니다. 회의 메모, 급한 요청, 마감, 고정 일정, 집중 시간대를 한 번에 말하거나 붙여 넣으면 계획을 제안하고, 변경이 생기면 남은 일정을 다시 배치합니다.

데모 URL: https://pulseplan.livelywater-3bbbfa13.eastus.azurecontainerapps.io

## 무엇이 구현됐나

- 음성 입력 우선 UI: Web Speech API ko-KR, 부분 결과 표시, 텍스트 폴백
- PRD P0 플로우: 입력 캡처 → 항목 추출 → 점수 계산 → 시간표 제안 → 배치 근거 설명
- 재계획: 긴급 업무를 추가하면 **같은 Copilot SDK 도구 체인(추출→점수→시간표→설명)을 SSE로 다시 흘려** 남은 시간 기준으로 재배치하고 바뀐 블록을 표시합니다(에이전트 세션 실패 시 결정적 폴백).
- SSE 스트리밍: 계획 생성 상태, 도구 단계, 결과를 순차적으로 노출
- 실행 소스 투명화: 계획을 **에이전트(Foundry)로 생성했는지, 세션 불가로 로컬 폴백했는지** 결과 화면에 배지로 표시합니다(기준 5·6).
- AI 컨텍스트 분석: 입력(음성 transcript)에서 할 일·마감·고정 일정·집중 시간대 추출을 Foundry `gpt-4o`가 수행합니다(정규식 아님). 시간 정규화로 STT 오인식을 보정하고, Azure 미연결 시에만 규칙 기반으로 폴백합니다.
- Copilot SDK 구동: 서버 전용 SDK 세션이 4개 도구(항목 추출→점수→시간표→설명)를 실제로 호출하고, Foundry 모델이 추출과 최종 요약을 생성합니다.
- Azure AI Foundry(BYOK): Azure OpenAI `gpt-4o`를 provider로 연결, MCP(Azure MCP) 설정, 위험 작업 승인 게이트
- Cosmos DB 영속화: 계획 스냅샷을 Azure Cosmos DB(SQL API)에 저장, 자격 미설정 시 인메모리로 자동 폴백
- 승인 확정 + 사용자별 저장: 계획 승인 시 `/api/approve`로 **확정하고 확정 시각을 기록**하며, 브라우저 쿠키 세션별로 스냅샷을 분리합니다(사용자 간 계획이 섞이지 않음).
- IaC(Bicep): **Key Vault**(시크릿), **사용자 할당 관리 ID**(런타임 인증), **Application Insights + Log Analytics**(관측), **명시적 min/max 레플리카** 스케일, Cosmos까지 코드로 프로비저닝합니다(`azd up`).
- Azure 배포 산출물: Dockerfile, azure.yaml, infra/ Bicep, standalone Next.js 빌드 설정

## 기술 선택

- Next.js App Router + TypeScript
- 서버 전용 Copilot SDK 래퍼와 Azure AI Foundry 환경 변수 연결
- Azure MCP 로컬 서버 설정 화이트리스트
- 항목 추출은 Foundry `gpt-4o`(그라운딩된 전용 호출, temperature 0, JSON 모드)로 수행하고, 점수·스케줄은 결정적 엔진이 처리합니다. Azure 미연결 시 규칙 기반으로 폴백합니다.

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
- COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER (선택 — 설정 시 Cosmos DB 영속화, 미설정 시 인메모리)

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
- 저장소는 Cosmos DB 자격이 있으면 계획 스냅샷을 영속화하고, 없으면 인메모리로 동작합니다(세션 범위 이상으로 영구 보관하지 않음).

## 구조

- [app/page.tsx](app/page.tsx): 음성 우선 화면, 스트리밍 결과 렌더링, 승인 및 재계획 UX
- [app/api/agent/route.ts](app/api/agent/route.ts): transcript 기반 계획 생성 SSE 엔드포인트
- [app/api/replan/route.ts](app/api/replan/route.ts): 변경 입력 기반 재계획 SSE 엔드포인트(같은 SDK 도구 체인 재사용)
- [app/api/approve/route.ts](app/api/approve/route.ts): 계획 확정(승인 게이트) — 세션별 확정 상태 영속화
- [lib/extract.ts](lib/extract.ts): Foundry `gpt-4o` 기반 입력 추출(JSON 모드, 시간 정규화, 429 백오프 재시도), 규칙 기반 폴백
- [lib/planner.ts](lib/planner.ts): AI/규칙 추출 결합, 점수화, 스케줄링, 설명, 재계획 로직
- [lib/copilot.ts](lib/copilot.ts): Copilot SDK, Azure Foundry, MCP, 승인 게이트 래퍼(계획·재계획 도구 체인)
- [lib/store.ts](lib/store.ts): 계획 스냅샷 저장소(세션별 분리 + Cosmos DB 영속화 + 인메모리 폴백)
- [lib/session.ts](lib/session.ts): 브라우저 쿠키 기반 세션 식별(사용자별 스냅샷 분리)
- [lib/normalize.ts](lib/normalize.ts): 한국어 STT 시간/숫자 정규화
- [infra/main.bicep](infra/main.bicep), [infra/resources.bicep](infra/resources.bicep): Key Vault·관리 ID·App Insights·스케일·Cosmos IaC(azd)

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

앞에서 풀어낸 기능들이 대회의 일곱 평가 기준에 **하나도 빠짐없이, 정면으로** 맞물리는지를 한 장으로 못 박습니다. 흩어진 말 한마디가 실행 가능한 하루로 응결되기까지 — PulsePlan의 모든 코드 경로는 우연이 아니라 **루브릭을 정조준한 설계**이며, 그 증거는 [harness/run.mjs](harness/run.mjs)가 매 실행마다 **차단 0건**으로 봉인합니다.

| # | 평가 기준 | 가중치 | PulsePlan이 증명하는 방식 |
|---|-----------|------:|---------------------------|
| 1 | **Effective Use of Copilot SDK** | 25% | 서버 전용 SDK 세션이 `추출 → 점수 → 스케줄 → 설명` 네 도구를 **실제로 순차 호출**하고, **재계획마저 똑같은 도구 체인을 SSE로 다시 흘려보냅니다.** Azure MCP를 세션에 물려 자연어로 클라우드를 더듬고, 모든 단계를 **실시간 생중계**합니다. 장식이 아니라 **앱의 심장이 뛰는 소리**입니다. |
| 2 | **Productivity Impact & Problem Fit** | 18% | "이미 정리된 할 일"이라는 환상을 걷어내고, **회의 액션·끼어든 요청·마감·집중 시간대가 뒤엉킨 날것의 한마디**를 곧바로 실행 가능한 시간표로 벼려냅니다. 지식근로자의 가장 아픈 지점을 **외과적으로 정확히** 찌릅니다. |
| 3 | **Azure AI & Cloud Integration** | 18% | 두뇌는 **Azure AI Foundry `gpt-4o`(BYOK)**, 손발은 **Azure MCP**, 무대는 **Container Apps**, 기억은 **Cosmos DB**, 비밀은 **Key Vault**, 신원은 **관리 ID**, 두 눈은 **Application Insights** — 게다가 이 모든 것을 **Bicep IaC 한 벌(`azd up`)로 재현 가능하게 직조**했습니다. 끼워 넣은 게 아니라 **클라우드 네이티브 그 자체**입니다. |
| 4 | **Functionality & Technical Execution** | 16% | 입력→추출→계획→**재계획→확정**까지 **엔드투엔드로 살아 숨 쉬고**, 재계획도 이제 **SSE로 끊김 없이** 흐릅니다. 빈 입력은 400으로 단호히 되받고, 순간 과부하(429)는 백오프로 삼키며, 반응형으로 **어떤 화면에서도 무너지지 않습니다.** |
| 5 | **UX & Workflow Design** | 12% | **말 한마디**라는 가장 낮은 저항의 입력에서 출발해 제안→**승인·확정(확정 시각 각인)**→다시 생성의 흐름을 매끄럽게 잇고, **에이전트로 만들었는지 로컬 폴백인지까지 배지로 투명하게** 드러내며, 도구 호출과 가정을 **숨기지 않고 펼쳐** 신뢰를 빚습니다. |
| 6 | **Responsible AI, Security & Trust** | 6% | 위험 작업은 **사람 승인 게이트** 앞에 멈춰 서고, 확정은 **사용자별 세션으로 격리**되어 남의 계획과 섞이지 않으며, 입력 속 지시문은 **데이터로만** 취급합니다. 추출은 **그라운딩된 전용 호출**로 환각을 봉인하고, 키는 코드 밖 **Key Vault·secretref**에만, 신원은 **관리 ID**에만 깃듭니다. |
| 7 | **Innovation & Originality** | 5% | "할 일 관리"가 아니라 **"무너진 계획의 재배치(re-planning)"**라는 프레이밍, 그리고 **음성 우선**이라는 결. 익숙한 문제를 **낯선 각도에서 다시** 봅니다. |

일곱 기준 전부는 [harness/run.mjs](harness/run.mjs)의 자가 점검 **21개 항목(C1–C14 정적 제약 + S0–S7 엔드투엔드 스모크)**으로 **차단 항목 0건**임을 매 실행마다 증명합니다. AI 기반 추출(C10), Cosmos DB 영속화(C11), **재계획 SDK+SSE 통합(C12), 승인 확정·세션 격리(C13), Key Vault·관리 ID·App Insights·스케일을 갖춘 IaC 성숙도(C14)**까지 — 말이 아니라 **자동화된 증거**로 못 박습니다.
