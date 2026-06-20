# AGENTS.md — PulsePlan

> 모든 코딩/평가 에이전트(GitHub Copilot 보이스 코딩·Copilot CLI·평가용 AI)가 **가장 먼저 읽는 지침서**.
> 작업 전에 "절대 규칙", "아키텍처", "평가 기준 매핑"을 반드시 준수하라.
> **React + FastAPI 기반 개발.**

---

## 1. 프로젝트 — PulsePlan

**하루 계획이 자꾸 무너지는 사람을 위한 AI 재계획(re-planning) 웹앱.**

기존 생산성 앱은 *이미 정리된* 할 일을 입력한다고 가정한다. 현실은 다르다 — 회의 액션
아이템, 갑작스러운 메신저 요청, 마감, 고정 일정, 집중 시간대, 끼어드는 긴급 업무가 뒤섞여 있다.
**PulsePlan은 정리되지 않은 업무 입력을 받아 오늘 실제로 실행 가능한 하루 계획으로 재배치한다.**

핵심 플로우(에이전트 중심):
1. 사용자가 **음성/텍스트로** 오늘 상황을 자연어로 쏟아낸다.
2. 에이전트가 **할 일·마감·고정 일정·제약·집중 시간대**를 추출한다.
3. 각 작업의 **중요도·긴급도·예상 소요·신뢰도**를 계산한다.
4. **오늘의 시간표를 제안**하고, **왜 이 순서인지 설명**한다.
5. 사용자는 **승인 / 수정 / 다시 생성**할 수 있다.
6. 갑작스러운 일이 생기면 **기존 계획을 재배치(replan)** 한다.

- **타깃 사용자**: 회의·메신저 요청이 많은 지식근로자, 변경이 잦은 개발자, 멀티 클라이언트 프리랜서, 1인 창업자.
- **입력은 음성 우선** (입코딩 테마) — 음성인식 오인식·오타가 섞여도 잘 이해해야 한다(아래 6절).

> ⚙️ 팀에서 채우기 — 앱 이름: `PulsePlan` / 라이브 데모 URL: `<배포 후 기입>` / 팀: `<이름들>`

---

## 2. 절대 규칙 (NON-NEGOTIABLE)

대회 필수 요소 + 이 프로젝트의 약속. 충돌 시 멈추고 사람에게 확인.

1. **웹 앱**(반응형)으로 개발.
2. **GitHub Copilot SDK(`@github/copilot-sdk`)를 핵심 가치로** 사용 — 도구 호출·컨텍스트·스트리밍이 앱의 본질.
3. **Azure에 배포** (데모 URL이 실제 응답).
4. **모델 계층은 Azure AI Foundry(또는 Azure OpenAI)** — Copilot SDK를 **BYOK로 Foundry 모델에 연결**. (기준 3 최고점)
5. **MCP 서버를 구성** — 특히 **Azure MCP 서버(`@azure/mcp`)** 를 SDK 세션에 연결해 Azure를 자연어로 다룬다. (기준 1·3) → `mcp-integration` 스킬
6. **음성 입력 지원 + 오인식/오타에 견고**. (기준 5 + 테마) → `voice-input` 스킬
7. **위험 작업(삭제·전송·Azure 변경 등)은 실행 전 사람 승인.** `approveAll`/`--allow-all-tools` 무분별 사용 금지. (기준 6)

---

## 3. 기술 스택 (권장 기본값)

언어 자유지만 시간 제약상 아래 권장. 바꾸면 이 절 + `package.json` + `Dockerfile` + `infra/` 동기화.

- **TypeScript** (strict) / **Next.js (App Router)** — UI + API 라우트 단일 앱
- **`@github/copilot-sdk`** (서버 전용), 모델 = **Azure AI Foundry (BYOK)**
- **음성인식**: 브라우저 **Web Speech API**(`ko-KR`) 기본, (가점) **Azure AI Speech**로 서버 STT 업그레이드
- **MCP**: **Azure MCP 서버**(`npx -y @azure/mcp@latest server start`) + 필요시 로컬 PulsePlan MCP
- **Node 20+**, 배포 = **Azure Container Apps** + **`azd`**
- 상태: 데모는 SQLite/인메모리, 클라우드 네이티브 가점은 **Cosmos DB**, 시크릿은 **Key Vault**

---

## 4. 아키텍처 (가장 중요)

Copilot SDK는 내부적으로 **Copilot CLI를 서버 모드로 띄워 JSON-RPC(loopback)** 통신 → **SDK는 백엔드에서만** 동작.

```
[브라우저 UI + Web Speech API(음성)]
        │  transcript(텍스트) 전송, HTTP/SSE
        ▼
[백엔드 (Next.js API)] ──SDK──▶ [Copilot SDK] ──BYOK──▶ [Azure AI Foundry 모델]
        │                              │
        │                              └─ mcpServers ─▶ [Azure MCP 서버 / 로컬 MCP]
        ▼
   [작업/계획 저장소]
```

규칙:
- ❌ 브라우저에서 `@github/copilot-sdk` import/호출, 키 노출 금지.
- ✅ SDK·MCP 호출은 `app/api/**`, `lib/` 서버 코드에만.
- ✅ 음성인식(STT)은 **브라우저에서** 텍스트로 변환 → 백엔드로는 텍스트만 전송.
- ✅ 응답은 **SSE 스트리밍** + 도구/MCP 호출을 UI에 투명 표시(기준 1·5·6).
- ✅ 배포는 **상주 프로세스 가능한 호스트**(Container Apps/App Service). Static Web Apps 단독 ❌.

