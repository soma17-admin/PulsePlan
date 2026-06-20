export type ExtractedTask = {
  id: string;
  title: string;
  durationMin: number;
  deadline?: string;
  importance: number;
  urgency: number;
  confidence: number;
  source: string;
};

export type FixedEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  source: string;
};

export type FocusWindow = {
  id: string;
  start: string;
  end: string;
  source: string;
};

export type PlanBlock = {
  taskId: string;
  title: string;
  start: string;
  end: string;
  reason: string;
  reasoning?: string;
  durationMin?: number;
  changed?: boolean;
};

export type Plan = {
  blocks: PlanBlock[];
  assumptions: string[];
  dropped: string[];
  summary: string[];
};

export type ExtractedItems = {
  tasks: ExtractedTask[];
  fixed: FixedEvent[];
  focus: FocusWindow[];
  assumptions: string[];
};

export type PlanningResult = {
  normalizedTranscript: string;
  preview: ExtractedItems;
  scoredTasks: ExtractedTask[];
  plan: Plan;
  explanation: string[];
};
