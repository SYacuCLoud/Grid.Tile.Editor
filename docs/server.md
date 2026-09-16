# 로컬 폴더 공유와 버전 이력

> `.grid-projects/` 폴더를 함께 쓰는 방식, 충돌 처리, 폴더 구조, 이력 보관 규칙, HTTP API. [← README](../README.md)

같은 폴더(`.grid-projects/`)를 여러 사람이 함께 쓰는 가벼운 공유 방식입니다. 계정도 데이터베이스도 없습니다.
**MCP 서버와 완전히 같은 폴더·같은 파일 형식**이라 에이전트가 만든 도면을 사람이 이어서 고칠 수 있습니다.

### 화면

상단 `서버 도면` 줄에서 도면을 고르면 열리고, `서버 저장` 을 누르면 저장과 동시에 스냅샷이 하나 쌓입니다.
`버전 이력` 을 누르면 저장 시점 목록이 뜨고 그 자리에서 과거 버전으로 되돌릴 수 있습니다.
작성자 이름은 브라우저(`localStorage`)에 기억합니다.

### 충돌 처리 (낙관적 동시성)

열어 둔 리비전보다 서버가 앞서 있으면 저장을 막고 **누가 먼저 저장했는지** 알립니다.
`덮어쓰기` · `사본으로 저장` · `서버 것 열기` 중에서 고릅니다. MCP 나 파일 편집으로 폴더가 바뀐 경우도 같은 방식으로 잡습니다.

### 폴더 구조

```
.grid-projects/
├─ 1공장-배치도.json              현재 내용 (편집기 JSON 그대로 — 사진 포함)
├─ .history/
│  └─ 1공장-배치도/
│     ├─ 0001_2026-08-19T03-00-00-000Z.json   스냅샷 (사진은 photoref:<파일> 참조)
│     └─ 0002_2026-08-19T03-14-00-000Z.json
├─ .photos/
│  └─ 3f2a…c1.webp                  스냅샷이 참조하는 사진 (내용 해시 이름 · 한 번만 저장)
├─ .lookup/
│  ├─ connections.json               접속 이름 → env 파일 (관리자가 파일로만 관리 · 비밀은 env 에)
│  └─ default.json                   사업장별 기준정보 매핑 (UID 열 ↔ 표시 열 · 조건 · 갱신 주기, `/live` 설정 창이 저장)
└─ .live/
   ├─ {사업장}.json                  MQTT 메시지 형식 프로필 (필드 → JSON 경로 · 값 해석). 없으면 v1. `/live` 의 `형식` 단추가 저장
   ├─ logger.json                    (선택) 이벤트 기록기 설정 — broker · prefix · site · retentionDays · enabled
   └─ events/
      ├─ 2026-09-16.main.jsonl       상시 서비스 기록기(scripts/live-logger.ts)가 쓴 하루 이벤트
      ├─ 2026-09-16.dev.jsonl        개발 서버가 쓴 것 (조회 시 id 로 겹침 제거)
      └─ logger-status.json          별도 프로세스 기록기의 상태 (10초마다 갱신 · 30초 넘으면 죽은 것으로 봄)
```

리비전 번호는 이력 파일 이름에서 읽습니다. 따로 관리하는 상태가 없으므로 폴더를 복사하거나 합쳐도 계산이 어긋나지 않습니다. 폴더를 옮길 때는 `.photos/` 도 함께 옮깁니다 — 없으면 스냅샷의 사진만 빠지고 도면 파일은 그대로입니다.

### 이력이 커지지 않게

- **같은 내용은 새 판을 만들지 않습니다.** 마지막 판과 내용이 같으면 서버가 리비전을 그대로 돌려주고(`바뀐 내용이 없어 rN 그대로입니다`) 스냅샷을 쓰지 않습니다.
- **스냅샷의 사진은 `.photos/` 에 한 번만** 둡니다. 도면 파일은 사진을 그대로 안고 있지만 이력 파일에는 참조만 남아, 사진이 많은 도면도 스냅샷은 글자 크기입니다. 예전 판이 남긴 사진 내장 스냅샷은 다음 저장 때 자동으로 옮겨집니다. 칸 영상(`videos`)도 같은 폴더에 같은 방식(`<sha1>.mp4` · `.webm` · `.mov`)으로 빠집니다 — 영상은 한 편이 수 MB 라 이 분리가 없으면 저장 한 번에 이력이 수십 MB 씩 자랍니다.
- **보관 규칙**: 최근 30판은 모두 남기고, 그 앞은 하루(UTC)에 마지막 한 판만 남깁니다. 그래도 프로젝트 하나가 100MB 를 넘으면 오래된 판부터 지웁니다(최근 30판은 지우지 않습니다). 지워진 판만 쓰던 사진 파일도 함께 지웁니다. 값은 `createRevisionStore(dir, { keepRecent, maxBytes })` 로 바꿀 수 있습니다.

### API