---

## 5. 디렉터리 구조

```
.
├── AGENTS.md
├── README.md                  ← 소개 + 데모 URL + 실행법 + 기준 충족 요약
├── .github/skills/
│   ├── copilot-sdk-integration/   (기준 1: 에이전트·도구·스트리밍·STT 견고 프롬프트)
│   ├── mcp-integration/           (기준 1·3: Azure MCP 등 MCP 서버 연결)
│   ├── voice-input/               (기준 5: Web Speech API + 오인식 처리)
│   ├── azure-ai-and-deploy/       (기준 3: Foundry + 배포)
│   ├── responsible-ai-guardrails/ (기준 6: 승인 게이트·인젝션·시크릿)
│   └── planning-feature/          (기준 2·4·5: PulsePlan 기능)
├── harness/                   ← 제출 전 자가 점검·자가 채점 (평가 기준 그대로)
├── app/
│   ├── api/agent/route.ts     ← 계획 생성(SSE)
│   ├── api/replan/route.ts    ← 재계획
│   └── page.tsx               ← 음성 입력 + 계획 카드 UI
├── lib/
│   ├── copilot.ts             ← CopilotClient(싱글턴) + Foundry BYOK + MCP
│   ├── tools.ts               ← 에이전트 도구(extract/score/schedule/replan)
│   ├── normalize.ts           ← STT 전처리(시간·숫자 보정)
│   └── store.ts               ← 작업/계획 저장소
├── infra/ · azure.yaml · Dockerfile · package.json
```

---

## 6. 음성 입력 & 오인식 견고성 (테마 핵심)

음성으로 받은 텍스트(transcript)는 **틀릴 수 있다**: 동음이의("두 시"/"2시"), 띄어쓰기·문장부호 없음,
숫자·시간 오인식, 말줄임. 에이전트는 이를 **데이터로 받아 관대하게 해석**해야 한다.

- `lib/normalize.ts`에서 한국어 시간/숫자 표현을 가볍게 정규화("오후 다섯시"→17:00 등) 후 에이전트에 전달.
- 시스템 프롬프트에 명시: "입력은 음성 오인식이 섞일 수 있다. 합리적으로 보정해 해석하고,
  **정말 막힐 때만 한 가지** 짧은 확인 질문을 하라. 그 외엔 가정을 명시하고 최선의 계획을 제안하라."
- 모르는 값은 지어내지 말고 가정으로 표시(기준 6 환각 완화). 자세히는 `voice-input`·`copilot-sdk-integration` 스킬.

---

## 7. 코딩 컨벤션 (입코딩 친화)

서술적·발음 가능한 이름, 작은 함수, 깊은 중첩 금지, 파일 ~200줄에서 분리, 명시적 타입(`any` 지양),
포매팅은 Prettier 위임, 커밋은 짧게(`feat: add replan endpoint`).

---

## 8. 평가 기준 → 설계 매핑 (총 100%)

| # | 기준 | 가중치 | 이 레포에서 점수 따는 법 |
|---|------|------:|---------------------------|
| 1 | Effective Use of Copilot SDK | 25% | 추출/점수/스케줄/재계획 **도구 설계**, 컨텍스트, **MCP 연결**, SSE 스트리밍의 깊이. → `copilot-sdk-integration`, `mcp-integration` |
| 2 | Productivity Impact & Problem Fit | 18% | "정리 안 된 입력→실행 가능 계획"이라는 명확한 문제·타깃. → `planning-feature` |
| 3 | Azure AI & Cloud Integration | 18% | 모델=Foundry + **Azure MCP**로 의미 있는 Azure 활용 + 클라우드 네이티브. → `azure-ai-and-deploy`, `mcp-integration` |
| 4 | Functionality & Technical Execution | 16% | 엔드투엔드 동작, 재계획, 에러 처리, 반응형. → `planning-feature` + harness |
| 5 | UX & Workflow Design | 12% | **음성 저저항 입력**, 제안→승인 흐름, 지연/오류/투명성 처리, 접근성. → `voice-input` |
| 6 | Responsible AI, Security & Trust | 6% | 위험·Azure 작업 승인, 투명성, 인젝션 인지, 환각 완화, 시크릿. → `responsible-ai-guardrails` |
| 7 | Innovation & Originality | 5% | "재계획" 프레이밍 + 음성 우선. |

---

## 9. 제출 전 게이트 (harness)

```bash
npm run dev                                  # 앱 실행(http://localhost:3000)
node harness/run.mjs                         # 정적 점검 + 스모크(+STT 견고성)
node harness/run.mjs --judge                 # + Azure Foundry LLM 채점(자격증명 필요)
```

`harness/`는 7개 기준을 그대로 옮긴 자가 점검·자가 채점. 결과는 `harness/report.md`.
**차단(fail) 항목이 있으면 제출 전 반드시 해결.** 상세는 `harness/README.md`.

---

## 10. 하지 말 것

- 브라우저에서 SDK 직접 호출 / 키 노출.
- 모델을 비-Azure로만 구동(기준 3 최고점 불가).
- `--allow-all-tools`/`approveAll`로 Azure MCP·삭제 작업 무조건 허용(기준 6 감점).
- 음성 transcript를 그대로 신뢰하거나, 막힐 때마다 되묻기(저저항 UX 훼손).
- 정적 호스팅 단독 배포.
- 4시간 초과 스코프. **동작하는 핵심(입력→계획) → 일찍 `azd up` → 재계획·음성·MCP로 확장** 순서.
