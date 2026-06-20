import { replanDayWithModel } from "@/lib/planner";
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

  // 변경 입력의 의미 분석은 Foundry 모델이 수행하고, 스케줄링은 결정적 엔진이 처리한다.
  const replanned = await replanDayWithModel(change, currentPlan, transcript);
  await store.saveDraft(`${transcript} 그리고 ${change}`.trim(), replanned);

  return Response.json(replanned);
}
