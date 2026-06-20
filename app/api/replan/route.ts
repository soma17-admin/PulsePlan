import {
  buildFallbackReplan,
  foundryConfigured,
  runCopilotReplan,
} from "@/lib/copilot";
import { getOrCreateSessionId } from "@/lib/session";
import { store } from "@/lib/store";
import type { Plan, PlanningResult } from "@/lib/types";

export const runtime = "nodejs";

function eventChunk(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    change?: string;
    currentPlan?: Plan | null;
    transcript?: string;
  } | null;
  const change = body?.change?.trim();

  if (!change) {
    return new Response(JSON.stringify({ error: "change required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 사용자별 스냅샷 분리를 위해 스트림 시작 전에 세션 쿠키를 확정한다.
  const sessionId = await getOrCreateSessionId();
  const transcript =
    body?.transcript ?? (await store.currentTranscript(sessionId));
  const currentPlan = body?.currentPlan ?? (await store.currentPlan(sessionId));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(eventChunk(event, data)));

      let result: PlanningResult | null = null;

      // 1) 재계획도 동일한 Copilot SDK 도구 체인으로 구동(extract→score→schedule→explain).
      if (foundryConfigured()) {
        push("status", {
          message:
            "Azure Foundry 에이전트가 변경을 반영해 남은 하루를 다시 배치합니다.",
        });
        try {
          result = await runCopilotReplan(change, currentPlan, transcript, push);
        } catch {
          result = null;
        }
      }

      // 2) 세션/자격 실패 시 결정적 재계획으로 폴백(동일 이벤트 스트림 + 투명 표시).
      if (!result) {
        const usedFallback = foundryConfigured();
        push("source", {
          mode: usedFallback ? "fallback" : "local",
          message: usedFallback
            ? "에이전트 세션을 사용할 수 없어 로컬 재계획으로 처리했습니다."
            : "로컬 재계획으로 처리했습니다(Azure Foundry 미연결).",
        });
        const replanned = await buildFallbackReplan(
          change,
          currentPlan,
          transcript,
        );
        push("tool", { name: "extract_items", label: "항목 추출" });
        push("preview", replanned.preview);
        push("tool", { name: "score_tasks", label: "점수 계산" });
        push("tasks", replanned.scoredTasks);
        push("tool", { name: "build_schedule", label: "시간표 재배치" });
        push("plan", replanned.plan);
        push("tool", { name: "explain_plan", label: "배치 근거 설명" });
        push("explanation", replanned.explanation);
        result = replanned;
      } else {
        push("source", {
          mode: "agent",
          message: "Azure Foundry 에이전트가 도구 체인으로 재배치했습니다.",
        });
      }

      await store.saveDraft(
        sessionId,
        `${transcript} 그리고 ${change}`.trim(),
        result,
      );
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
