# 실행과 운영

> 요구 사항 · 개발 서버(3200) · 프로덕션 빌드 · 상시 서비스(3100) · 명령 모음 · 기술 스택. [← README](../README.md)

## 요구 사항

- Node.js **22.13 이상**

## 개발 서버 (테스트용 · 포트 3200)

```bash
npm install     # 처음 1회
npm run dev
```

브라우저에서 `http://localhost:3200` 으로 접속합니다. 개발 서버는 **3200** 에 뜨므로 아래 상시 서비스(3100)와 나란히 돌릴 수 있습니다.

## 프로덕션 빌드

```bash
npm run build
```

- 빌드 산출물: **`Grid.Tile.Editor/dist/`** (`dist/client` 정적 자산, `dist/server` Worker 번들)
- 빌드 결과를 로컬에서 확인: `npm run start:test` (포트 3200 · 3100 상시 서비스와 겹치지 않음)

## 상시 서비스 (포트 3100)

`http://localhost:3100` 에서 늘 떠 있는 서버입니다. 작업 폴더의 `dist/` 가 아니라 **`.serve/dist/` 스냅샷**을 서비스하므로, `npm run build` · `npm test` 가 `dist/` 를 다시 써도 3100 은 영향을 받지 않습니다. 3100 에 새 빌드를 올리는 것은 `deploy` 한 번입니다.

```bash
scripts\service.cmd install    # 처음 1회: 로그온 시 자동 시작 등록 + 지금 시작
npm run deploy                 # 빌드 → .serve\dist 스냅샷 → 재시작 (= scripts\service.cmd deploy)
scripts\service.cmd status     # 서버 · 데몬 · 자동 시작 · 스냅샷 시각
scripts\service.cmd log        # logs\server.log 마지막 30줄
scripts\service.cmd stop       # 중지 (start 로 다시 시작)
scripts\service.cmd uninstall  # 자동 시작 해제 + 중지
```

- 자동 시작은 작업 스케줄러(`Grid Tile Editor` 작업) 등록을 먼저 시도하고, 권한이 없으면(일반 사용자) 시작 프로그램 폴더(`shell:startup`)에 `Grid Tile Editor.vbs` 를 둡니다. `uninstall` 이 둘 다 지웁니다.
- 데몬(`scripts/server-daemon.cmd`)이 숨은 창에서 돌며 node 가 죽으면 5초 뒤 다시 띄웁니다. 로그는 `logs/server.log` (5MB 를 넘으면 `.1` 로 교대).
- 공유 도면 폴더는 그대로 프로젝트의 `.grid-projects/` 입니다(데몬이 `GRID_TILE_DATA_DIR` 로 고정).
- `start-grid-tile-editor.cmd` 를 두 번 클릭하면 서비스가 떠 있는지 확인한 뒤 브라우저를 엽니다.
- 포트 정리: **3100** 상시 서비스 · **3200** 개발/테스트(`npm run dev`, `npm run start:test`).
- 휴대폰에서는 `http://<서버 주소>:3100/m` — 읽기 전용 [모바일 도면 보기](./mobile.md).
- 벽걸이 현황판은 `http://<서버 주소>:3100/live` — MQTT 로 받은 리더 상태를 도면 위에 얹는 [실시간 현황판](./live.md).

## 그 밖의 명령

```bash
npm run typecheck   # tsc --noEmit 타입 검사만
npm run lint        # ESLint (dist, .next, .serve 제외)
npm run test:unit   # 로직 테스트만 (약 4초, 빌드 없음) — 작업 중 수시로
npm test            # 타입 검사 → 빌드 → 서버 렌더 테스트 → 로직 테스트 (커밋 전, 3100 서비스에 영향 없음)
npm run deploy      # 빌드 → 3100 상시 서비스에 반영
npm run service -- status   # scripts\service.cmd 의 다른 명령 (start · stop · restart · log …)
npm run db:generate # (선택) Drizzle 마이그레이션 생성
```

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| UI | React 19 (RSC), TypeScript 5.9 (strict) |
| 프레임워크 | [vinext](https://www.npmjs.com/package/vinext) (App Router 호환) + Vite 8 |
| 스타일 | Tailwind CSS 4 |
| 렌더링 | HTML5 Canvas 2D (격자·배선·PNG 시트 직접 렌더) |
| 배포 대상 | Cloudflare Workers (`@cloudflare/vite-plugin`, Wrangler) |
| 저장소 | 브라우저 `localStorage` · 로컬 폴더 공유(`.grid-projects/`) (선택적으로 Cloudflare D1 + Drizzle ORM) |
| 에이전트 연동 | `@modelcontextprotocol/sdk` 1.30 + zod 4 (stdio MCP 서버) |
| 테스트 | `node --test` + `tsx --test` |

> 편집기 자체는 **서버가 필요 없습니다.** Worker / D1 구성은 정적 호스팅과 향후 서버 저장을 위한 발판입니다.
