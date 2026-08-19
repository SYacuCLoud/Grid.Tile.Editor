# Grid Tile Editor — 격자형 배치 편집기

![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![Vite](https://img.shields.io/badge/Vite-8-646cff)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020)
![Node](https://img.shields.io/badge/Node-%E2%89%A522.13-3c873a)

도면을 고정 격자(모눈)로 관리하며, **엑셀 셀을 칠하듯** 설비·장비·센서와 배선 경로, 설치/점검 상태를 마우스 드래그로 빠르게 배치하는 웹 기반 배치도 편집기입니다.

공장 설비 배치도뿐 아니라 **좌석 배치 · 창고 구획 · 매장 진열 · 전시 부스** 등 격자로 표현되는 모든 배치 작업에 쓸 수 있습니다.

---

## 📖 Overview

| | |
|---|---|
| **무엇인가** | 브라우저에서 도는 단일 페이지 격자 배치도 편집기 |
| **누가 쓰는가** | 설비 배치도·구획도를 CAD 없이 빠르게 그리고 공유해야 하는 실무자 |
| **왜 격자인가** | 자유 도형 대신 칸 단위로 고정하면 위치가 어긋나지 않고, 좌표(가로 N · 세로 M)로 소통할 수 있습니다 |
| **데이터는 어디에** | 서버 없이 브라우저 `localStorage`에 자동 저장. 백업·공유는 JSON, 보고서는 PNG |
| **설치가 필요한가** | 아니오. 정적 파일을 띄우면 그대로 동작합니다 |

### 이런 문제를 풉니다

- CAD는 무겁고, 엑셀은 인쇄하면 어긋나고, 파워포인트는 좌표가 없습니다.
- 도면을 그리는 사람과 읽는 사람이 **"3열 12행 저울 옆"** 처럼 같은 좌표로 말할 수 있어야 합니다.
- 배치도를 A3 두 장에 나눠 인쇄했을 때 **어디서 잘리는지** 그리는 중에 알아야 합니다.

---

## ✨ Key Features

### 1. 고정 격자 드래그 편집

| 도구 | 동작 |
|---|---|
| 브러시 | 끌어서 연속 칠하기 |
| 지우개 | 현재 레이어 내용 지우기 |
| 직선 | 시작 칸에서 끝 칸까지 직선 |
| 사각형 | 테두리만 그리기 |
| 사각형 채움 | 영역 전체 칠하기 |
| 채우기 | 이어진 같은 칸 한 번에 (Bucket Fill) |
| 선택 | 범위 드래그 선택 · 장비 ID · 메모 편집 |

- **격자 크기**: 가로/세로 각각 10 ~ 200칸 실시간 변경
- **확대/축소**: 14px ~ 32px 5단계. 마우스 휠로도 조절되며 **커서 아래 지점이 제자리에 고정**됩니다
- **화면 이동**: 마우스 **가운데 버튼(휠 클릭)** 드래그. 도구를 바꿀 필요가 없습니다

### 2. 사용자 관리형 팔레트

| 분류 | 표현 | 사용자 편집 |
|---|---|---|
| 배경 (Tile) | 벽 · 통로 · 문 | 고정 항목 |
| 상태 (Status) | 셀 채움 색상 | ✅ 추가·수정·삭제 |
| 장비 (Kind) | 칸에 이름 글자 + 테두리 | ✅ 추가·수정·삭제 |
| 배선 (Wire) | 색상 라인 | ✅ 추가·수정·삭제 |

각 항목은 **색 · 디스플레이 이름 · 설명** 세 가지를 가집니다.

- **디스플레이 이름** (필수, 24자): 팔레트와 범례에 보이는 이름. **장비는 이 이름이 그대로 도면 칸에 찍히므로** 짧게 두는 편이 읽기 좋습니다(예: `리더`).
- **설명** (선택, 60자): PNG 범례에 이름과 함께 옅은 글씨로 나옵니다(예: `리더 — 식별 리더기`).
- **검증**: 이름 필수, 같은 분류 안에서 중복 이름 금지.

> **보존 정책** — 도면에 이미 칠해진 항목을 삭제하면 두 갈래를 묻습니다.
> `칸은 그대로 두고 목록에서만 삭제`(정의를 남겨 색이 깨지지 않음) 또는 `배치된 N칸까지 함께 삭제`.
> 팔레트는 **프로젝트 공용**이므로 사용량·삭제 판정·범례는 **모든 페이지를 합쳐** 계산합니다.

### 3. 레이어 관리

`배경` · `설비` · `배선` 3개 레이어를 독립적으로 켜고 끕니다. 배선 전용 도면, 설비 전용 도면을 따로 인쇄할 수 있습니다.

### 4. 칸별 장비 ID · 메모

- **우클릭 즉시 편집**: 어떤 도구를 쓰고 있든 칸에서 오른쪽 버튼을 누르면 `칸 정보` 상자가 열립니다. `Enter` 저장 · `Shift+Enter` 줄바꿈 · `Esc` 닫기. 우클릭한 칸은 칠해지지 않습니다.
- **말풍선 확인**: 메모가 있는 칸에 마우스를 올리면 내용이 뜹니다. 도면 가장자리에서는 방향을 안쪽으로 바꿔 잘리지 않습니다.
- 메모가 있는 칸은 오른쪽 위에 점 지표가 붙습니다.
- 메모는 **칸마다 · 페이지마다** 따로 저장됩니다(팔레트 항목의 `설명`과는 별개).

### 5. 범위 선택과 클립보드

`선택` 도구로 직사각형 범위를 지정하면 배경·설비(상태·장비·ID·메모)·배선이 **상대 위치를 유지한 채** 복사/잘라내기/붙여넣기 됩니다. 붙여넣은 영역은 자동으로 선택 범위가 되고, 되돌리기 한 번으로 원복됩니다.

### 6. 다중 페이지

- 페이지 추가 · 이름 변경(더블클릭 또는 ✏️) · 삭제 · 전환
- 페이지마다 **격자 크기 · 셀 · 메모 · 인쇄 용지 설정**이 완전히 독립
- 팔레트만 프로젝트 공용
- 최소 1개 페이지는 보장(마지막 페이지 삭제 버튼 비활성)

### 7. 인쇄 용지 경계선

오른쪽 `인쇄 용지` 패널에서 용지(A4 · A3 · A2 · Letter), 방향, **인쇄물에서 한 칸이 차지할 길이(mm)**, 여백을 정하면 도면 위에 **자홍색 점선으로 인쇄 경계**가 표시됩니다.

- 몇 장에 걸쳐 어디서 잘리는지 그리는 중에 바로 보입니다 (`가로 3 · 세로 3 = 9장`).
- **범례도 경계 안에 함께** 그려집니다. 인쇄물에는 도면 아래로 범례가 실리므로 장수 계산에도 범례 행이 포함됩니다.
- 격자가 한 장보다 작으면 **용지 크기만큼 화면이 넓어지고** 격자 밖은 회색으로 칠해집니다.
- 용지 설정은 **페이지마다 따로**입니다. 1공장은 A3 가로, 2공장은 A4 세로처럼 섞어 쓸 수 있습니다.
- 격자 칸 수와 PNG 내보내기는 **바뀌지 않습니다**. 경계선은 화면 표시 전용입니다.

### 8. 이력 · 저장 · 내보내기

- **Undo / Redo**: 최대 60단계. 페이지 전환은 이력에 들어가지 않고, 페이지 추가·이름변경·삭제는 되돌릴 수 있습니다.
- **자동 저장**: `localStorage`에 자동 갱신. 드래그 중에는 400ms 간격으로 모아 한 번만 기록하고, 저장 시각을 상단에 표시합니다.
- **JSON 저장/불러오기**: 모든 페이지 + 공용 팔레트를 통째로 백업·공유.
- **PNG 내보내기**: 제목 · 고해상도 도면 · 범례가 들어간 현재 페이지 이미지.
- **전체 초기화**: 확인 창을 거쳐 칸만 비웁니다. **팔레트 정의는 지워지지 않습니다.**

---

## 🧱 Tech Stack

| 영역 | 사용 기술 |
|---|---|
| UI | React 19 (RSC), TypeScript 5.9 (strict) |
| 프레임워크 | [vinext](https://www.npmjs.com/package/vinext) (App Router 호환) + Vite 8 |
| 스타일 | Tailwind CSS 4 |
| 렌더링 | HTML5 Canvas 2D (격자·배선·PNG 시트 직접 렌더) |
| 배포 대상 | Cloudflare Workers (`@cloudflare/vite-plugin`, Wrangler) |
| 저장소 | 브라우저 `localStorage` (선택적으로 Cloudflare D1 + Drizzle ORM) |
| 테스트 | `node --test` + `tsx --test` |

> 편집기 자체는 **서버가 필요 없습니다.** Worker / D1 구성은 정적 호스팅과 향후 서버 저장을 위한 발판입니다.

---

## 🚀 Quick Start

### 요구 사항

- Node.js **22.13 이상**

### 개발 서버

```bash
npm install     # 처음 1회
npm run dev
```

브라우저에서 `http://localhost:3000` (또는 콘솔에 표시된 포트)으로 접속합니다.

### 프로덕션 빌드

```bash
npm run build
```

- 빌드 산출물: **`Grid.Tile.Editor/dist/`** (`dist/client` 정적 자산, `dist/server` Worker 번들)
- 빌드 결과를 로컬에서 확인: `npm run start`

### 그 밖의 명령

```bash
npm run typecheck   # tsc --noEmit 타입 검사만
npm run lint        # ESLint (dist, .next 제외)
npm test            # 타입 검사 → 빌드 → 서버 렌더 테스트 → 로직 테스트
npm run db:generate # (선택) Drizzle 마이그레이션 생성
```

---

## ⌨️ Keyboard Shortcuts

| 키 | 동작 | 비고 |
|---|---|---|
| `Ctrl + Z` | 되돌리기 | 최대 60단계 |
| `Ctrl + Y` / `Ctrl + Shift + Z` | 다시 실행 | |
| `Ctrl + C` | 선택 범위 복사 | `선택` 도구 사용 시 |
| `Ctrl + X` | 선택 범위 잘라내기 | |
| `Ctrl + V` | 붙여넣기 | 클릭한 칸이 원점 |
| `우클릭` | 칸 정보(장비 ID · 메모) 편집 | 도구 무관, 칸은 칠해지지 않음 |
| `Enter` | 칸 정보 저장 / 페이지 이름 확정 | |
| `Shift + Enter` | 메모 줄바꿈 | |
| `Esc` | 편집 상자 닫기 / 취소 | |
| `휠` | 확대 · 축소 | 커서 아래 지점 고정 |
| `가운데 버튼 드래그` | 화면 이동 | |

> macOS에서는 `Ctrl` 대신 `⌘`도 동작합니다. 텍스트 입력창에 커서가 있는 동안에는 `Ctrl+C/X/V`를 가로채지 않습니다.

---

## 📦 Data Format (JSON Schema)

`JSON 내보내기`로 받는 파일은 프로젝트 전체(모든 페이지 + 공용 팔레트)를 담은 `ProjectDoc` 입니다. 현재 문서 버전은 **`3`**.

```jsonc
{
  "version": 3,
  "title": "격자형 배치 프로젝트",
  "activePageId": "page-1",
  "palette": [
    {
      "id": "installed",
      "name": "설치 (정상)",        // 디스플레이 이름 (최대 24자)
      "description": "설치 완료 · 통신 정상", // 선택, 최대 60자. PNG 범례에 표시
      "layer": "equipment",         // background | equipment | wiring
      "role": "status",             // tile | status | kind | wire
      "color": "#57a639",           // 채움색(배경·상태·배선) 또는 테두리색(장비)
      "retired": false              // 목록에서 숨겼지만 정의는 보존된 항목
    },
    {
      "id": "door",
      "name": "문",
      "layer": "background",
      "role": "tile",
      "color": "#4a3f2a",
      "glyph": "문"                 // 배경 타일만 쓰는 칸 글자 (선택)
    }
  ],
  "pages": [
    {
      "id": "page-1",
      "name": "1층 메인 공장",
      "cols": 48,                   // 10 ~ 200
      "rows": 30,                   // 10 ~ 200
      "background": { "3,5": "wall" },
      "equipment": {
        "7,9": {
          "status": "installed",
          "kind": "reader",
          "label": "C1101",         // 장비 ID
          "memo": "3월 점검 대상"
        }
      },
      "wiring": { "8,9": "wirePurple" },
      "paper": {                    // 없으면 인쇄 경계선을 그리지 않음
        "id": "a4",                 // a4 | a3 | a2 | letter
        "orientation": "landscape", // portrait | landscape
        "cellMm": 5,                // 1 ~ 50
        "marginMm": 10              // 0 ~ 50
      }
    }
  ]
}
```

### 규칙

- **셀 키는 `"x,y"` 문자열**입니다. `x`는 가로(열), `y`는 세로(행), 둘 다 0부터.
- 비어 있는 칸은 키 자체가 없습니다 — 희소 맵(sparse map)이라 큰 격자도 파일이 작습니다.
- 불러올 때 `sanitizeProject()`가 형식을 검사하며, 형식이 아니면 `배치도 파일 형식이 아닙니다.` 오류를 냅니다.
- **정의가 사라진 팔레트 ID**를 참조하는 칸도 회색 대체 항목으로 그려집니다. 오래된 파일이 깨지지 않습니다.

### localStorage 키

| 키 | 내용 |
|---|---|
| `rfid-grid-editor:project:v2` | 현재 프로젝트 (자동 저장) |
| `rfid-grid-editor:doc:v1` | 구버전 단일 문서. 첫 실행 때 자동으로 1페이지 프로젝트로 이관됩니다 |

---

## 📁 File Structure

```
Grid.Tile.Editor/
├─ app/
│  ├─ page.tsx                     메인 페이지 엔트리포인트
│  ├─ layout.tsx / globals.css     루트 레이아웃 · Tailwind 전역 스타일
│  └─ editor/
│     ├─ GridEditor.tsx            편집기 전체 레이아웃
│     ├─ GridCanvas.tsx            Canvas 격자 렌더링 · 포인터 이벤트
│     ├─ Toolbar.tsx               상단 도구 막대 (도구 · 이력 · 클립보드 · 배율 · 저장)
│     ├─ PageTabs.tsx              다중 페이지 탭 바
│     ├─ PalettePanel.tsx          왼쪽 팔레트 · 레이어 토글
│     ├─ PaletteItemForm.tsx       항목 이름/색/설명 입력 폼
│     ├─ PaletteDeleteConfirm.tsx  사용 중 항목 삭제 확인 창
│     ├─ PaletteSwatch.tsx         팔레트 색 견본
│     ├─ InspectorPanel.tsx        오른쪽 선택 정보 · 격자 크기 · 범례
│     ├─ CellNotePopover.tsx       우클릭 칸 정보 편집 상자
│     ├─ CellNoteBubble.tsx        메모 말풍선
│     ├─ PaperForm.tsx             인쇄 용지 설정 입력
│     │
│     ├─ doc.ts                    PageDoc · ProjectDoc 구조와 편집 로직
│     ├─ palette.ts                팔레트 타입 · 분류 · 기본 팔레트 · 색 대비
│     ├─ paletteOps.ts             항목 추가/수정/삭제 · 검증 · 사용량 · 범례 계산
│     ├─ range.ts                  범위 정규화 · 클립보드 · 경계 클리핑
│     ├─ shapes.ts                 직선 · 사각형 · 채우기 셀 계산
│     ├─ paper.ts                  용지 규격과 한 장에 들어가는 칸 수 계산
│     ├─ zoom.ts                   휠 확대 시 커서 고정 스크롤 보정
│     ├─ render.ts                 Canvas 셀·배선·텍스트 및 PNG 시트 렌더러
│     ├─ storage.ts                자동 저장 · 마이그레이션 · JSON/PNG 파일 처리
│     ├─ sample.ts                 초기 예시 도면
│     └─ useEditor.ts              상태 관리 · 페이지 CRUD · Undo/Redo 훅
│
├─ tests/                          로직 · 서버 렌더 테스트
├─ worker/                         Cloudflare Worker 엔트리
├─ db/ · drizzle/                  (선택) Drizzle 스키마와 마이그레이션
├─ examples/                       D1 연동 예제
└─ dist/                           빌드 산출물 (커밋하지 않음)
```

---

## 🧪 Testing

```bash
npm test    # 타입 검사 → 빌드 → 서버 렌더 테스트 → 로직 테스트
```

자세한 수동 테스트 시나리오는 [TESTING.md](./TESTING.md)를 참고하세요.

---

## 🤝 Contributing

1. 이슈로 문제나 제안을 먼저 남겨 주세요.
2. 작업 전 `npm test`가 통과하는지 확인합니다.
3. 코드 스타일: 4-space 들여쓰기, 한 줄에 한 선언, 타입/공개 멤버는 PascalCase, 비공개 필드는 `_camelCase`.
4. UI 동작을 바꿨다면 [TESTING.md](./TESTING.md)의 해당 시나리오도 함께 갱신해 주세요.

---

## 📄 License

현재 저장소는 `package.json`에 `"private": true`로 표시된 비공개 프로젝트입니다.
외부에 공개 배포하려면 루트에 `LICENSE` 파일을 추가하고(MIT 등) `package.json`의 `private`/`license` 필드를 함께 정리해야 합니다.
