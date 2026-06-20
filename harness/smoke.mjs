// harness/smoke.mjs
// 실행 중인 앱(로컬/배포)을 대상으로 엔드투엔드 동작 + STT 견고성을 점검한다.
// 사용: BASE_URL=http://localhost:3000 node harness/smoke.mjs
//      DEPLOYED_URL=https://<app>.azurecontainerapps.io 도 함께 점검(S0)
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DEPLOYED_URL = process.env.DEPLOYED_URL || "";
const AGENT_PATH = process.env.AGENT_PATH || "/api/agent";
const REPLAN_PATH = process.env.REPLAN_PATH || "/api/replan";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 45000);

const result = (id, title, status, evidence) => ({ id, title, status, evidence });

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}
async function fetchSafe(url, opts = {}) {
  try { return await withTimeout((signal) => fetch(url, { ...opts, signal }), TIMEOUT_MS); }
  catch (e) { return { ok: false, status: 0, _error: String(e?.message || e) }; }
}
const postJson = (url, body) =>
  fetchSafe(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 의도적으로 '음성 오인식/오타'가 섞인 입력 — 에이전트가 보정해 계획을 내야 한다.
const MESSY_TRANSCRIPT =
  "오늘 두시반에 고객사 제안서 리뷰있고 다섯시까지 수정본 보네야돼 오전엔 회의록 액션아이템 정리하고 채용후보자 피드백도 삼십분안에 써야해 세시반에 팀싱크 나는 열시부터 열두시 집중잘됨";

export async function smoke() {
  const checks = [];

  // S0: 배포 URL (기준 3)
  if (DEPLOYED_URL) {
    const r = await fetchSafe(DEPLOYED_URL);
    checks.push((r.status > 0 && r.status < 500)
      ? result("S0_deployed_url", "배포 URL 응답", "pass", `${DEPLOYED_URL} → ${r.status}`)
      : result("S0_deployed_url", "배포 URL 응답", "fail", `${DEPLOYED_URL} 실패 (${r._error || r.status})`));
  } else {
    checks.push(result("S0_deployed_url", "배포 URL 응답", "warn", "DEPLOYED_URL 미설정 — 배포 후 점검"));
  }

  // S1: 서버 기동
  const root = await fetchSafe(BASE_URL);
  const up = root.status > 0 && root.status < 500;
  checks.push(up
    ? result("S1_server_up", "서버 기동", "pass", `${BASE_URL} → ${root.status}`)
    : result("S1_server_up", "서버 기동", "fail", `${BASE_URL} 응답 없음 (${root._error || root.status}). npm run dev 먼저.`));

  if (!up) {
    for (const [id, t] of [["S2_agent_endpoint","에이전트 엔드포인트"],["S3_streaming","스트리밍 응답"],["S4_error_handling","오류 처리"],["S5_stt_robustness","STT 견고성"]])
      checks.push(result(id, t, "fail", "서버 미기동으로 건너뜀"));
    return checks;
  }

  // S2/S3: 에이전트 엔드포인트 + 스트리밍 (입력 키는 transcript)
  const agentRes = await postJson(BASE_URL + AGENT_PATH, { transcript: "오늘 회의록 정리하고 세시에 미팅" });
  const ctype = agentRes.headers?.get?.("content-type") || "";
  let body = ""; try { body = agentRes.text ? await agentRes.text() : ""; } catch {}
  checks.push(agentRes.status === 200 && body.length > 0
    ? result("S2_agent_endpoint", "에이전트 엔드포인트", "pass", `${AGENT_PATH} → 200, ${body.length}B`)
    : result("S2_agent_endpoint", "에이전트 엔드포인트", agentRes.status === 0 ? "fail" : "warn",
        `${AGENT_PATH} → ${agentRes.status || agentRes._error}. (입력 키가 transcript가 맞는지 확인: AGENT_PATH/payload)`));

  const isSSE = /text\/event-stream/.test(ctype) || /^event:|^data:/m.test(body);
  checks.push(isSSE
    ? result("S3_streaming", "스트리밍 응답", "pass", "SSE(text/event-stream) 감지")
    : result("S3_streaming", "스트리밍 응답", "warn", `스트리밍 미감지(content-type: ${ctype || "?"}). SSE 권장(기준 1·5)`));

  // S4: 잘못된 입력 → 4xx
  const bad = await postJson(BASE_URL + AGENT_PATH, {});
  checks.push(bad.status >= 400 && bad.status < 500
    ? result("S4_error_handling", "오류 처리", "pass", `빈 입력 → ${bad.status}`)
    : result("S4_error_handling", "오류 처리", bad.status >= 500 ? "fail" : "warn",
        `빈 입력 → ${bad.status || bad._error}. 4xx 검증 권장`));

  // S5: STT 견고성 — 오인식/오타 섞인 입력에도 계획(시간/항목)이 나오는가
  const messy = await postJson(BASE_URL + AGENT_PATH, { transcript: MESSY_TRANSCRIPT });
  let mbody = ""; try { mbody = messy.text ? await messy.text() : ""; } catch {}
  const hasTime = /([01]?\d|2[0-3])\s*[:시]/.test(mbody) || /\d{1,2}:\d{2}/.test(mbody);
  const nonEmpty = messy.status === 200 && mbody.length > 40;
  checks.push(nonEmpty && hasTime
    ? result("S5_stt_robustness", "STT 견고성", "pass", "오인식 섞인 입력 → 시간 포함 계획 응답 생성")
    : result("S5_stt_robustness", "STT 견고성", nonEmpty ? "warn" : "fail",
        `오인식 입력 처리 확인 필요 (status ${messy.status || messy._error}, 시간토큰 ${hasTime ? "있음" : "없음"})`));

  // (참고) 재계획 엔드포인트 — 있으면 점검, 없으면 표시만
  const replan = await postJson(BASE_URL + REPLAN_PATH, { change: "지금 긴급 장애 대응 1시간 추가", currentPlan: {} });
  if (replan.status && replan.status !== 404) {
    checks.push(replan.status < 500
      ? result("S6_replan", "재계획 엔드포인트", replan.status === 200 ? "pass" : "warn", `${REPLAN_PATH} → ${replan.status}`)
      : result("S6_replan", "재계획 엔드포인트", "warn", `${REPLAN_PATH} → ${replan.status}`));
  } else {
    checks.push(result("S6_replan", "재계획 엔드포인트", "warn", `${REPLAN_PATH} 없음(또는 404). 재계획은 PulsePlan 차별화 기능`));
  }

  return checks;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await smoke();
  for (const c of checks) console.log(`[${c.status.toUpperCase()}] ${c.id} — ${c.title}: ${c.evidence}`);
}
