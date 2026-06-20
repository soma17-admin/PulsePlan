import type { Plan, PlanningResult } from "@/lib/types";

type Snapshot = {
  id: string;
  sessionId: string;
  transcript: string;
  latest: PlanningResult | null;
  approvedPlan: Plan | null;
  approvedAt: string | null;
  updatedAt: string;
};

// 사용자(브라우저 쿠키)별로 스냅샷을 분리한다. 문서/파티션 키는 `session:{sessionId}`.
function snapshotId(sessionId: string) {
  return `session:${sessionId}`;
}

function emptySnapshot(sessionId: string): Snapshot {
  return {
    id: snapshotId(sessionId),
    sessionId,
    transcript: "",
    latest: null,
    approvedPlan: null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

// 인메모리 폴백 겸 라이트스루 캐시(세션 id → 스냅샷). Cosmos 미설정/실패 시 단독 동작한다.
const memory = new Map<string, Snapshot>();

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || "pulseplan";
const COSMOS_CONTAINER = process.env.COSMOS_CONTAINER || "sessions";

export function cosmosConfigured() {
  return Boolean(COSMOS_ENDPOINT && COSMOS_KEY);
}

// @azure/cosmos 의 최소 표면만 로컬 타입으로 둔다(동적 import, 선택적 의존성).
type CosmosContainer = {
  items: { upsert: (doc: Snapshot) => Promise<unknown> };
  item: (
    id: string,
    partitionKey: string,
  ) => { read: <T>() => Promise<{ resource?: T }> };
};

let containerPromise: Promise<CosmosContainer | null> | null = null;

async function getContainer(): Promise<CosmosContainer | null> {
  if (!cosmosConfigured()) return null;
  if (!containerPromise) {
    containerPromise = (async () => {
      try {
        const { CosmosClient } = await import("@azure/cosmos");
        const client = new CosmosClient({
          endpoint: COSMOS_ENDPOINT as string,
          key: COSMOS_KEY as string,
        });
        const { database } = await client.databases.createIfNotExists({
          id: COSMOS_DATABASE,
        });
        const { container } = await database.containers.createIfNotExists({
          id: COSMOS_CONTAINER,
          partitionKey: { paths: ["/id"] },
        });
        return container as unknown as CosmosContainer;
      } catch (error) {
        console.error("[store] Cosmos 초기화 실패 — 인메모리로 폴백:", error);
        return null;
      }
    })();
  }
  return containerPromise;
}

async function load(sessionId: string): Promise<Snapshot> {
  const id = snapshotId(sessionId);
  const cached = memory.get(id);
  const container = await getContainer();
  if (!container) return cached ?? emptySnapshot(sessionId);
  try {
    const { resource } = await container.item(id, id).read<Snapshot>();
    if (resource) {
      memory.set(id, resource);
      return resource;
    }
  } catch (error) {
    console.error("[store] Cosmos 읽기 실패 — 인메모리 사용:", error);
  }
  return cached ?? emptySnapshot(sessionId);
}

async function persist(next: Snapshot): Promise<Snapshot> {
  next.updatedAt = new Date().toISOString();
  memory.set(next.id, next);
  const container = await getContainer();
  if (container) {
    try {
      await container.items.upsert(next);
    } catch (error) {
      console.error("[store] Cosmos 저장 실패 — 인메모리 유지:", error);
    }
  }
  return next;
}

export const store = {
  async saveDraft(sessionId: string, transcript: string, result: PlanningResult) {
    const current = await load(sessionId);
    return persist({ ...current, transcript, latest: result });
  },
  // 승인 = 현재 초안을 확정 계획으로 고정하고 확정 시각을 남긴다(감사 추적).
  async approveLatest(sessionId: string) {
    const current = await load(sessionId);
    const approvedPlan = current.latest?.plan ?? null;
    const approvedAt = approvedPlan ? new Date().toISOString() : null;
    await persist({ ...current, approvedPlan, approvedAt });
    return { plan: approvedPlan, approvedAt };
  },
  async currentTranscript(sessionId: string) {
    return (await load(sessionId)).transcript;
  },
  async currentPlan(sessionId: string) {
    return (await load(sessionId)).latest?.plan ?? null;
  },
  async approvedPlan(sessionId: string) {
    const snapshot = await load(sessionId);
    return { plan: snapshot.approvedPlan, approvedAt: snapshot.approvedAt };
  },
};

