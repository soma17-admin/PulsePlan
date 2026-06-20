# harness/ — 제출 전 자가 점검 & 자가 채점 (PulsePlan)

평가 기준(7개)을 그대로 옮긴 점검 도구. **레포 루트에서** 실행한다(Node 20+).

## 빠르게

```bash
npm run dev                      # http://localhost:3000
node harness/run.mjs             # 정적 점검 + 스모크(+STT 견고성)
```

결과는 콘솔 + `harness/report.md`. **차단(fail) 항목이 있으면 제출 전 해결.**

## 옵션

```bash
# 배포 URL까지 점검 (기준 3)
BASE_URL=http://localhost:3000 \
DEPLOYED_URL=https://<app>.azurecontainerapps.io \
node harness/run.mjs

# AI 심사 시뮬레이션(LLM-as-judge) — Azure Foundry 자격증명 필요
export AZURE_OPENAI_ENDPOINT="https://<resource>.openai.azure.com"
export AZURE_OPENAI_API_KEY="<key>"
export AZURE_OPENAI_DEPLOYMENT="<deployment-name>"
node harness/run.mjs --judge
```

## 구성

| 파일 | 역할 |
|------|------|
| `rubric.json` | 7개 기준·가중치·자동체크 매핑 |
| `check-constraints.mjs` | 정적: SDK 의존성·서버전용·Foundry·배포물·시크릿·승인게이트·README·**음성입력·MCP** |
| `smoke.mjs` | 엔드투엔드: 서버·에이전트·스트리밍·오류·**STT 견고성**·재계획·배포 URL |
| `judge.mjs` | (선택) Azure Foundry 모델로 루브릭 채점 |
| `run.mjs` | 전체 실행 + `report.md` 생성 |

## 점검 ID ↔ 기준

- **기준1(SDK)**: `C1_sdk_dependency` `C2_sdk_server_only` `C7_permission_gate` `C9_mcp_configured` `S2_agent_endpoint` `S3_streaming`
- **기준3(Azure AI)**: `C3_azure_foundry_configured` `C9_mcp_configured` `C4_deploy_artifacts` `S0_deployed_url`
- **기준4(기능)**: `S1_server_up` `S2_agent_endpoint` `S4_error_handling` `S5_stt_robustness`
- **기준5(UX)**: `C8_voice_input`
- **기준6(책임AI/보안)**: `C5_no_secrets` `C7_permission_gate`
- **기준2·7**: 자동화 불가 → 루브릭 review 지침으로 **사람이 검토**

## STT 견고성 점검(S5)이 하는 일

일부러 **오인식/오타가 섞인 한국어 입력**("두시반…다섯시까지 보네야돼…")을 `/api/agent`로 보내,
에이전트가 **시간 토큰이 포함된 계획**을 만들어내는지 본다. 음성 우선 앱의 실사용성을 자동으로 검증.

## 가정 / 커스터마이즈

- 권장 스택(Next.js/TS, `/api/agent`·`/api/replan`, 입력 키 `transcript`)을 가정.
- 다른 스택이면: `smoke.mjs`의 `AGENT_PATH`/`REPLAN_PATH`/payload, `check-constraints.mjs`의 경로 휴리스틱만 조정.

## 상태 의미

- ✅ pass / ⚠️ warn(보강 권장) / ❌ fail(차단, 반드시 해결)

> 자동 점검은 "필수 요소가 빠지지 않았는지"를 보장할 뿐 최종 점수가 아니다.
> 깊이(1)·문제 적합성(2)·UX(5)·독창성(7)은 사람·심사 AI의 정성 평가 영역이다.
