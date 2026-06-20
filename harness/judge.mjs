// harness/judge.mjs
// (선택) 루브릭 기반 LLM-as-judge. 평가자 AI를 시뮬레이션해 7개 기준을 채점한다.
// 모델 계층도 Azure AI Foundry/Azure OpenAI로 호출 → 대회 주제와 일관.
// 필요 환경변수:
//   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT
//   (선택) AZURE_OPENAI_API_VERSION  기본값 2024-10-21
// 미설정 시 안내만 출력하고 건너뛴다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const HERE = path.join(ROOT, "harness");

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2024-10-21";

async function readSafe(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}

export function judgeConfigured() {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

async function gatherEvidence(autoResults) {
  const readme = await readSafe(path.join(ROOT, "README.md"));
  const keyFiles = [
    "lib/copilot.ts",
    "lib/planner.ts",
    "lib/extract.ts",
    "lib/store.ts",
    "lib/mcp.ts",
    "lib/normalize.ts",
    "app/api/agent/route.ts",
    "app/api/replan/route.ts",
    "components/PulsePlanClient.tsx",
    "AGENTS.md",
  ];
  let code = "";
  for (const f of keyFiles) {
    const src = await readSafe(path.join(ROOT, f));
    if (src) code += `\n\n===== ${f} =====\n${src.slice(0, 4000)}`;
  }
  return {
    readme: readme.slice(0, 6000),
    code: code.slice(0, 16000),
    autoResults,
  };
}

export async function judge(autoResults) {
  if (!judgeConfigured()) {
    return {
      skipped: true,
      reason: "AZURE_OPENAI_* 환경변수 미설정으로 LLM 채점 건너뜀",
    };
  }
  const rubric = JSON.parse(await readSafe(path.join(HERE, "rubric.json")));
  const evidence = await gatherEvidence(autoResults);

  const system = [
    "너는 입코딩 2026 심사위원이다. 제공된 루브릭과 증거만 근거로 공정하게 채점한다.",
    "각 기준을 0-100으로 채점하고, 한국어로 1-2문장 근거를 단다.",
    "증거가 부족하면 후하게 주지 말고 보수적으로 채점한다.",
    "반드시 아래 JSON 형식만 출력한다(설명 텍스트·마크다운 금지):",
    '{"scores":[{"id":1,"score":0,"reason":""}, ...]}',
  ].join("\n");

  const user = [
    "## 루브릭",
    JSON.stringify(rubric.criteria, null, 2),
    "## 자동 점검 결과(JSON)",
    JSON.stringify(evidence.autoResults, null, 2),
    "## README",
    evidence.readme,
    "## 핵심 소스",
    evidence.code,
  ].join("\n\n");

  const url = `${ENDPOINT.replace(/\/$/, "")}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": KEY },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    return { skipped: true, reason: `Foundry 호출 실패: ${e?.message || e}` };
  }
  if (!res.ok) {
    return { skipped: true, reason: `Foundry 응답 오류: ${res.status}` };
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { skipped: true, reason: "JSON 파싱 실패", raw: content };
  }

  // 가중 합산
  const byId = Object.fromEntries((parsed.scores || []).map((s) => [s.id, s]));
  let weighted = 0;
  const detail = rubric.criteria.map((c) => {
    const s = byId[c.id]?.score ?? 0;
    weighted += (s / 100) * c.weight;
    return {
      id: c.id,
      name: c.name,
      weight: c.weight,
      score: s,
      reason: byId[c.id]?.reason || "",
    };
  });
  return { skipped: false, total: Math.round(weighted * 100), detail };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await judge([]);
  console.log(JSON.stringify(out, null, 2));
}
