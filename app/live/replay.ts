/**
 * 재발행 요청 — 기록기가 죽어 있던 구간의 이력을 감시 PC(RfidReaderMonitor)에게 다시 내 달라고 한다.
 *
 * 브라우저가 자기 MQTT 접속(WebSocket)으로 `{prefix}/{site}/replay`(또는 `…/host/{PC}/replay`) 에 요청을 내면,
 * 감시 PC 가 자기 CSV 에서 그 구간을 읽어 `{prefix}/{site}/reader/{key}/replay` 로 다시 낸다 — 현황판은 그 토픽을
 * 구독하지 않으므로 지금 상태는 흔들리지 않고, 서버 기록기만 받아 이력에 넣는다. 끝나면 `…/host/{PC}/replay-done` 이 온다.
 * 형식: RfidReaderMonitor docs/mqtt/replay.schema.json · replay-done.schema.json
 */

export interface ReplayDone {
  host: string;
  requestId: string;
  from: string;
  to: string;
  count: number;
  truncated: boolean;
  files: number;
  error: string | null;
  /** 이 화면이 받은 시각(ms). */
  at: number;
}

function seg(prefix: string, site: string): { p: string; s: string } {
  return { p: prefix.trim() || "rfid", s: site.trim() || "default" };
}

/** 요청 토픽. host 를 주면 그 PC 만, 아니면 사업장의 모든 PC. */
export function replayTopic(prefix: string, site: string, host?: string | null): string {
  const { p, s } = seg(prefix, site);
  return host && host.trim() ? `${p}/${s}/host/${host.trim()}/replay` : `${p}/${s}/replay`;
}

/** 끝 알림 구독 필터. */
export function replayDoneTopic(prefix: string, site: string): string {
  const p = prefix.trim() || "rfid";
  const s = site.trim() || "+";
  return `${p}/${s}/host/+/replay-done`;
}

export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function replayPayload(args: { fromMs: number; toMs: number; requestId: string; host?: string | null }): string {
  const body: Record<string, unknown> = { v: 1, type: "replay", from: new Date(args.fromMs).toISOString(), to: new Date(args.toMs).toISOString(), requestId: args.requestId };
  if (args.host && args.host.trim()) body.host = args.host.trim();
  return JSON.stringify(body);
}

export function isReplayDoneTopic(topic: string): boolean {
  const parts = topic.split("/");
  return parts.length === 5 && parts[2] === "host" && parts[4] === "replay-done" && parts[3] !== "";
}

export function parseReplayDone(topic: string, payload: string, at: number): ReplayDone | null {
  if (!isReplayDoneTopic(topic)) return null;
  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    if (raw.type !== undefined && raw.type !== "replay-done") return null;
    const host = typeof raw.host === "string" && raw.host ? raw.host : topic.split("/")[3];
    return {
      host,
      requestId: typeof raw.requestId === "string" ? raw.requestId : "",
      from: typeof raw.from === "string" ? raw.from : "",
      to: typeof raw.to === "string" ? raw.to : "",
      count: typeof raw.count === "number" ? raw.count : 0,
      truncated: raw.truncated === true,
      files: typeof raw.files === "number" ? raw.files : 0,
      error: typeof raw.error === "string" && raw.error ? raw.error : null,
      at,
    };
  } catch {
    return null;
  }
}

/** `<input type="datetime-local">` 값(이 브라우저 시간대, 분 단위). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 시각 표시 `09-17 16:31`. */
export function shortStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
