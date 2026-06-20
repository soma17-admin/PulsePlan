# TodayMate 제출 전 자가 점검 리포트
생성: 2026-06-20T04:16:10.600Z

## 요약
- 자동 점검: 16개 / 실패 0 / 경고 0
- ✅ 차단(fail) 항목 없음

## 평가 기준별 자동 준비도
| # | 기준 | 가중치 | 자동 준비도 |
|---|------|------:|-----------:|
| 1 | Effective Use of Copilot SDK | 25% | 100% |
| 2 | Productivity Impact & Problem Fit | 18% | 수동 검토 |
| 3 | Azure AI & Cloud Integration | 18% | 100% |
| 4 | Functionality & Technical Execution | 16% | 100% |
| 5 | User Experience & Workflow Design | 12% | 100% |
| 6 | Responsible AI, Security & Trust | 6% | 100% |
| 7 | Innovation & Originality | 5% | 수동 검토 |

> "수동 검토"는 자동화로 판단 불가한 항목(문제 적합성·UX·독창성). 루브릭의 review 지침으로 사람이 확인.

## 자동 점검 상세
| 상태 | ID | 항목 | 근거 |
|------|----|------|------|
| ✅ | C1_sdk_dependency | Copilot SDK 의존성 | @github/copilot-sdk 설치됨 |
| ✅ | C2_sdk_server_only | SDK 서버 전용 | 클라이언트에서 SDK import 없음 |
| ✅ | C3_azure_foundry_configured | Azure Foundry 모델 연결 | AZURE_OPENAI_/Foundry 설정 흔적 있음 |
| ✅ | C4_deploy_artifacts | 배포 산출물 | Dockerfile + azure.yaml/infra 존재 |
| ✅ | C5_no_secrets | 시크릿 비노출 | 키 노출 없음, .env gitignore됨 |
| ✅ | C6_readme_demo_url | README 데모URL+실행법 | 데모 URL+실행법 기재 |
| ✅ | C7_permission_gate | 위험작업 승인 게이트 | onPermissionRequest 기반 승인 흐름 있음 |
| ✅ | C8_voice_input | 음성 입력 | 음성인식(Web Speech/Azure Speech) 흔적 있음 |
| ✅ | C9_mcp_configured | MCP 구성 | mcpServers/Azure MCP 설정 흔적 있음 |
| ✅ | S0_deployed_url | 배포 URL 응답 | https://pulseplan.livelywater-3bbbfa13.eastus.azurecontainerapps.io → 200 |
| ✅ | S1_server_up | 서버 기동 | http://localhost:3000 → 200 |
| ✅ | S2_agent_endpoint | 에이전트 엔드포인트 | /api/agent → 200, 3046B |
| ✅ | S3_streaming | 스트리밍 응답 | SSE(text/event-stream) 감지 |
| ✅ | S4_error_handling | 오류 처리 | 빈 입력 → 400 |
| ✅ | S5_stt_robustness | STT 견고성 | 오인식 섞인 입력 → 시간 포함 계획 응답 생성 |
| ✅ | S6_replan | 재계획 엔드포인트 | /api/replan → 200 |
