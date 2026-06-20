// harness/run.mjs
// 전체 자가 점검·자가 채점을 실행하고 harness/report.md 를 만든다.
// 사용:
//   node harness/run.mjs                 # 정적 점검 + 스모크
//   node harness/run.mjs --judge         # + Azure Foundry LLM 채점(자격증명 필요)
//   BASE_URL=... DEPLOYED_URL=... node harness/run.mjs --judge
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { checkConstraints } from "./check-constraints.mjs";
import { smoke } from "./smoke.mjs";
import { judge, judgeConfigured } from "./judge.mjs";

const ROOT = process.cwd();
const HERE = path.join(ROOT, "harness");
const wantJudge = process.argv.includes("--judge");

const ICON = { pass: "✅", warn: "⚠️", fail: "❌" };
const SCORE = { pass: 1, warn: 0.5, fail: 0 };

function readinessByCriterion(rubric, all) {
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  return rubric.criteria.map((c) => {
    if (!c.autoChecks.length) return { ...c, auto: null };
    const vals = c.autoChecks.map((id) => SCORE[byId[id]?.status] ?? 0);
    const pct = Math.round(
      (vals.reduce((a, b) => a + b, 0) / vals.length) * 100,
    );
    return { ...c, auto: pct };
  });
}

function table(rows) {
  return rows
    .map(
      (c) =>
        `| ${c.id} | ${c.name} | ${(c.weight * 100).toFixed(0)}% | ${c.auto == null ? "수동 검토" : c.auto + "%"} |`,
    )
    .join("\n");
}

async function main() {
  const rubric = JSON.parse(
    await readFile(path.join(HERE, "rubric.json"), "utf8"),
  );
  console.log("▶ 정적 제약 점검...");
  const constraints = await checkConstraints();
  console.log("▶ 엔드투엔드 스모크...");
  const smk = await smoke();

  const all = [...constraints, ...smk];
  for (const c of all)
    console.log(`  ${ICON[c.status]} ${c.id} — ${c.title}: ${c.evidence}`);

  const readiness = readinessByCriterion(rubric, all);
  const fails = all.filter((c) => c.status === "fail");

  let judgeOut = null;
  if (wantJudge) {
    console.log(
      judgeConfigured()
        ? "▶ LLM-as-judge (Azure Foundry)..."
        : "▶ LLM 채점 건너뜀(자격증명 없음)",
    );
    judgeOut = await judge(all);
  }

  // 리포트 작성
  const lines = [];
  lines.push(`# PulsePlan 제출 전 자가 점검 리포트`);
  lines.push(`생성: ${new Date().toISOString()}\n`);
  lines.push(`## 요약`);
  lines.push(
    `- 자동 점검: ${all.length}개 / 실패 ${fails.length} / 경고 ${all.filter((c) => c.status === "warn").length}`,
  );
  if (fails.length)
    lines.push(
      `- ❌ **차단 항목 있음** — 제출 전 반드시 해결:\n${fails.map((f) => `  - ${f.id}: ${f.evidence}`).join("\n")}`,
    );
  else lines.push(`- ✅ 차단(fail) 항목 없음`);
  lines.push("");

  lines.push(`## 평가 기준별 자동 준비도`);
  lines.push(`| # | 기준 | 가중치 | 자동 준비도 |`);
  lines.push(`|---|------|------:|-----------:|`);
  lines.push(table(readiness));
  lines.push(
    `\n> "수동 검토"는 자동화로 판단 불가한 항목(문제 적합성·UX·독창성). 루브릭의 review 지침으로 사람이 확인.\n`,
  );

  lines.push(`## 자동 점검 상세`);
  lines.push(`| 상태 | ID | 항목 | 근거 |`);
  lines.push(`|------|----|------|------|`);
  for (const c of all)
    lines.push(
      `| ${ICON[c.status]} | ${c.id} | ${c.title} | ${c.evidence.replace(/\|/g, "/")} |`,
    );
  lines.push("");

  if (judgeOut) {
    lines.push(`## LLM-as-judge (참고용 시뮬레이션)`);
    if (judgeOut.skipped) {
      lines.push(`건너뜀: ${judgeOut.reason}`);
    } else {
      lines.push(`**가중 총점(시뮬레이션): ${judgeOut.total}/100**\n`);
      lines.push(`| # | 기준 | 점수 | 근거 |`);
      lines.push(`|---|------|-----:|------|`);
      for (const d of judgeOut.detail)
        lines.push(
          `| ${d.id} | ${d.name} | ${d.score} | ${(d.reason || "").replace(/\|/g, "/")} |`,
        );
      lines.push(`\n> 실제 심사 결과가 아닌 자가 점검용 추정치다.`);
    }
    lines.push("");
  }

  const reportPath = path.join(HERE, "report.md");
  await writeFile(reportPath, lines.join("\n"), "utf8");
  console.log(`\n📄 리포트 저장: ${path.relative(ROOT, reportPath)}`);
  if (fails.length) {
    console.log(`❌ 차단 항목 ${fails.length}개 — 해결 후 다시 실행하라.`);
    process.exitCode = 1;
  } else console.log(`✅ 차단 항목 없음.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
