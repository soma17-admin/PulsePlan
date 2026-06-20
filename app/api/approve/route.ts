import { getOrCreateSessionId } from "@/lib/session";
import { store } from "@/lib/store";

export const runtime = "nodejs";

// 승인 = 위험 작업의 명시적 사람 확인 게이트(기준 6). 현재 초안을 확정 계획으로 고정한다.
export async function POST() {
  const sessionId = await getOrCreateSessionId();
  const { plan, approvedAt } = await store.approveLatest(sessionId);

  if (!plan) {
    return Response.json(
      { error: "확정할 계획이 없습니다. 먼저 계획을 생성하세요." },
      { status: 409 },
    );
  }

  return Response.json({ approved: true, approvedAt, plan });
}

// 현재 확정된 계획 조회(감사/복구용).
export async function GET() {
  const sessionId = await getOrCreateSessionId();
  const { plan, approvedAt } = await store.approvedPlan(sessionId);
  return Response.json({ approved: Boolean(plan), approvedAt, plan });
}
