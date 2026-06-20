import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const SESSION_COOKIE = "pulseplan_sid";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

// 브라우저별 세션을 쿠키로 분리한다. 저장소 스냅샷이 사용자 간 섞이지 않도록 한다(기준 6).
// 라우트 핸들러에서 쿠키 쓰기가 막혀 있으면(읽기 전용 컨텍스트) 임시 id 로 graceful degrade.
export async function getOrCreateSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  try {
    jar.set(SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS,
    });
  } catch {
    // 일부 컨텍스트에서는 쿠키가 불변일 수 있다 — 메모리 스냅샷은 이 id 로 동작.
  }
  return id;
}
