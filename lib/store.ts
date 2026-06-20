import type { Plan, PlanningResult } from "@/lib/types";

type Snapshot = {
  transcript: string;
  latest: PlanningResult | null;
  approvedPlan: Plan | null;
};

const snapshot: Snapshot = {
  transcript: "",
  latest: null,
  approvedPlan: null,
};

export const store = {
  saveDraft(transcript: string, result: PlanningResult) {
    snapshot.transcript = transcript;
    snapshot.latest = result;
    return snapshot;
  },
  approveLatest() {
    snapshot.approvedPlan = snapshot.latest?.plan ?? null;
    return snapshot.approvedPlan;
  },
  currentTranscript() {
    return snapshot.transcript;
  },
  currentPlan() {
    return snapshot.latest?.plan ?? null;
  },
};
