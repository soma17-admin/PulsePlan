---
name: voice-input
description: PulsePlan에 음성 입력을 붙이고 음성 인식 오류(오인식·오타·시간/숫자 혼동)에 견고하게 만들 때 반드시 사용한다. 브라우저 Web Speech API(ko-KR) 연결, 마이크 UX, 부분 결과 처리, STT 전처리(시간/숫자 정규화), (가점) Azure AI Speech 서버 STT를 다룬다. "음성", "마이크", "받아쓰기", "STT", "오타/오인식 처리" 요청이면 이 스킬을 적용한다. 평가 기준 5(UX, 12%)와 입코딩 테마의 핵심이다.
---

# Voice Input & STT 견고성 (평가 기준 5 + 테마)

입력은 **음성 우선**. 그리고 음성은 **틀린다** — 동음이의, 띄어쓰기·문장부호 없음, 숫자/시간 오인식.
저저항 입력 UX + 관대한 해석이 핵심이다.

## 1) 브라우저 음성인식 — Web Speech API (`ko-KR`)

클라이언트에서 텍스트로 변환하고, 백엔드로는 **텍스트만** 보낸다.

```ts
// components/VoiceInput.tsx (use client)
type Rec = typeof window.SpeechRecognition;
function getRecognizer() {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;          // 미지원 브라우저 → 텍스트 입력으로 폴백
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.continuous = true;         // 길게 말하는 브레인덤프 지원
  rec.interimResults = true;     // 말하는 중 부분 결과 표시(체감 속도)
  return rec;
}
```

- `onresult`에서 `interim`(회색)·`final`(검정) 텍스트를 분리해 보여준다.
- 마이크 버튼: 녹음 중 시각 표시(펄스), 다시 누르면 정지. 키보드로도 항상 입력 가능(접근성).
- 권한 거부/미지원 시 **텍스트 입력으로 우아하게 폴백**(기준 5).

## 2) STT 전처리 — `lib/normalize.ts` (오인식/오타 1차 보정)

에이전트에 넘기기 전에 흔한 한국어 시간/숫자 표현을 가볍게 정규화한다(완벽할 필요 없음 — 나머지는 모델이 보정).

```ts
export function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/오후\s*([1-9]|1[0-2])\s*시/g, (_, h) => `${(+h % 12) + 12}시`)
    .replace(/오전\s*([1-9]|1[0-2])\s*시/g, (_, h) => `${+h % 12}시`)
    .replace(/반\b/g, "30분")
    .trim();
}
```

> 규칙은 데모 수준이면 충분. **진짜 견고성은 모델 프롬프트**에서 나온다(아래).

## 3) 모델 쪽 견고성 (핵심)

`copilot-sdk-integration` 스킬의 시스템 프롬프트에 다음을 명시:
- "입력은 음성 인식 결과 → 오인식/오타 가정. 문맥으로 합리적으로 보정."
- "정말 막힐 때만 한 가지 짧은 확인 질문. 그 외엔 가정을 명시하고 진행."
- "확실치 않으면 지어내지 말고 confidence 낮음 표시."

이렇게 하면 "두시 반 미팅"이 "2시 30분 회의"로, "수정본 다섯시까지"가 "17:00 마감"으로 해석된다.

## 4) (가점) Azure AI Speech 서버 STT — 클라우드 네이티브

브라우저 STT가 약하거나 정확도를 높이려면 **Azure AI Speech**로 서버 변환을 추가한다(기준 3 가점).
오디오를 `/api/transcribe`로 보내 Azure Speech로 텍스트화한 뒤 동일 파이프라인에 투입.
시간 제약상 **선택 사항** — MVP는 Web Speech API로 충분.

## 5) UX 디테일 (기준 5에서 점수 따는 곳)

- 음성→텍스트→**추출된 항목 미리보기**→계획 카드의 흐름을 매끄럽게.
- 계획은 **제안**으로 보여주고 [승인]/[수정]/[다시 생성]. 사용자가 주도권 유지.
- 스트리밍 중 "계획 짜는 중…" 표시, 오류 시 재시도. 지연을 우아하게.
- 에이전트가 보정/가정한 부분을 **드러내** 사용자가 틀린 해석을 바로잡게 한다(투명성=신뢰).

## 체크리스트

- [ ] Web Speech API(`ko-KR`)로 음성→텍스트, 미지원 시 텍스트 폴백.
- [ ] 부분 결과 표시 + 마이크 상태 시각화 + 키보드 접근성.
- [ ] `normalize()` 전처리 + 모델 견고 프롬프트 둘 다 적용.
- [ ] 보정/가정 내용을 UI에 투명하게 표시.