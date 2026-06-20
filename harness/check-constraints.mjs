// harness/check-constraints.mjs
// 레포 루트에서 실행. 필수 요소·시크릿·구조를 정적으로 점검한다.
// 사용: node harness/check-constraints.mjs
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const result = (id, title, status, evidence) => ({
  id,
  title,
  status,
  evidence,
}); // pass|warn|fail

async function readSafe(p) {
  try {
    return await readFile(path.join(ROOT, p), "utf8");
  } catch {
    return null;
  }
}
async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (["node_modules", ".git", ".next", "dist", "build"].includes(e.name))
      continue;
    const rel = path
      .join(dir, e.name)
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");
    if (e.isDirectory()) await walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
}
function gitTrackedFiles() {
  try {
    return execSync("git ls-files", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export async function checkConstraints() {
  const checks = [];
  const files = await walk(".");
  const codeFiles = files.filter(
    (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !f.startsWith("harness/"),
  );
  const allSrcArr = (await Promise.all(codeFiles.map(readSafe))).filter(
    Boolean,
  );
  const allSrc = allSrcArr.join("\n");

  // C1: Copilot SDK 의존성
  const pkgRaw = await readSafe("package.json");
  let pkg = null;
  try {
    pkg = pkgRaw ? JSON.parse(pkgRaw) : null;
  } catch {}
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  checks.push(
    "@github/copilot-sdk" in deps
      ? result(
          "C1_sdk_dependency",
          "Copilot SDK 의존성",
          "pass",
          "@github/copilot-sdk 설치됨",
        )
      : result(
          "C1_sdk_dependency",
          "Copilot SDK 의존성",
          "fail",
          "package.json에 @github/copilot-sdk 없음",
        ),
  );

  // C2: SDK 서버 전용 (클라이언트 컴포넌트에서 import 금지)
  const clientImports = [];
  for (const f of codeFiles) {
    const src = await readSafe(f);
    if (
      src &&
      /^\s*["']use client["']/.test(src) &&
      src.includes("@github/copilot-sdk")
    )
      clientImports.push(f);
  }
  checks.push(
    clientImports.length === 0
      ? result(
          "C2_sdk_server_only",
          "SDK 서버 전용",
          "pass",
          "클라이언트에서 SDK import 없음",
        )
      : result(
          "C2_sdk_server_only",
          "SDK 서버 전용",
          "fail",
          `클라이언트 SDK import: ${clientImports.join(", ")}`,
        ),
  );

  // C3: Azure AI Foundry/OpenAI 설정 흔적
  const envExample = (await readSafe(".env.example")) || "";
  const usesFoundry =
    /AZURE_OPENAI_|AI_FOUNDRY|azure.*foundry/i.test(allSrc) ||
    /AZURE_OPENAI_|FOUNDRY/i.test(envExample);
  checks.push(
    usesFoundry
      ? result(
          "C3_azure_foundry_configured",
          "Azure Foundry 모델 연결",
          "pass",
          "AZURE_OPENAI_/Foundry 설정 흔적 있음",
        )
      : result(
          "C3_azure_foundry_configured",
          "Azure Foundry 모델 연결",
          "warn",
          "Foundry/Azure OpenAI 설정 흔적 없음(기준 3 최고점 조건)",
        ),
  );

  // C4: 배포 산출물
  const hasDocker = existsSync(path.join(ROOT, "Dockerfile"));
  const hasAzd =
    existsSync(path.join(ROOT, "azure.yaml")) ||
    existsSync(path.join(ROOT, "infra"));
  checks.push(
    hasDocker && hasAzd
      ? result(
          "C4_deploy_artifacts",
          "배포 산출물",
          "pass",
          "Dockerfile + azure.yaml/infra 존재",
        )
      : result(
          "C4_deploy_artifacts",
          "배포 산출물",
          "warn",
          `누락: ${!hasDocker ? "Dockerfile " : ""}${!hasAzd ? "azure.yaml/infra" : ""}`,
        ),
  );

  // C5: 시크릿 노출
  const tracked = gitTrackedFiles();
  const secretFindings = [];
  const secretPatterns = [
    /sk-[A-Za-z0-9]{20,}/,
    /AZURE_OPENAI_API_KEY\s*=\s*["']?[A-Za-z0-9]{16,}/,
    /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9]{20,}["']/i,
  ];
  for (const f of tracked || files) {
    if (/\.(png|jpg|jpeg|gif|ico|lock)$/i.test(f)) continue;
    const src = await readSafe(f);
    if (src && secretPatterns.some((re) => re.test(src)))
      secretFindings.push(f);
  }
  const envTracked = tracked
    ? tracked.some((f) => /(^|\/)\.env(\.local)?$/.test(f))
    : false;
  const ignoresEnv = /\.env(\.local)?/.test(
    (await readSafe(".gitignore")) || "",
  );
  if (secretFindings.length || envTracked) {
    checks.push(
      result(
        "C5_no_secrets",
        "시크릿 비노출",
        "fail",
        `${secretFindings.length ? "키 의심: " + secretFindings.join(", ") + ". " : ""}${envTracked ? ".env(.local) 커밋됨" : ""}`,
      ),
    );
  } else {
    checks.push(
      result(
        "C5_no_secrets",
        "시크릿 비노출",
        ignoresEnv ? "pass" : "warn",
        ignoresEnv
          ? "키 노출 없음, .env gitignore됨"
          : "키 노출 없음(.gitignore에 .env 명시 권장)",
      ),
    );
  }

  // C6: README 데모 URL + 실행법
  const readme = (await readSafe("README.md")) || "";
  const hasUrl = /https?:\/\/[^\s)]+/.test(readme);
  const hasRun = /(npm (ci|install|run)|azd up)/.test(readme);
  checks.push(
    hasUrl && hasRun
      ? result(
          "C6_readme_demo_url",
          "README 데모URL+실행법",
          "pass",
          "데모 URL+실행법 기재",
        )
      : result(
          "C6_readme_demo_url",
          "README 데모URL+실행법",
          "warn",
          `README에 ${!hasUrl ? "데모 URL " : ""}${!hasRun ? "실행법" : ""} 보강 필요`,
        ),
  );

  // C7: 승인 게이트(전체 허용 금지)
  const hasGate = /onPermissionRequest/.test(allSrc);
  const allowAll =
    /--allow-all-tools/.test(allSrc) ||
    (/approveAll/.test(allSrc) &&
      !/risk|danger|askUser|approved\s*:/.test(allSrc));
  checks.push(
    hasGate && !allowAll
      ? result(
          "C7_permission_gate",
          "위험작업 승인 게이트",
          "pass",
          "onPermissionRequest 기반 승인 흐름 있음",
        )
      : allowAll
        ? result(
            "C7_permission_gate",
            "위험작업 승인 게이트",
            "fail",
            "전체 허용(approveAll/--allow-all-tools) 사용. 위험 작업은 사람 확인 필요(기준 6)",
          )
        : result(
            "C7_permission_gate",
            "위험작업 승인 게이트",
            "warn",
            "승인 게이트(onPermissionRequest)를 못 찾음",
          ),
  );

  // C8: 음성 입력 (Web Speech API 등) — 기준 5/테마
  const hasVoice =
    /SpeechRecognition|webkitSpeechRecognition|@azure\/.*speech|cognitiveservices.*speech|\/api\/transcribe/i.test(
      allSrc,
    );
  checks.push(
    hasVoice
      ? result(
          "C8_voice_input",
          "음성 입력",
          "pass",
          "음성인식(Web Speech/Azure Speech) 흔적 있음",
        )
      : result(
          "C8_voice_input",
          "음성 입력",
          "warn",
          "음성 입력 흔적 없음(SpeechRecognition/Azure Speech). 테마 핵심",
        ),
  );

  // C9: MCP 구성
  const hasMcp =
    /mcpServers|mcp_servers|@azure\/mcp|MCPLocalServerConfig|modelcontextprotocol/i.test(
      allSrc,
    ) || existsSync(path.join(ROOT, "lib/mcp.ts"));
  checks.push(
    hasMcp
      ? result(
          "C9_mcp_configured",
          "MCP 구성",
          "pass",
          "mcpServers/Azure MCP 설정 흔적 있음",
        )
      : result(
          "C9_mcp_configured",
          "MCP 구성",
          "warn",
          "MCP 구성 흔적 없음(요구사항: Azure MCP 연결)",
        ),
  );

  return checks;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await checkConstraints();
  for (const c of checks)
    console.log(
      `[${c.status.toUpperCase()}] ${c.id} — ${c.title}: ${c.evidence}`,
    );
}
