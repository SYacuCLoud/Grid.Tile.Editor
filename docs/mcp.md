# MCP 서버

> AI 에이전트가 도면을 만들고 고치는 Model Context Protocol 서버 — 도구 · 저장 위치 · 클라이언트 등록. [← README](../README.md)

AI 에이전트가 도면을 직접 만들고 고칠 수 있도록 **Model Context Protocol** 서버를 함께 제공합니다.
서버가 만드는 파일은 편집기의 `JSON 불러오기` 로 그대로 열리는 같은 형식입니다.

```bash
npm run mcp:build     # dist-mcp/server.js 로 번들
npm run mcp:start     # 번들 실행 (stdio)
npm run mcp:dev       # 빌드 없이 tsx 로 바로 실행
```

## 도구

| 도구 | 하는 일 |
|---|---|
| `grid_create_project` | 제목·격자 크기·용지를 정해 새 도면을 만든다 |
| `grid_list_projects` | 저장 폴더의 프로젝트 목록 |
| `grid_get_project` | 메타데이터 · 팔레트 · 페이지 목록 (`includeCells` 로 셀 맵까지) |
| `grid_set_cell` | 한 칸에 팔레트 항목을 칠하고 식별자·메모·장비 테두리 모양(`lineStyle` · `opacity`)을 붙인다 |
| `grid_fill_area` | 직사각형 영역을 채우거나(테두리만도 가능) 레이어를 비운다 |
| `grid_manage_palette` | 상태·장비·배선 항목 추가 / 수정 / 삭제(`keepCells`·`purgeCells`) · 무늬 · 배선 선 모양 |
| `grid_manage_pages` | 페이지 추가 · 복제 · 삭제 · 이름변경 · 전환 · 크기변경 · 용지 설정 |
| `grid_export_preview` | 도면을 ASCII 다이어그램 또는 SVG 로 그려서 반환 |
| `grid_history` | 리비전 목록 (시각 · 작성자 · 제목 · 페이지 수) |
| `grid_checkpoint` | 지금 파일을 새 리비전으로 이력에 남긴다 |
| `grid_restore` | 고른 리비전으로 되돌린다 (이력은 남는다) |
| `grid_diff` | 두 리비전(또는 리비전 ↔ 현재)의 달라진 칸을 비교 |

> 도면을 만들 때 첫 리비전(r1)이 함께 남습니다. 칸을 칠하는 도구들은 파일만 고치므로,
> 되돌릴 자리를 잡아 두려면 `grid_checkpoint` 를 부릅니다. `grid_history` 의 `externalChange` 가
> 이력과 파일이 어긋났는지 알려 줍니다.

## 저장 위치

프로젝트 하나가 JSON 파일 하나입니다. 기본 폴더는 `./.grid-projects` 이며 `--dir` 인자나
`GRID_TILE_DATA_DIR` 환경 변수로 바꿉니다.

## 클라이언트 등록 예시

```jsonc
{
  "mcpServers": {
    "grid-tile-editor": {
      "command": "node",
      "args": ["C:/_DX/Grid.Tile.Editor/dist-mcp/server.js", "--dir", "C:/_DX/도면"]
    }
  }
}
```
