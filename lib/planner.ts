import { extractItemsWithModel } from "@/lib/extract";
import { formatTime, normalizeTranscript } from "@/lib/normalize";
import type {
  ExtractedItems,
  ExtractedTask,
  FixedEvent,
  FocusWindow,
  Plan,
  PlanBlock,
  PlanningResult,
} from "@/lib/types";

const DEFAULT_START = 9 * 60;
const DEFAULT_END = 18 * 60;

function slugFrom(text: string, index: number) {
  return `${
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  }-${index}`;
}

function sentenceParts(text: string) {
  return text
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseDuration(fragment: string) {
  const minutesMatch = fragment.match(/(\d{1,2})분/);
  if (minutesMatch) {
    return Number(minutesMatch[1]);
  }

  const hoursMatch = fragment.match(/(\d{1,2})시간/);
  if (hoursMatch) {
    return Number(hoursMatch[1]) * 60;
  }

  if (/리뷰|미팅|회의|싱크/.test(fragment)) {
    return 60;
  }

  if (/제안서|수정본|정리|피드백/.test(fragment)) {
    return 45;
  }

  return 30;
}

function extractFocus(text: string): FocusWindow[] {
  const matches = [
    ...text.matchAll(/(\d{1,2})시부터\s*(\d{1,2})시[^.\n]*집중/g),
  ];
  return matches.map((match, index) => ({
    id: `focus-${index + 1}`,
    start: formatTime(Number(match[1]) * 60),
    end: formatTime(Number(match[2]) * 60),
    source: match[0],
  }));
}

function extractFixed(text: string): FixedEvent[] {
  const segments = sentenceParts(text);
  const fixed: FixedEvent[] = [];

  segments.forEach((segment, index) => {
    const atMatch = segment.match(
      /(\d{1,2})시(?:\s*(\d{1,2})분)?(?:에|에는)?\s*([^,.]+?)(?:가 있고|가 있어|이 있어|있고|있어|야|이다|입니다|$)/,
    );
    if (!atMatch) {
      return;
    }

    const start = Number(atMatch[1]) * 60 + Number(atMatch[2] || 0);
    const title = atMatch[3].trim();
    if (!title || /집중/.test(title)) {
      return;
    }

    const duration = /싱크|미팅|회의|리뷰/.test(title) ? 60 : 30;
    fixed.push({
      id: `fixed-${index + 1}`,
      title,
      start: formatTime(start),
      end: formatTime(start + duration),
      source: segment,
    });
  });

  return fixed;
}

function extractTasks(text: string): ExtractedTask[] {
  const segments = sentenceParts(text);
  const tasks: ExtractedTask[] = [];

  segments.forEach((segment, index) => {
    const taskParts = segment
      .split(/그리고|하고|또는|또/)
      .map((part) => part.trim())
      .filter(Boolean);

    taskParts.forEach((part, partIndex) => {
      if (/집중이 제일 잘 돼|집중잘됨|집중 잘됨/.test(part)) {
        return;
      }

      const timeMention = part.match(/(\d{1,2})시(?:\s*(\d{1,2})분)?/);
      const deadlineMatch = part.match(/(\d{1,2})시(?:\s*(\d{1,2})분)?까지/);
      const title = part
        .replace(/오늘|오전|오후/g, "")
        .replace(/(\d{1,2})시(?:\s*(\d{1,2})분)?까지/g, "")
        .replace(/(\d{1,2})시(?:\s*(\d{1,2})분)?(?:에|에는)?/g, "")
        .replace(
          /가 있고|가 있어|있고|있어|해야 해|해야해|써야 해|써야해|정리해야 하고|정리해야하고/g,
          "",
        )
        .replace(/\s+/g, " ")
        .trim();

      if (
        !title ||
        (/리뷰|미팅|회의|싱크/.test(title) && timeMention && !deadlineMatch)
      ) {
        return;
      }

      const duration = parseDuration(part);
      const deadline = deadlineMatch
        ? formatTime(
            Number(deadlineMatch[1]) * 60 + Number(deadlineMatch[2] || 0),
          )
        : undefined;

      const importance = /긴급|마감|제안서|수정본/.test(part)
        ? 5
        : /피드백|회의록/.test(part)
          ? 4
          : 3;
      const urgency = deadline ? 5 : /오늘|오전|오후/.test(part) ? 4 : 3;

      tasks.push({
        id: slugFrom(title, index + partIndex + 1),
        title,
        durationMin: duration,
        deadline,
        importance,
        urgency,
        confidence: timeMention || deadlineMatch ? 0.88 : 0.7,
        source: part,
      });
    });
  });

  return tasks;
}

export function extractItems(transcript: string): ExtractedItems {
  const normalized = normalizeTranscript(transcript);
  const focus = extractFocus(normalized);
  const fixed = extractFixed(normalized);
  const fixedTitles = new Set(fixed.map((event) => event.title));
  const tasks = extractTasks(normalized).filter(
    (task) => !fixedTitles.has(task.title),
  );
  const assumptions: string[] = [];

  if (!focus.length) {
    assumptions.push(
      "집중 시간대가 명확하지 않아 우선순위와 마감 기준으로 배치했습니다.",
    );
  }

  if (!tasks.some((task) => task.deadline)) {
    assumptions.push(
      "명시된 마감이 적어 오늘 안 처리 기준으로 urgency를 계산했습니다.",
    );
  }

  return {
    tasks,
    fixed,
    focus,
    assumptions,
  };
}

export function scoreTasks(tasks: ExtractedTask[]) {
  return [...tasks].sort((left, right) => {
    const leftScore = left.importance * 2 + left.urgency + left.confidence;
    const rightScore = right.importance * 2 + right.urgency + right.confidence;

    if (left.deadline && right.deadline && left.deadline !== right.deadline) {
      return left.deadline.localeCompare(right.deadline);
    }

    return rightScore - leftScore;
  });
}

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function freeSlots(fixed: FixedEvent[]) {
  const sorted = [...fixed].sort((left, right) =>
    left.start.localeCompare(right.start),
  );
  const slots: Array<{ start: number; end: number }> = [];
  let cursor = DEFAULT_START;

  sorted.forEach((event) => {
    const start = minutesOf(event.start);
    const end = minutesOf(event.end);
    if (start > cursor) {
      slots.push({ start: cursor, end: start });
    }
    cursor = Math.max(cursor, end);
  });

  if (cursor < DEFAULT_END) {
    slots.push({ start: cursor, end: DEFAULT_END });
  }

  return slots;
}

function slotBoost(start: number, focus: FocusWindow[]) {
  return focus.some(
    (window) =>
      start >= minutesOf(window.start) && start < minutesOf(window.end),
  );
}

export function buildSchedule(
  items: ExtractedItems,
  scoredTasks: ExtractedTask[],
): Plan {
  const slots = freeSlots(items.fixed);
  const blocks: PlanBlock[] = [];
  const dropped: string[] = [];

  // 고정 일정을 먼저 블록으로 추가
  items.fixed.forEach((fixed) => {
    blocks.push({
      taskId: fixed.id,
      title: fixed.title,
      start: fixed.start,
      end: fixed.end,
      reason: "고정 일정",
      reasoning: "고정 일정으로 보존",
      durationMin: minutesOf(fixed.end) - minutesOf(fixed.start),
    });
  });

  for (const task of scoredTasks) {
    let placed = false;

    for (const slot of slots) {
      const remaining = slot.end - slot.start;
      if (remaining < task.durationMin) {
        continue;
      }

      const start = slot.start;
      const end = slot.start + task.durationMin;
      const reasonParts = [
        `importance ${task.importance}/5`,
        `urgency ${task.urgency}/5`,
      ];
      if (task.deadline) {
        reasonParts.push(`마감 ${task.deadline} 전 완료`);
      }
      if (slotBoost(start, items.focus)) {
        reasonParts.push("집중 시간대 우선 배치");
      }

      blocks.push({
        taskId: task.id,
        title: task.title,
        start: formatTime(start),
        end: formatTime(end),
        reason: reasonParts.join(" · "),
        reasoning: reasonParts.join(" · "),
        durationMin: task.durationMin,
      });

      slot.start = end;
      placed = true;
      break;
    }

    if (!placed) {
      dropped.push(`${task.title} (${task.durationMin}분)`);
    }
  }

  // 시간 순으로 정렬
  blocks.sort((a, b) => a.start.localeCompare(b.start));

  const summary = [
    `${blocks.length - items.fixed.length}개 항목을 오늘 계획에 반영했습니다.`,
    dropped.length
      ? `${dropped.length}개 항목은 시간이 부족해 보류했습니다.`
      : "핵심 항목을 모두 오늘 일정에 반영했습니다.",
  ];

  return {
    blocks,
    assumptions: items.assumptions,
    dropped,
    summary,
  };
}

function planExplanation(preview: ExtractedItems, plan: Plan): string[] {
  const explanation = [
    "고정 일정은 먼저 고정하고, 남은 슬롯에 중요도와 마감을 기준으로 작업을 배치했습니다.",
    preview.focus.length
      ? `집중 시간대 ${preview.focus.map((window) => `${window.start}-${window.end}`).join(", ")}에는 높은 중요도 작업을 우선 배치했습니다.`
      : "집중 시간대가 명확하지 않아 마감과 중요도를 우선시했습니다.",
  ];

  if (plan.dropped.length) {
    explanation.push(`오늘 다 넣지 못한 항목: ${plan.dropped.join(", ")}`);
  }

  if (preview.assumptions.length) {
    explanation.push(`가정: ${preview.assumptions.join(" ")}`);
  }

  return explanation;
}

// 정규식 기반(결정적) 계획. Azure 자격이 없을 때의 폴백 경로.
export function planDay(transcript: string): PlanningResult {
  const normalizedTranscript = normalizeTranscript(transcript);
  const preview = extractItems(normalizedTranscript);
  const scoredTasks = scoreTasks(preview.tasks);
  const plan = buildSchedule(preview, scoredTasks);
  const explanation = planExplanation(preview, plan);

  return {
    normalizedTranscript,
    preview,
    scoredTasks,
    plan,
    explanation,
  };
}

// 입력 의미 분석(추출)을 Foundry gpt-4o 가 수행하고, 점수·스케줄은 결정적 엔진이 처리한다.
// 모델 추출 실패(자격 없음/오류) 시 정규식 추출로 폴백한다.
export async function planDayWithModel(
  transcript: string,
): Promise<PlanningResult> {
  const normalizedTranscript = normalizeTranscript(transcript);
  const aiItems = await extractItemsWithModel(transcript);
  const preview = aiItems ?? extractItems(normalizedTranscript);
  const scoredTasks = scoreTasks(preview.tasks);
  const plan = buildSchedule(preview, scoredTasks);
  const explanation = planExplanation(preview, plan);

  return {
    normalizedTranscript,
    preview,
    scoredTasks,
    plan,
    explanation,
  };
}

function markChangedBlocks(
  replanned: PlanningResult,
  currentPlan?: Plan | null,
): PlanningResult {
  const currentBlocks = Array.isArray(currentPlan?.blocks)
    ? currentPlan.blocks
    : [];
  const currentTitles = new Set(
    currentBlocks.map((block) => `${block.title}-${block.start}-${block.end}`),
  );

  replanned.plan.blocks = replanned.plan.blocks.map((block) => ({
    ...block,
    changed: !currentTitles.has(`${block.title}-${block.start}-${block.end}`),
  }));

  replanned.explanation = [
    "변경 입력을 기존 맥락에 합쳐 남은 슬롯을 다시 계산했습니다.",
    ...replanned.explanation,
  ];

  return replanned;
}

// 정규식 기반 재계획(폴백).
export function replanDay(
  change: string,
  currentPlan?: Plan | null,
  transcript = "",
): PlanningResult {
  const mergedTranscript = `${transcript} 그리고 ${change}`.trim();
  return markChangedBlocks(planDay(mergedTranscript), currentPlan);
}

// 변경 입력의 의미 분석도 Foundry gpt-4o 가 수행하는 재계획.
export async function replanDayWithModel(
  change: string,
  currentPlan?: Plan | null,
  transcript = "",
): Promise<PlanningResult> {
  const mergedTranscript = `${transcript} 그리고 ${change}`.trim();
  return markChangedBlocks(
    await planDayWithModel(mergedTranscript),
    currentPlan,
  );
}
