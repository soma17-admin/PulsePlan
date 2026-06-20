const NUMBER_MAP: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
};

const SPECIAL_NUMBERS: Array<[RegExp, string]> = [
  [/열두시/g, "12시"],
  [/열한시/g, "11시"],
  [/열시/g, "10시"],
  [/아홉시/g, "9시"],
  [/여덟시/g, "8시"],
  [/일곱시/g, "7시"],
  [/여섯시/g, "6시"],
  [/다섯시/g, "5시"],
  [/네시/g, "4시"],
  [/세시/g, "3시"],
  [/두시/g, "2시"],
  [/한시/g, "1시"],
  [/삼십분/g, "30분"],
  [/한시간/g, "1시간"],
  [/두시간/g, "2시간"],
  [/세시간/g, "3시간"],
];

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function normalizeTranscript(text: string) {
  let normalized = text.trim();

  for (const [pattern, replacement] of SPECIAL_NUMBERS) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized
    .replace(
      /(오전|오후)?\s*(\d{1,2})시\s*반/g,
      (_, meridiem: string | undefined, rawHour: string) => {
        let hour = Number(rawHour);
        if (meridiem === "오후" && hour < 12) {
          hour += 12;
        }
        if (meridiem === "오전" && hour === 12) {
          hour = 0;
        }
        return `${hour}시 30분`;
      },
    )
    .replace(
      /(오전|오후)\s*(\d{1,2})시/g,
      (_, meridiem: string, rawHour: string) => {
        let hour = Number(rawHour);
        if (meridiem === "오후" && hour < 12) {
          hour += 12;
        }
        if (meridiem === "오전" && hour === 12) {
          hour = 0;
        }
        return `${hour}시`;
      },
    )
    .replace(/보네야/g, "보내야")
    .replace(/액션아이템/g, "액션 아이템")
    .replace(/팀싱크/g, "팀 싱크")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

export function normalizeMinuteToken(token: string, fallback: number) {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  if (token in NUMBER_MAP) {
    return NUMBER_MAP[token];
  }
  if (token === "열") {
    return 10;
  }
  return fallback;
}

export function formatTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

export function parseClock(fragment: string) {
  const match = fragment.match(/(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours * 60 + minutes;
}
