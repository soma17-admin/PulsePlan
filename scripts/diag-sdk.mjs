// 일회성 진단 v3: COPILOT_CLI_PATH 지정 + 인증/BYOK 테스트. (커밋 안 함)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

// npm-loader.js 는 플랫폼 바이너리를 자동 선택하므로 크로스플랫폼 안전.
const cliPath = resolve("node_modules/@github/copilot/npm-loader.js");
process.env.COPILOT_CLI_PATH = cliPath;
console.log("CLI path:", cliPath);

const sdk = await import("@github/copilot-sdk");
const client = new sdk.CopilotClient({ logLevel: "debug" });
try {
  console.log("starting client...");
  await client.start();
  console.log("client started OK");
  const auth = await client.getAuthStatus().catch((e) => ({ error: e?.message }));
  console.log("authStatus:", JSON.stringify(auth));

  console.log("creating session (BYOK azure)...");
  const session = await client.createSession({
    model: "gpt-4o",
    provider: {
      type: "azure",
      baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      azure: { apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21" },
      modelId: "gpt-4o",
      wireModel: process.env.AZURE_OPENAI_DEPLOYMENT,
    },
    onPermissionRequest: async () => ({ kind: "approve-once" }),
  });
  console.log("session created OK");
  const res = await session.sendAndWait({ prompt: "한 단어로만: 준비됐나?" }, 60000);
  console.log("MODEL RESPONSE:", JSON.stringify(res?.data?.content ?? res));
  await session.disconnect();
} catch (e) {
  console.log("ERROR:", e?.message);
  console.log("STACK:", e?.stack?.split("\n").slice(0, 8).join("\n"));
} finally {
  await client.stop().catch(() => {});
  process.exit(0);
}
