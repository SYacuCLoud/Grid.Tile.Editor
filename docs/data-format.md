# Data Format (JSON Schema)

> `JSON 내보내기` 파일과 서버 저장 파일의 형식(`ProjectDoc` v3), 규칙, localStorage 키. [← README](../README.md)

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
      "pattern": "hatch",           // 선택: solid | hatch | hatchReverse | crosshatch | dots (없으면 solid)
      "lineStyle": "dashed",        // 선택: solid | dotted | dashed (없으면 solid)
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
  "devices": [                    // 장치 대장 (선택). 칸이 deviceId 로 참조
    {
      "id": "dev-1",
      "type": "RFID 리더기",
      "program": "C1102",
      "station": "1120",
      "role": "칼작업대 10 입고",
      "serial": "RR657-005570",   // 연결된 칸의 label 은 이 값을 따라간다
      "ip": "192.168.0.10",
      "mac": "00-0b-29-7c-f0-b7",
      "comPort": true,             // COM 포트로 붙는 장치 (체크)
      "port": "COM3",
      "memo": "인식 불가"
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
          "label": "C1101",         // 식별자
          "memo": "3월 점검 대상",
          "deviceId": "dev-1"       // 장치 대장 참조 (선택)
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
- `devices` 가 없는 이전 판 도면도 그대로 열립니다. 이전 판이 문자열로 적던 `comPort` 는 열 때 체크(`true`) + `port` 로 옮겨집니다.

### localStorage 키

도면은 브라우저에 저장하지 않습니다. 화면 설정만 남습니다.

| 키 | 내용 |
|---|---|
| `grid-tile-editor:palette-collapsed` | 접어 둔 팔레트 분류 |
| `rfid-grid-editor:project:v2` | **더 이상 쓰지 않습니다.** 예전 판이 도면을 자동 저장하던 자리 — `전체 초기화` 로 지워집니다 |
| `rfid-grid-editor:doc:v1` | **더 이상 쓰지 않습니다.** 구버전 단일 문서 — `전체 초기화` 로 지워집니다 |