| 메서드 | 주소 | 하는 일 |
|---|---|---|
| `GET` | `/api/projects` | 도면 목록 (리비전 · 마지막 저장자 포함) |
| `POST` | `/api/projects` | 새 도면 만들기 |
| `GET` | `/api/projects/:id` | 최신 내용과 리비전 |
| `POST` | `/api/projects/:id` | 저장 (자동 스냅샷 · 충돌 시 `409`) |
| `GET` | `/api/projects/:id/history` | 버전 이력 |
| `POST` | `/api/projects/:id/restore/:revId` | 과거 버전으로 되돌리기 |
| `GET` | `/api/lookup` | 실시간 현황판 기준정보 스냅샷 전부 (`{ sites: { default: … } }`) |
| `GET` | `/api/lookup/_meta/connections` | 접속 이름 목록 (비밀 없음 · `connections.json`) |
| `GET` | `/api/lookup/_meta/tables?connection=` | 그 접속 DB 의 표 · 뷰 목록 |
| `GET` | `/api/lookup/_meta/columns?connection=&table=` | 표의 열 이름 · 형 |
| `GET` | `/api/lookup/:site` | 한 사업장의 스냅샷 (행 · 마지막 읽은 시각 · 오류) |
| `GET` | `/api/lookup/:site/config` | 화면용 설정 (env 파일 경로 · 자유 WHERE 는 감춤) |
| `PUT` | `/api/lookup/:site/config` | `{config, author}` 저장 → 바로 읽어 스냅샷까지 돌려줌 |
| `POST` | `/api/lookup/:site/preview` | `{config}` 초안으로 5행만 읽어 보기 (저장 안 함) |
| `POST` | `/api/lookup/:site/refresh` | 설정 파일을 다시 훑고 DB 에서 지금 읽기 |
| `GET` | `/api/live/format` | 현황판 메시지 형식 프로필 전부 (`{ sites, errors }`, 없는 사업장 = 기본 v1) |
| `GET` | `/api/live/format/:site` | 한 사업장 (파일이 없으면 기본 프로필을 `isDefault:true` 로) |
| `PUT` | `/api/live/format/:site` | `{format, author}` 저장 (기본과 같으면 파일 삭제) |
| `DELETE` | `/api/live/format/:site` | 기본(v1)으로 되돌리기 |
| `GET` | `/api/live/events?site=&key=&hours=24&before=<ms>&limit=200` | 서버가 쌓은 등장 · 제거 이벤트, 최신부터. `before` 로 이전 구간을 이어 받음 |
| `GET` | `/api/live/events/status` | 이벤트 로그(파일 수 · 오늘 크기) 와 기록기(접속 · 건수) 상태. 상시 서비스는 별도 프로세스의 상태 파일을 읽음(`external:true`) |

용지 설정(`page.paper`)을 포함한 페이지 내용 전체가 서버 파일과 이력 스냅샷에 그대로 저장·복원됩니다.

`/api/lookup` 은 `.grid-projects/.lookup/{site}.json` 에 적힌 SQL Server 표를 `refreshSeconds` 마다 통째로 읽어 메모리에 둔 것입니다. 읽기에 실패하면 마지막 성공분을 그대로 두고 `ok:false` · `error` 만 채웁니다. 접속(비밀)은 `.lookup/connections.json` 파일로만 관리하고 그것을 바꾸는 주소는 없습니다. 매핑(표 · 열 · 템플릿 · 조건 · 갱신 주기)은 `/live` 의 설정 창이 `PUT …/config` 로 저장합니다. 자세한 설정은 README 의 `/live` 절.

> **개발 서버를 오래 켜 두었다면** 설정 파일이 바뀐 뒤 API 미들웨어가 빠질 수 있습니다.
> 그때 서버 도면 줄은 **사라지지 않고 노란 띠로 바뀌어** 이유와 `다시 연결` 버튼을 보여 줍니다.
> 개발 서버를 다시 시작하고 `다시 연결` 을 누르면 됩니다.
> (앱 쪽 `/api/projects` 라우트가 HTML 대신 언제나 JSON 으로 답하므로 `Unexpected token '<'` 같은 오류는 나지 않습니다.)

> 이 API는 **Vite 개발·미리보기 서버의 미들웨어**입니다. 저장 폴더가 로컬 파일 시스템이라, 파일 시스템이 없는
> Cloudflare Worker 배포본에는 들어가지 않습니다. 서버가 없는 자리에서는 도면을 저장할 곳이 없으므로
> 편집한 내용을 `JSON 내보내기` 로 손에 들고 있어야 합니다.

## 폴더 구조 (최상위)

파일별 설명은 각 파일 머리 주석에 있다. 여기서는 어디에 무엇이 있는지만 적는다.

```
Grid.Tile.Editor/
├─ app/            웹 앱 — editor/(편집기) · m/(모바일 보기) · live/(실시간 현황판) · api/projects/ · api/lookup/(상시 서비스용 라우트 — vinext start 는 Vite 미들웨어를 안 태움)
├─ server/         로컬 공유 API — 리비전 저장소 · /api/projects · 사진 분리 · Vite 플러그인
├─ mcp/            MCP 서버 — 진입점 · 저장소 · 도구(project · cells · palette · pages · preview · history)
├─ scripts/        3100 상시 서비스(service.cmd · server-daemon.cmd) · 이벤트 기록기(live-logger.ts, 데몬이 서버와 함께 띄움) · 빌드 스탬프 · 이력 정리
├─ tests/          로직 · 서버 렌더 · MCP 도구 테스트
├─ docs/           이 문서들과 예시 그림
├─ .grid-projects/ 저장 폴더(도면 JSON · .history/ · .photos/) — 커밋하지 않음
└─ dist/ dist-mcp/ .serve/   빌드 산출물과 3100 스냅샷 — 커밋하지 않음
```
