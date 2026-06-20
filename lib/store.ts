import type { Plan, PlanningResult } from "@/lib/types";

type Snapshot = {
  id: string;
  transcript: string;
  latest: PlanningResult | null;
  approvedPlan: Plan | null;
  updatedAt: string;
};

const SNAPSHOT_ID = "session:current";

function emptySnapshot(): Snapshot {
  return {
    id: SNAPSHOT_ID,
    transcript: "",
    latest: null,
    approvedPlan: null,
    updatedAt: new Date().toISOString(),
  };
}

// 인메모리 폴백 겸 라이트스루 캐시. Cosmos 미설정/실패 시 단독 동작한다.
let memory: Snapshot = emptySnapshot();

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

async function load(): Promise<Snapshot> {
  const container = await getContainer();
  if (!container) return memory;
  try {
    const { resource } = await container
      .item(SNAPSHOT_ID, SNAPSHOT_ID)
      .read<Snapshot>();
    if (resource) {
      memory = resource;
      return resource;
    }
  } catch (error) {
    console.error("[store] Cosmos 읽기 실패 — 인메모리 사용:", error);
  }
  return memory;
}

async function persist(next: Snapshot): Promise<Snapshot> {
  next.updatedAt = new Date().toISOString();
  memory = next;
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
  async saveDraft(transcript: string, result: PlanningResult) {
    const current = await load();
    return persist({ ...current, transcript, latest: result });
  },
  async approveLatest() {
    const current = await load();
    const approvedPlan = current.latest?.plan ?? null;
    await persist({ ...current, approvedPlan });
    return approvedPlan;
  },
  async currentTranscript() {
    return (await load()).transcript;
  },
  async currentPlan() {
    return (await load()).latest?.plan ?? null;
  },
};
