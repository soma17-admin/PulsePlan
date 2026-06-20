"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ExtractedItems,
  ExtractedTask,
  Plan,
  PlanningResult,
} from "@/lib/types";

type Trace = {
  id: string;
  label: string;
  status?: "pending" | "active" | "done";
};

type StreamState = {
  preview: ExtractedItems | null;
  scoredTasks: ExtractedTask[];
  plan: Plan | null;
  explanation: string[];
  copilotSummary: string;
  progress: number;
};

type MicState = "idle" | "listening" | "processing" | "done" | "error";

type BrowserWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

const demoPrompt =
  "오늘 14시에 고객사 제안서 리뷰가 있고 17시까지 수정본을 보내야 해. 오전에는 회의록 액션 아이템을 정리하고 채용 후보자 피드백도 30분 안에 써야 해. 15시 30분에는 팀 싱크가 있어. 나는 10시부터 12시 사이에 집중이 제일 잘 돼.";

function parseEventBlock(block: string) {
  const lines = block.split("\n").filter(Boolean);
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const dataLine = lines
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  if (!event || !dataLine) {
    return null;
  }

  try {
    return { event, data: JSON.parse(dataLine) as unknown };
  } catch {
    return null;
  }
}

function getRecognition() {
  if (typeof window === "undefined") {
    return null;
  }

  const host = window as BrowserWindow;
  const Recognition = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = "ko-KR";
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

export function PulsePlanClient() {
  const [transcript, setTranscript] = useState(demoPrompt);
  const [interim, setInterim] = useState("");
  const [change, setChange] = useState("지금 긴급 장애 대응 1시간이 추가됐어.");
  const [micState, setMicState] = useState<MicState>("idle");
  const [loading, setLoading] = useState(false);
  const [approval, setApproval] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [sourceMode, setSourceMode] = useState<
    "agent" | "fallback" | "local" | null
  >(null);
  const [error, setError] = useState("");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [expandedAssumptions, setExpandedAssumptions] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>({
    preview: null,
    scoredTasks: [],
    plan: null,
    explanation: [],
    copilotSummary: "",
    progress: 0,
  });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showPreview, setShowPreview] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const hadPlanRef = useRef(false);

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? (localStorage.getItem("pulseplan-theme") as "light" | "dark" | null)
        : null;
    const initial =
      stored ??
      (typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    // 마운트 시 1회 localStorage/시스템 설정과 동기화(외부 상태 반영) — 의도된 setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("pulseplan-theme", next);
      } catch {
        // localStorage may be unavailable; ignore persistence errors
      }
      return next;
    });
  }

  useEffect(() => {
    const recognition = getRecognition();
    recognitionRef.current = recognition;
    if (!recognition) {
      return;
    }

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const item = event.results[index];
        if (item.isFinal) {
          finalText += item[0].transcript;
        } else {
          interimText += item[0].transcript;
        }
      }

      if (finalText) {
        setTranscript((current) => `${current} ${finalText}`.trim());
      }
      setInterim(interimText.trim());
    };

    recognition.onend = () => {
      setMicState("idle");
      setInterim("");
    };

    recognition.onerror = (event) => {
      setMicState("error");
      setError(`음성 입력 오류: ${event.error}`);
    };
  }, []);

  async function consumePlanningStream(
    url: string,
    payload: Record<string, unknown>,
  ) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      throw new Error("계획 생성에 실패했습니다.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: PlanningResult | null = null;
    const toolSequence = [
      "extract_items",
      "score_tasks",
      "build_schedule",
      "explain_plan",
    ];

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      chunks.forEach((chunk) => {
        const parsed = parseEventBlock(chunk);
        if (!parsed) {
          return;
        }

        if (parsed.event === "tool") {
          const toolData = parsed.data as { name: string; label: string };
          const toolIndex = toolSequence.indexOf(toolData.name);
          const progress =
            toolIndex >= 0 ? ((toolIndex + 1) / toolSequence.length) * 100 : 0;

          setTraces((current) => {
            const updated = [...current];
            if (updated.length > 0) {
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                status: "done",
              };
            }
            return [
              ...updated,
              {
                id: `${toolData.name}-${current.length}`,
                label: toolData.label,
                status: "active",
              },
            ];
          });

          setStreamState((current) => ({ ...current, progress }));
          return;
        }

        if (parsed.event === "preview") {
          setStreamState((current) => ({
            ...current,
            preview: parsed.data as ExtractedItems,
            progress: 30,
          }));
          return;
        }

        if (parsed.event === "tasks") {
          setStreamState((current) => ({
            ...current,
            scoredTasks: parsed.data as ExtractedTask[],
            progress: 50,
          }));
          return;
        }

        if (parsed.event === "plan") {
          setStreamState((current) => ({
            ...current,
            plan: parsed.data as Plan,
            progress: 75,
          }));
          return;
        }

        if (parsed.event === "explanation") {
          setStreamState((current) => ({
            ...current,
            explanation: parsed.data as string[],
            progress: 90,
          }));
          return;
        }

        if (parsed.event === "copilot") {
          const data = parsed.data as { summary: string };
          setStreamState((current) => ({
            ...current,
            copilotSummary: data.summary,
            progress: 100,
          }));
          return;
        }

        if (parsed.event === "source") {
          const data = parsed.data as {
            mode: "agent" | "fallback" | "local";
            message?: string;
          };
          setSourceMode(data.mode);
          if (data.message) {
            setStreamState((current) => ({
              ...current,
              copilotSummary: data.message ?? current.copilotSummary,
            }));
          }
          return;
        }

        if (parsed.event === "done") {
          finalResult = parsed.data as PlanningResult;
        }
      });
    }

    return finalResult;
  }

  async function handlePlan() {
    if (!transcript.trim()) {
      setError("입력이 없습니다. 음성 또는 텍스트를 입력하세요.");
      return;
    }

    setLoading(true);
    setApproval(false);
    setConfirmedAt(null);
    setSourceMode(null);
    setError("");
    setTraces([]);
    setStreamState({
      preview: null,
      scoredTasks: [],
      plan: null,
      explanation: [],
      copilotSummary: "",
      progress: 0,
    });
    setMicState("processing");

    try {
      const nextResult = await consumePlanningStream("/api/agent", {
        transcript,
      });
      if (nextResult) {
        setResult(nextResult);
        setMicState("done");
      }
    } catch (nextError) {
      setMicState("error");
      setError(
        nextError instanceof Error
          ? nextError.message
          : "계획 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReplan() {
    if (!streamState.plan && !result?.plan) {
      setError("먼저 기존 계획을 생성해야 합니다.");
      return;
    }

    setLoading(true);
    setError("");
    setConfirmedAt(null);
    setSourceMode(null);
    setMicState("processing");

    try {
      const nextResult = await consumePlanningStream("/api/replan", {
        change,
        currentPlan: result?.plan ?? streamState.plan,
        transcript,
      });
      if (nextResult) {
        setResult(nextResult);
      }
      setTraces((current) => [
        ...current,
        {
          id: `replan-${current.length}`,
          label: "남은 일정 재배치",
          status: "done",
        },
      ]);
      setMicState("done");
    } catch (nextError) {
      setMicState("error");
      setError(
        nextError instanceof Error
          ? nextError.message
          : "재계획 중 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setError("");
    try {
      const response = await fetch("/api/approve", { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "확정에 실패했습니다.");
      }
      const data = (await response.json()) as { approvedAt: string | null };
      setConfirmedAt(data.approvedAt ?? new Date().toISOString());
      setApproval(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "확정 중 오류가 발생했습니다.",
      );
    } finally {
      setApproving(false);
    }
  }

  function toggleMic() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError(
        "이 브라우저는 Web Speech API를 지원하지 않습니다. 텍스트 입력을 사용하세요.",
      );
      return;
    }

    setError("");

    if (micState === "listening") {
      recognition.stop();
      setMicState("processing");
      return;
    }

    recognition.start();
    setMicState("listening");
    setInterim("");
  }

  const preview = streamState.preview ?? result?.preview ?? null;
  const plan = streamState.plan ?? result?.plan ?? null;
  const explanation = streamState.explanation.length
    ? streamState.explanation
    : (result?.explanation ?? []);

  useEffect(() => {
    if (plan && !hadPlanRef.current) {
      hadPlanRef.current = true;
      resultRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    if (!plan) {
      hadPlanRef.current = false;
    }
  }, [plan]);

  return (
    <div className="shell">
      <div className="topbar">
        <span className="eyebrow">Voice-first replanning workflow</span>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"
          }
        >
          {theme === "dark" ? "☀️ 라이트 모드" : "🌙 다크 모드"}
        </button>
      </div>

      <section className="hero">
        <div className="card hero-main">
          <h1>PulsePlan</h1>
          <p>
            회의 메모, 긴급 요청, 마감, 고정 일정, 집중 시간을 한 번에 말하면
            오늘 실행 가능한 순서로 다시 짭니다. 입력이 거칠어도 시간과 숫자를
            보정하고, 계획은 항상 제안 형태로 보여줍니다.
          </p>
        </div>
      </section>

      <section className="stack">
        <div className="flow-group">
          <div className="card panel step-card">
            <span className="step-pill">STEP 1 · 오늘 상황 입력</span>
            <div className="toolbar">
              <div>
                <h2>오늘 상황 입력</h2>
                <p className="subtle">
                  음성 우선이지만 텍스트도 항상 가능합니다.
                </p>
              </div>
              <div
                style={{ display: "flex", gap: "12px", alignItems: "center" }}
              >
                <div
                  className="status-badge"
                  data-status={micState}
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="spinner"
                    style={
                      micState === "listening" || micState === "processing"
                        ? {}
                        : { display: "none" }
                    }
                  />
                  <span>
                    {micState === "idle" && "준비 중"}
                    {micState === "listening" && "듣는 중..."}
                    {micState === "processing" && "처리 중..."}
                    {micState === "done" && "완료"}
                    {micState === "error" && "오류"}
                  </span>
                </div>
                <button
                  className="mic"
                  data-active={micState === "listening"}
                  onClick={toggleMic}
                  type="button"
                  aria-label={
                    micState === "listening" ? "마이크 정지" : "마이크 시작"
                  }
                  disabled={loading}
                >
                  {micState === "listening" ? "🎙️ 정지" : "🎙️ 시작"}
                </button>
              </div>
            </div>

            <div className="composer">
              <textarea
                className="textarea"
                aria-label="오늘 상황 입력"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                disabled={loading}
              />
              <div className="interim" role="status" aria-live="polite">
                {interim
                  ? `실시간 인식: ${interim}`
                  : "실시간 인식 결과가 여기에 표시됩니다."}
              </div>

              <div className="actions">
                <button
                  className="button"
                  disabled={loading || !transcript.trim()}
                  onClick={handlePlan}
                  type="button"
                  aria-label="입력한 내용으로 계획 생성하기"
                >
                  {loading ? "계획 생성 중..." : "계획 생성"}
                </button>
                <button
                  className="ghost"
                  disabled={loading}
                  onClick={() => setTranscript(demoPrompt)}
                  type="button"
                  aria-label="예시 데이터로 입력 필드 채우기"
                >
                  예시로 채우기
                </button>
                <button
                  className="ghost"
                  disabled={loading}
                  onClick={() => setTranscript("")}
                  type="button"
                  aria-label="입력 필드 비우기"
                >
                  비우기
                </button>
              </div>

              {streamState.progress > 0 && streamState.progress < 100 && (
                <div style={{ marginTop: "16px" }}>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${streamState.progress}%` }}
                    />
                  </div>
                  <span className="subtle" style={{ fontSize: "12px" }}>
                    {Math.round(streamState.progress)}% 완료
                  </span>
                </div>
              )}

              {error ? (
                <div className="error" role="alert">
                  {error}
                </div>
              ) : null}

              <div
                className="trace-list"
                role="log"
                aria-live="polite"
                aria-label="처리 단계"
              >
                {traces.length ? (
                  traces.map((trace) => (
                    <div
                      key={trace.id}
                      className="step-indicator"
                      data-status={trace.status}
                    >
                      {trace.status === "active" && (
                        <span className="spinner" />
                      )}
                      {trace.status === "done" && (
                        <span style={{ color: "#059669" }}>✓</span>
                      )}
                      <span>{trace.label}</span>
                    </div>
                  ))
                ) : (
                  <span className="empty">아직 실행된 단계가 없습니다.</span>
                )}
              </div>
            </div>
          </div>

          <div className="card panel step-card" ref={resultRef}>
            <div className="section-head">
              <div>
                <span className="step-pill">STEP 2 · 계획 결과</span>
                <h2>계획 결과</h2>
              </div>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowPreview(true)}
                disabled={!preview}
              >
                🔍 추출 미리보기
              </button>
            </div>
            {!plan ? (
              <p className="subtle">위에서 입력하면 여기 계획이 표시됩니다.</p>
            ) : null}

            {plan && sourceMode ? (
              <div
                className="source-badge"
                data-mode={sourceMode}
                role="status"
                aria-live="polite"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "12px",
                  padding: "6px 12px",
                  borderRadius: "999px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background:
                    sourceMode === "agent"
                      ? "rgba(5, 150, 105, 0.1)"
                      : "rgba(217, 119, 6, 0.12)",
                  color: sourceMode === "agent" ? "#059669" : "#b45309",
                  border:
                    sourceMode === "agent"
                      ? "1px solid rgba(5, 150, 105, 0.3)"
                      : "1px solid rgba(217, 119, 6, 0.3)",
                }}
              >
                {sourceMode === "agent"
                  ? "⚡ Azure Foundry 에이전트가 도구 체인으로 생성"
                  : sourceMode === "fallback"
                    ? "⚠️ 에이전트 세션 불가 — 로컬 폴백으로 생성"
                    : "ℹ️ 로컬 플래너로 생성 (Azure Foundry 미연결)"}
              </div>
            ) : null}

            {approval && plan ? (
              <div className="approval-gate">
                <div
                  style={{
                    padding: "16px",
                    borderRadius: "var(--radius-lg)",
                    background: "rgba(15, 118, 110, 0.08)",
                    border: "1px solid rgba(15, 118, 110, 0.2)",
                  }}
                >
                  <p style={{ fontWeight: 600, marginBottom: "12px" }}>
                    이 계획을 적용하시겠습니까?
                  </p>
                  <p className="subtle">
                    아래 계획을 검토한 후 확정해주세요. 언제든 재계획할 수
                    있습니다.
                  </p>
                  <div
                    style={{ display: "flex", gap: "12px", marginTop: "16px" }}
                  >
                    <button
                      className="button"
                      onClick={handleApprove}
                      type="button"
                      disabled={approving}
                    >
                      {approving ? "확정 중..." : "확정"}
                    </button>
                    <button
                      className="ghost"
                      onClick={() => setApproval(false)}
                      type="button"
                      disabled={approving}
                    >
                      재검토
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {plan && !approval ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {confirmedAt ? (
                  <div
                    className="confirmed-banner"
                    role="status"
                    aria-live="polite"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "12px 16px",
                      borderRadius: "var(--radius-lg)",
                      background: "rgba(5, 150, 105, 0.1)",
                      border: "1px solid rgba(5, 150, 105, 0.3)",
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "#059669" }}>
                      ✓ 확정됨 ·{" "}
                      {new Date(confirmedAt).toLocaleTimeString("ko-KR")}
                    </span>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setConfirmedAt(null)}
                      aria-label="확정 취소하고 다시 검토"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    className="button"
                    onClick={() => setApproval(true)}
                    type="button"
                    aria-label="계획 승인하기"
                  >
                    계획 승인
                  </button>
                )}
                {plan.blocks.map((block) => {
                  const blockKey = `${block.taskId}-${block.start}`;
                  return (
                    <div
                      key={blockKey}
                      className="collapsible"
                      data-open={expandedBlockId === blockKey}
                      onClick={() =>
                        setExpandedBlockId(
                          expandedBlockId === blockKey ? null : blockKey,
                        )
                      }
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setExpandedBlockId(
                            expandedBlockId === blockKey ? null : blockKey,
                          );
                        }
                      }}
                      aria-label={`${block.title} 상세 정보 ${expandedBlockId === blockKey ? "닫기" : "펼치기"}`}
                    >
                      <span className="collapsible-icon">▸</span>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "12px",
                          }}
                        >
                          <strong
                            style={{
                              color: block.changed
                                ? "var(--accent)"
                                : "inherit",
                            }}
                          >
                            {block.title}
                          </strong>
                          <span
                            className="subtle"
                            style={{ fontSize: "14px", whiteSpace: "nowrap" }}
                          >
                            {block.start} - {block.end}
                          </span>
                        </div>
                        {block.changed && (
                          <span className="assumption-tag">변경됨</span>
                        )}
                        <div className="collapsible-content">
                          <div
                            style={{
                              marginTop: "12px",
                              paddingLeft: "12px",
                              borderLeft: "2px solid var(--line-strong)",
                            }}
                          >
                            <p
                              className="subtle"
                              style={{ fontSize: "13px", marginBottom: "8px" }}
                            >
                              예상 소요: {block.durationMin ?? "계산 중"} 분
                            </p>
                            {block.reasoning && (
                              <p
                                className="subtle"
                                style={{ fontSize: "13px" }}
                              >
                                {block.reasoning}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {explanation.length > 0 && plan ? (
              <div
                style={{
                  marginTop: "24px",
                  paddingTop: "24px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <button
                  className="collapsible"
                  data-open={expandedAssumptions}
                  onClick={() => setExpandedAssumptions(!expandedAssumptions)}
                  type="button"
                  style={{ width: "100%" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setExpandedAssumptions(!expandedAssumptions);
                    }
                  }}
                  aria-label="배치 설명 및 가정"
                >
                  <span className="collapsible-icon">▸</span>
                  <span style={{ flex: 1, textAlign: "left" }}>
                    <strong>배치 설명 및 가정</strong>
                  </span>
                </button>
                <div
                  className="collapsible-content"
                  data-open={expandedAssumptions}
                >
                  <ul style={{ marginLeft: "24px", marginTop: "12px" }}>
                    {explanation.map((line, index) => (
                      <li
                        key={index}
                        style={{ marginBottom: "8px", fontSize: "14px" }}
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flow-group">
          <div className="card panel step-card">
            <span className="step-pill">STEP 3 · 오늘 시간표 제안</span>
            <h2>오늘 시간표 제안</h2>
            <p className="subtle">
              고정 일정은 먼저 보존하고, 남은 슬롯을 중요도와 마감으로 채웁니다.
            </p>
            {plan ? (
              <div className="timeline">
                {plan.blocks.map((block) => (
                  <div
                    className="block"
                    data-changed={block.changed ? "true" : "false"}
                    key={`${block.taskId}-${block.start}`}
                  >
                    <div className="row">
                      <strong>{block.title}</strong>
                      <span className="time">
                        {block.start} - {block.end}
                      </span>
                    </div>
                    <div className="reason">{block.reason}</div>
                  </div>
                ))}

                <div className="summary">
                  <strong>설명</strong>
                  {explanation.map((line) => (
                    <span className="hint" key={line}>
                      {line}
                    </span>
                  ))}
                </div>

                <div className="summary">
                  <strong>요약</strong>
                  {plan.summary.map((line) => (
                    <span className="hint" key={line}>
                      {line}
                    </span>
                  ))}
                  {plan.dropped.length ? (
                    <span className="hint">
                      보류: {plan.dropped.join(", ")}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty">아직 생성된 계획이 없습니다.</div>
            )}
          </div>
        </div>

        {plan && !approval ? (
          <div className="card panel step-card">
            <span className="step-pill">STEP 4 · 긴급 변경 · 재계획</span>
            <h2>긴급 변경 - 재계획</h2>
            <p className="subtle">
              갑작스러운 일정이 생겼나요? 입력하면 남은 시간을 다시 짜줍니다.
            </p>

            <div className="composer">
              <input
                type="text"
                className="textarea"
                placeholder="예: 지금 긴급 회의 1시간이 추가됐어. 또는 점심 약속이 취소됐어."
                value={change}
                onChange={(event) => setChange(event.target.value)}
                disabled={loading}
                aria-label="재계획할 변경 사항 입력"
              />
              <button
                className="button"
                disabled={loading || !change.trim()}
                onClick={handleReplan}
                type="button"
                aria-label="변경 사항을 반영해 계획 재생성하기"
              >
                {loading ? "재계획 중..." : "재계획"}
              </button>
            </div>

            {streamState.copilotSummary && (
              <div className="summary" style={{ marginTop: "16px" }}>
                <strong>상태</strong>
                <span className="hint">{streamState.copilotSummary}</span>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {showPreview && preview ? (
        <div
          className="modal-overlay"
          onClick={() => setShowPreview(false)}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="추출 미리보기"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>추출 미리보기</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowPreview(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <p className="subtle">
              음성/텍스트에서 추출한 할 일, 고정 일정, 집중 시간대, 가정입니다.
            </p>
            <div className="preview-list">
              {preview.tasks.map((task) => (
                <div className="tile" key={task.id}>
                  <div className="row">
                    <strong>{task.title}</strong>
                    <span className="badge">{task.durationMin}분</span>
                  </div>
                  <div className="hint">
                    deadline {task.deadline ?? "없음"} · confidence{" "}
                    {task.confidence.toFixed(2)}
                  </div>
                </div>
              ))}
              {preview.fixed.map((item) => (
                <div className="tile" key={item.id}>
                  <div className="row">
                    <strong>{item.title}</strong>
                    <span className="badge">
                      {item.start} - {item.end}
                    </span>
                  </div>
                  <div className="hint">고정 일정</div>
                </div>
              ))}
              {preview.focus.map((window) => (
                <div className="tile" key={window.id}>
                  <div className="row">
                    <strong>집중 시간대</strong>
                    <span className="badge">
                      {window.start} - {window.end}
                    </span>
                  </div>
                  <div className="hint">우선 배치에 반영</div>
                </div>
              ))}
              {preview.assumptions.length ? (
                <div className="summary">
                  <strong>가정</strong>
                  {preview.assumptions.map((line) => (
                    <span className="hint" key={line}>
                      {line}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
