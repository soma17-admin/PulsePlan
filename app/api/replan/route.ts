import { replanDay } from "@/lib/planner";
import { store } from "@/lib/store";
import type { Plan } from "@/lib/types";

export const runtime = "nodejs";

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

  const transcript = body?.transcript ?? (await store.currentTranscript());
  const currentPlan = body?.currentPlan ?? (await store.currentPlan());

  // 재계획은 즉시 응답이 중요하므로 결정적 플래너(에이전트 build_schedule 과 동일 엔진)를 사용한다.
  const replanned = replanDay(change, currentPlan, transcript);
  await store.saveDraft(`${transcript} 그리고 ${change}`.trim(), replanned);

  return Response.json(replanned);
}
