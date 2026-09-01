/**
 * 빌드 시각을 `app/editor/buildInfo.ts` 에 새긴다.
 *
 * 화면 우상단의 버전 옆에 이 시각이 붙는다 — package.json 버전은 사람이
 * 기능 단위로 올리지만, "지금 도는 서버가 언제 빌드된 것인가" 는 매 빌드
 * 자동으로 갱신되어야 한다. `npm run build` 가 vinext 보다 먼저 이 파일을 쓴다.
 */
import { writeFileSync } from "node:fs";

const pad = (value) => String(value).padStart(2, "0");
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

writeFileSync(
  new URL("../app/editor/buildInfo.ts", import.meta.url),
  `/** 빌드 시각. scripts/stamp-build.mjs 가 빌드 때마다 다시 쓴다 — 손으로 고치지 않는다. */\nexport const BUILT_AT = "${stamp}";\n`,
  "utf8",
);
console.log("build stamp:", stamp);
