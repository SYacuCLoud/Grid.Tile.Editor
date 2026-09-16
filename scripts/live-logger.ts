/**
 * 이벤트 기록기 — 별도 Node 프로세스.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/live-logger.ts
 *
 * 상시 서비스(`vinext start`)의 라우트 코드는 Cloudflare 호환 런타임에서 돌아 `net` 이 없어 MQTT 에 붙지 못한다.
 * 그래서 브로커 구독은 이 프로세스가 맡고, 웹 서버는 이 프로세스가 쓴 파일(`.grid-projects/.live/events/`)만 읽는다.
 * 개발 서버(Vite 미들웨어, Node)는 같은 코드를 프로세스 안에서 돌린다 — 파일 이름의 `dev`/`main` 으로 갈린다.
 *
 * `scripts/server-daemon.cmd` 가 서버를 (다시) 켤 때마다 이것도 띄운다. 이미 도는 것이 있으면 바로 끝나고,
 * 데몬이 `stop.flag` 를 만들면 5초 안에 스스로 끝난다.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createEventLog, EVENTS_DIR } from "../server/eventLog";
import { createEventLogger } from "../server/eventLogger";
import { createFormatStore, FORMAT_DIR } from "../server/formatStore";

const root = resolve(process.env.GRID_TILE_DATA_DIR || join(process.cwd(), ".grid-projects"));
const serveDir = resolve(process.env.GRID_SERVE_DIR || join(root, "..", ".serve"));
const stopFlag = join(serveDir, "stop.flag");
const pidFile = join(serveDir, "live-logger.pid");
const instance = process.env.GRID_LIVE_INSTANCE || "main";

function say(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 하나만 돈다. 예전 PID 가 살아 있으면 물러난다(데몬이 서버를 다시 켤 때마다 부르므로 보통 이 길로 끝난다).
mkdirSync(serveDir, { recursive: true });
if (existsSync(pidFile)) {
  const old = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  if (Number.isFinite(old) && old !== process.pid && alive(old)) {
    say(`이미 기록기가 돌고 있습니다 (PID ${old}). 이 프로세스는 끝냅니다.`);
    process.exit(0);
  }
}
writeFileSync(pidFile, String(process.pid), "utf8");

const formats = createFormatStore(root, { log: say });
const log = createEventLog(join(root, EVENTS_DIR), { instance });
const handle = createEventLogger({
  log,
  formats,
  configDir: join(root, FORMAT_DIR),
  logger: say,
  statusFile: join(root, EVENTS_DIR, "logger-status.json"),
});
say(`기록기 시작 — 데이터 ${root} · 표시 ${instance} · PID ${process.pid}`);

let stopping = false;
async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  say(`끝냅니다 — ${reason}`);
  await handle.stop();
  try {
    if (existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() === String(process.pid)) unlinkSync(pidFile);
  } catch {
    // 지우지 못해도 다음 기록기가 PID 생존 여부로 판단한다.
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// 데몬의 stop.flag — 서비스가 멈추면 함께 멈춘다.
setInterval(() => {
  if (existsSync(stopFlag)) void shutdown("stop.flag");
}, 5000);
