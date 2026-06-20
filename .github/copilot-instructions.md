# Copilot Instructions — PulsePlan

이 레포는 **PulsePlan**(음성 기반 AI 재계획 웹앱, 입코딩 2026 출품작)입니다.
항상 아래 문서를 우선해서 따르세요. 이 파일은 요약일 뿐이며, 상세 규칙은 `AGENTS.md`에 있습니다.

## 가장 먼저 읽을 것
- **`AGENTS.md`** (루트) — 절대 규칙·아키텍처·평가 기준 매핑. 작업 전 반드시 준수.
- **`PRD.md`** (루트) — 제품 요구사항·범위·우선순위.
- **`.github/skills/*/SKILL.md`** — 작업 성격에 맞는 스킬을 펼쳐 그 절차를 따른다.

## 절대 규칙 (요약)
1. 웹 앱(반응형)으로 개발한다.
2. **GitHub Copilot SDK(`@github/copilot-sdk`)** 를 핵심 가치로 사용한다(도구·컨텍스트·스트리밍).
3. **Azure에 배포**한다(데모 URL이 실제 응답).
4. 모델 계층은 **Azure AI Foundry(BYOK)** 위에서 동작한다.
5. **MCP 서버**(특히 Azure MCP)를 SDK 세션에 연결한다.
6. **음성 입력**을 지원하고 음성 오인식/오타에 견고하게 만든다.
7. 위험 작업(삭제·전송·Azure 리소스 변경)은 실행 전 **사람 승인**. 전체 허용 금지.

## 스킬 라우팅
- 에이전트/도구/스트리밍 → `copilot-sdk-integration`
- MCP 연결(Azure MCP) → `mcp-integration`
- 음성 입력·STT 견고성 → `voice-input`
- Foundry 모델·Azure 배포 → `azure-ai-and-deploy`
- 보안·승인·인젝션·시크릿 → `responsible-ai-guardrails`
- 기능 추가(추출/계획/재계획) → `planning-feature`

## 제출 전
- `npm run build`, `npm run lint`, `node harness/run.mjs` 를 통과시킨다(차단 항목 0).
