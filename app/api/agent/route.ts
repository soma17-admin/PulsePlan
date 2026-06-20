import {
  buildFallbackPlanning,
  foundryConfigured,
  runCopilotPlanning,
} from "@/lib/copilot";
import { getOrCreateSessionId } from "@/lib/session";
import { store } from "@/lib/store";
import type { PlanningResult } from "@/lib/types";

export const runtime = "nodejs";

function eventChunk(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    transcript?: string;
  } | null;
  const transcript = body?.transcript?.trim();

  if (!transcript) {
    return new Response(JSON.stringify({ error: "transcript required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 사용자별 스냅샷 분리를 위해 스트림 시작 전에 세션 쿠키를 확정한다.
  const sessionId = await getOrCreateSessionId();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(eventChunk(event, data)));

      let result: PlanningResult | null = null;

      // 1) Copilot SDK 에이전트가 BYOK(Azure Foundry) 모델로 도구를 호출해 계획을 구동.
      if (foundryConfigured()) {
        push("status", {
          message: "Azure Foundry 에이전트가 도구로 계획을 구성하고 있습니다.",
        });
        try {
          result = await runCopilotPlanning(transcript, push);
        } catch {
          result = null;
        }
      }

      // 2) 자격증명이 없거나 세션이 실패하면 로컬 플래너로 폴백(동일 이벤트 스트림).
      //    폴백은 UI에 투명하게 표시한다(기준 5·6).
      if (!result) {
        const usedFallback = foundryConfigured();
        push("source", {
          mode: usedFallback ? "fallback" : "local",
          message: usedFallback
            ? "에이전트 세션을 사용할 수 없어 로컬 플래너로 계획했습니다."
            : "로컬 플래너로 계획했습니다(Azure Foundry 미연결).",
        });
        const planning = await buildFallbackPlanning(transcript);
        push("status", {
          message: usedFallback
            ? "에이전트 세션을 사용할 수 없어 로컬 플래너로 계획했습니다."
            : "로컬 플래너로 계획했습니다(Azure Foundry 미연결).",
        });
        push("tool", { name: "extract_items", label: "항목 추출" });
        push("preview", planning.preview);
        push("tool", { name: "score_tasks", label: "점수 계산" });
        push("tasks", planning.scoredTasks);
        push("tool", { name: "build_schedule", label: "시간표 제안" });
        push("plan", planning.plan);
        push("tool", { name: "explain_plan", label: "배치 근거 설명" });
        push("explanation", planning.explanation);
        result = planning;
      } else {
        push("source", {
          mode: "agent",
          message: "Azure Foundry 에이전트가 도구 체인으로 계획했습니다.",
        });
      }

      await store.saveDraft(sessionId, transcript, result);
      push("done", result);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
