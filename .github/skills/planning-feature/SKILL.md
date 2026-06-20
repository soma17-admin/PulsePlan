---
name: planning-feature
description: PulsePlan에 재계획 기능(입력 캡처, 항목 추출, 점수 계산, 시간표 제안, 설명, 승인/수정/재생성, 재계획)을 일관되게 추가할 때 사용한다. "~기능", "화면 추가", "계획/재계획/추출 붙여줘" 요청에 적용해 데이터→API→UI→에이전트 도구를 수직 슬라이스로 빠르게 만든다. 4시간 제약에서 스코프를 작게 유지하도록 돕는다. 평가 기준 2(18%)·4(16%)·5(12%)에 직접 기여한다.
---

# Planning Feature — PulsePlan (기준 2·4·5)

PulsePlan 기능을 **얇은 수직 슬라이스**로 추가한다. 입코딩으로도 흔들리지 않게 매번 같은 순서.

## 스코프 (4시간 룰)

- 한 기능 = 데이터 1개 + 동작 2~3개로 좁힌다.
- "동작하는 핵심(입력→계획) → 일찍 배포"가 화려한 미완성보다 항상 낫다.
- 시작 전 한 줄: *"사용자는 ___를 할 수 있다."*

## 기능 우선순위 (데모 임팩트 순)

1. **자연어/음성 입력 → 항목 추출** — 뒤섞인 입력을 할 일·마감·고정 일정·제약·집중대로 분해.
2. **점수 계산 + 시간표 제안** — 중요도·긴급도·소요·신뢰도로 오늘 시간표를 *제안*.
3. **왜 이 순서인지 설명** — 배치 근거 제시(신뢰·투명성).
4. **승인 / 수정 / 다시 생성** — 사용자가 주도권 유지.
5. **재계획(replan)** — 갑작스러운 변경을 반영해 남은 시간을 재배치. ← PulsePlan의 정체성.

위에서부터 확보. 1~4가 MVP, 5가 차별화 한 방.

## 표준 순서 (수직 슬라이스)

### 1) 데이터/저장소 — `lib/store.ts`
```ts
export type Task = { id: string; title: string; durationMin: number; deadline?: string; confidence: number };
export type Fixed = { title: string; start: string; end: string };
export type Block = { taskId: string; start: string; end: string; reason: string };
export type Plan = { blocks: Block[]; assumptions: string[] };
```
데모는 인메모리/SQLite, 클라우드 네이티브 가점은 Cosmos DB.

### 2) API (서버) — 입력 검증 필수
- `POST /api/agent` : transcript → 추출·점수·계획 제안(SSE)
- `POST /api/replan` : { change, currentPlan } → 재계획 제안
```ts
export async function POST(req: Request) {
  const { transcript } = await req.json();
  if (!transcript?.trim()) return new Response("transcript required", { status: 400 });
  // ...에이전트 호출(copilot-sdk-integration)
}
```

### 3) UI — 저저항 + 접근성 (기준 5)
- 1차 동선은 **음성 입력**(voice-input), 텍스트도 항상 가능.
- 흐름: 입력 → **추출 항목 미리보기** → **계획 카드**(시간 블록 + 근거) → [승인]/[수정]/[다시 생성].
- "긴급 업무 추가" 입력 시 **재계획** 트리거. 변경된 블록을 강조 표시.
- 스트리밍 진행 표시, 오류 시 재시도. 라벨/포커스/대비 등 접근성.

### 4) 에이전트 연동 (기준 1과 연결)
새 동작은 `lib/tools.ts`에 도구로 추가하고 위험도(safe/write/danger) 지정. write/replan은 승인 게이트.

## 품질 (기준 4)

- 엔드투엔드 동작. 엣지: 빈 입력, 충돌하는 일정(겹침), 시간 부족(다 못 넣음 → 우선순위로 잘라 제안), 긴 입력.
- 반응형(모바일/데스크톱). 명시적 타입·작은 함수.
- 기능 완료 시 `npm run build` + `npm run lint` + `node harness/run.mjs` 통과 후 커밋.

## 완료 체크리스트

- [ ] 입력→추출→점수→계획→설명이 한 흐름으로 동작.
- [ ] 재계획이 실제로 남은 일정을 다시 배치.
- [ ] 제안→승인 흐름으로 사용자가 주도권 유지.
- [ ] 엣지/에러/반응형 확인 + 빌드/스모크 통과 + 커밋.