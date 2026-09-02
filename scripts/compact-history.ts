/**
 * 이력 폴더를 한 번에 다듬는다 — `npm run history:compact [폴더]`
 *
 * 저장할 때마다 저절로 하는 일(옛 스냅샷의 사진을 `.photos/` 로 옮기기 · 보관 규칙 ·
 * 안 쓰는 사진 지우기)을 모든 도면에 대해 지금 한다. 규칙을 새로 넣었거나 옛
 * 폴더를 물려받았을 때 저장을 기다리지 않고 자리를 되찾으려는 것이다.
 *
 * 폴더는 인수 → `GRID_TILE_DATA_DIR` → `.grid-projects` 순으로 잡는다.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createRevisionStore, HISTORY_DIR } from "../server/revisions";
import { PHOTOS_DIR } from "../server/photoStore";

function folderBytes(dir: string): number {
  let total = 0;
  const walk = (path: string) => {
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(path, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else total += stat.size;
    }
  };
  walk(dir);
  return total;
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

const store = createRevisionStore(process.argv[2]);
const historyDir = join(store.dir, HISTORY_DIR);
const photosDir = join(store.dir, PHOTOS_DIR);

const before = folderBytes(historyDir) + folderBytes(photosDir);
console.log(`폴더: ${store.dir}`);
console.log(`정리 전: 이력 ${mb(folderBytes(historyDir))} + 사진 ${mb(folderBytes(photosDir))}`);

for (const entry of store.projects.list()) {
  const count = store.history(entry.projectId).length;
  store.compact(entry.projectId);
  const kept = store.history(entry.projectId).length;
  console.log(`  ${entry.projectId}: ${count}판 → ${kept}판`);
}

const after = folderBytes(historyDir) + folderBytes(photosDir);
console.log(`정리 후: 이력 ${mb(folderBytes(historyDir))} + 사진 ${mb(folderBytes(photosDir))}  (${mb(before)} → ${mb(after)})`);
