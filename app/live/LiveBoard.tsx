"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MqttClient } from "mqtt";
import { CONNECTION_LAYER_ID } from "../editor/connection";
import { activeLayoutDoc, activePage, type ProjectDoc } from "../editor/doc";
import { visibleMap } from "../editor/layers";
import { formatStamp, listProjects, loadProject, type ProjectListEntry } from "../editor/server/api";
import { ZONE_LAYER_ID } from "../editor/zone";
import { LiveCanvas } from "./LiveCanvas";
import {
  applyMessage,
  defaultBrokerUrl,
  EMPTY_LIVE,
  formatAgo,
  formatDwell,
  hasLiveFlash,
  LIVE_COLORS,
  type LiveModel,
  matchReaders,
  pruneFlashes,
  readerPaint,
  subscriptionTopics,
} from "./liveState";
import { loadMqtt } from "./mqttLoader";

/** 서버 도면을 다시 확인하는 간격. 편집기에서 칸을 옮기면 현황판도 따라와야 한다. */
const REFRESH_MS = 30_000;

type Connection = "loading" | "connecting" | "connected" | "reconnecting" | "error";

interface Opened {
  id: string;
  project: ProjectDoc;
  revision: number;
  savedAt: string | null;
  author: string | null;
}

interface Location {
  id: string | null;
  page: string | null;
  broker: string | null;
  site: string;
  prefix: string;
}

/** 주소의 `?id=…&page=…&broker=ws://…:9001&site=…&prefix=…`. 벽걸이 PC 는 이 주소를 즐겨찾기에 둔다. */
function parseLocation(search: string): Location {
  const p = new URLSearchParams(search);
  return {
    id: p.get("id"),
    page: p.get("page"),
    broker: p.get("broker"),
    site: p.get("site") ?? "",
    prefix: p.get("prefix") ?? "rfid",
  };
}

function writeLocation(loc: Location) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (loc.id) p.set("id", loc.id);
  if (loc.id && loc.page) p.set("page", loc.page);
  if (loc.broker) p.set("broker", loc.broker);
  if (loc.site) p.set("site", loc.site);
  if (loc.prefix && loc.prefix !== "rfid") p.set("prefix", loc.prefix);
  const query = p.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/**
 * 주소 문자열을 React 바깥의 "외부 저장소" 로 본다.
 *
 * 서버에는 주소가 없으므로(null) 서버 렌더는 자리표시만 내고, 브라우저가 붙은 뒤에
 * 진짜 화면을 그린다 — 서버가 목록을, 브라우저가 도면을 그리면 hydration 이 어긋난다.
 * 뒤로 가기(popstate)와 이 화면의 페이지 전환이 같은 길로 새 주소를 알린다.
 */
const locationListeners = new Set<() => void>();
function subscribeLocation(listener: () => void) {
  locationListeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    locationListeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
function getSearch(): string {
  return window.location.search;
}
function getServerSearch(): null {
  return null;
}
function navigateTo(loc: Location) {
  writeLocation(loc);
  for (const listener of locationListeners) listener();
}

/**
 * 실시간 현황판.
 *
 * 서버 도면을 읽기 전용으로 띄우고, MQTT 브로커(WebSocket)에서 RfidReaderMonitor 가
 * 발행하는 리더 상태를 받아 도면 칸 위에 얹는다. 도면 문서는 한 글자도 바꾸지 않는다.
 * 리더와 칸은 장치 대장의 S/N 으로 잇고, 자리가 없는 리더는 오른쪽에 따로 보여
 * 대장 등록을 유도한다.
 */
export function LiveBoard() {
  const search = useSyncExternalStore(subscribeLocation, getSearch, getServerSearch);
  const loc = useMemo(() => (search === null ? null : parseLocation(search)), [search]);
  if (loc === null) {
    return (
      <div className="min-h-dvh bg-slate-950 px-6 py-8 text-slate-100">
        <h1 className="text-xl font-semibold">실시간 현황판</h1>
        <p className="mt-1 text-sm text-slate-400">읽기 전용 · 불러오는 중…</p>
      </div>
    );
  }
  return <LiveBoardInner loc={loc} navigate={navigateTo} />;
}

function LiveBoardInner(props: { loc: Location; navigate: (next: Location) => void }) {
  const { loc, navigate } = props;
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [model, setModel] = useState<LiveModel>(EMPTY_LIVE);
  const [connection, setConnection] = useState<Connection>("loading");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const revisionRef = useRef(-1);

  const brokerUrl = loc.broker ?? (typeof window === "undefined" ? "" : defaultBrokerUrl(window.location.hostname));

  // ---- 도면 ----
  useEffect(() => {
    if (loc.id) return;
    listProjects()
      .then((r) => {
        setEntries(r.projects);
        setListError(null);
      })
      .catch((e: unknown) => {
        setEntries([]);
        setListError(e instanceof Error ? e.message : "목록을 읽지 못했습니다.");
      });
  }, [loc.id]);

  // 주소의 도면을 연다. 서버 응답이 온 뒤에만 상태를 바꾼다.
  useEffect(() => {
    const id = loc.id;
    const page = loc.page;
    if (!id) return;
    let cancelled = false;
    loadProject(id)
      .then((loaded) => {
        if (cancelled) return;
        const target = page && loaded.project.pages.some((p) => p.id === page) ? page : loaded.project.activePageId;
        setOpened({ id: loaded.id, project: loaded.project, revision: loaded.revision, savedAt: loaded.savedAt, author: loaded.author });
        revisionRef.current = loaded.revision;
        setPageId(target);
        setOpenError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOpened(null);
        setOpenError(e instanceof Error ? e.message : "도면을 열지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [loc.id, loc.page]);

  // 편집기에서 고친 도면을 따라온다 — 리더를 다른 칸으로 옮기면 현황판도 옮겨야 한다.
  useEffect(() => {
    if (!opened) return;
    const id = opened.id;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const loaded = await loadProject(id);
        if (loaded.revision === revisionRef.current) return;
        revisionRef.current = loaded.revision;
        setOpened((cur) => (cur && cur.id === id ? { ...cur, project: loaded.project, revision: loaded.revision, savedAt: loaded.savedAt, author: loaded.author } : cur));
      } catch {
        // 잠깐 끊긴 것이다. 다음에 다시 본다.
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [opened?.id, opened]);

  // ---- MQTT ----
  useEffect(() => {
    if (!brokerUrl) return;
    let client: MqttClient | null = null;
    let cancelled = false;

    loadMqtt()
      .then((mqtt) => {
        if (cancelled) return;
        // 브로커를 바꿔 다시 붙을 때 이전 브로커의 상태가 남아 있으면 안 된다.
        setModel(EMPTY_LIVE);
        setConnection("connecting");
        setConnectionError(null);
        client = mqtt.connect(brokerUrl, {
          clientId: `grid-live-${Math.random().toString(36).slice(2, 10)}`,
          clean: true,
          reconnectPeriod: 3000,
          connectTimeout: 8000,
          keepalive: 30,
        });
        client.on("connect", () => {
          setConnection("connected");
          setConnectionError(null);
          client?.subscribe(subscriptionTopics(loc.prefix, loc.site), { qos: 1 });
        });
        client.on("reconnect", () => setConnection("reconnecting"));
        client.on("close", () => setConnection((c) => (c === "connected" ? "reconnecting" : c)));
        client.on("error", (err) => {
          setConnection("error");
          setConnectionError(err.message);
        });
        client.on("message", (topic, payload) => {
          const at = Date.now();
          setModel((m) => applyMessage(m, topic, payload.toString(), at));
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setConnection("error");
        setConnectionError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      client?.end(true);
    };
  }, [brokerUrl, loc.prefix, loc.site]);

  // ---- 시계 · 잔상 ----
  // 잔상이 살아 있으면 빠르게, 아니면 1초에 한 번 — "n초 전" 과 시계만 움직인다.
  const flashing = hasLiveFlash(model, now);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setModel((m) => pruneFlashes(m, t));
    }, flashing ? 80 : 1000);
    return () => window.clearInterval(timer);
  }, [flashing]);

  // ---- 파생 값 ----
  const project = opened?.project ?? null;
  const page = useMemo(() => {
    if (!project) return null;
    return project.pages.find((p) => p.id === pageId) ?? activePage(project);
  }, [pageId, project]);
  const doc = useMemo(() => (project && page ? activeLayoutDoc({ ...project, activePageId: page.id }) : null), [page, project]);
  const visible = useMemo(() => {
    if (!project || !page) return {};
    const map = visibleMap(project.layers);
    map[ZONE_LAYER_ID] = page.zonesHidden !== true;
    map[CONNECTION_LAYER_ID] = true;
    return map;
  }, [page, project]);

  const readers = useMemo(() => Object.values(model.readers), [model.readers]);
  const match = useMemo(() => (project && page ? matchReaders(project, page, readers) : { placed: [], unplaced: readers }), [page, project, readers]);
  const hosts = useMemo(() => Object.values(model.hosts).sort((a, b) => a.host.localeCompare(b.host)), [model.hosts]);
  const presentCount = match.placed.filter((p) => p.reader.present).length;
  const offlineCount = readers.filter((r) => !r.online).length;

  const switchPage = (id: string) => {
    setPageId(id);
    navigate({ ...loc, page: id });
  };

  const connectionView: Record<Connection, { text: string; color: string }> = {
    loading: { text: "mqtt.js 읽는 중", color: "#94a3b8" },
    connecting: { text: "브로커 접속 중", color: "#f59e0b" },
    connected: { text: "브로커 연결됨", color: "#22c55e" },
    reconnecting: { text: "끊김 · 재접속 중", color: "#f97316" },
    error: { text: "접속 오류", color: "#ef4444" },
  };
  const conn = connectionView[connection];

  // ---- 화면: 도면 고르기 ----
  if (!loc.id) {
    return (
      <div className="min-h-dvh bg-slate-950 px-6 py-8 text-slate-100">
        <h1 className="text-xl font-semibold">실시간 현황판</h1>
        <p className="mt-1 text-sm text-slate-400">도면을 고르면 그 위에 리더 상태를 실시간으로 얹어 보여 줍니다. 읽기 전용입니다.</p>
        <p className="mt-1 text-xs text-slate-500">
          브로커 {brokerUrl || "…"} · 구독 {subscriptionTopics(loc.prefix, loc.site).join(" , ")} — 주소에 <code>?broker=</code> <code>&site=</code> 로 바꿀 수 있습니다.
        </p>
        {listError ? <p className="mt-4 text-sm text-red-400">{listError}</p> : null}
        {entries === null ? <p className="mt-4 text-sm text-slate-400">목록 읽는 중…</p> : null}
        {entries && entries.length === 0 && !listError ? <p className="mt-4 text-sm text-slate-400">서버에 저장된 도면이 없습니다.</p> : null}
        {entries && entries.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => {
              const params = new URLSearchParams(window.location.search);
              params.set("id", entry.id);
              return (
                <li key={entry.id}>
                  <a
                    href={`?${params.toString()}`}
                    className="block rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 hover:border-sky-500"
                    onClick={(event) => {
                      event.preventDefault();
                      navigate({ ...loc, id: entry.id, page: null });
                    }}
                  >
                    <span className="block truncate text-base font-semibold">{entry.title}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {entry.id} · r{entry.revision} · {entry.author ?? "익명"} · {formatStamp(entry.savedAt)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="mt-8 text-xs text-slate-500">
          편집은 <Link href="/" className="underline">편집기</Link>, 휴대폰 보기는 <Link href="/m" className="underline">/m</Link>.
        </p>
      </div>
    );
  }

  // ---- 화면: 현황판 ----
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <button
          type="button"
          className="rounded px-2 py-1 text-lg leading-none text-slate-300 hover:bg-slate-800"
          onClick={() => {
            setOpened(null);
            navigate({ ...loc, id: null, page: null });
          }}
          aria-label="도면 고르기"
          title="다른 도면 고르기"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{opened ? opened.project.title : loc.id}</h1>
          <p className="truncate text-[11px] text-slate-400">
            {opened ? `r${opened.revision} · ${opened.author ?? "익명"} · ${formatStamp(opened.savedAt)}` : openError ?? "도면 읽는 중…"}
            {" · 실시간 현황판 (읽기 전용)"}
          </p>
        </div>
        {opened && opened.project.pages.length > 1 ? (
          <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="페이지">
            {opened.project.pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => switchPage(p.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs ${page && p.id === page.id ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
              >
                {p.name}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="flex shrink-0 items-center gap-2 text-xs" title={`${brokerUrl} · 받은 메시지 ${model.received}`}>
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: conn.color }} aria-hidden="true" />
          <span className="text-slate-300">{conn.text}</span>
        </div>
        <time className="shrink-0 font-mono text-lg tabular-nums text-slate-200" dateTime={new Date(now).toISOString()}>
          {new Date(now).toLocaleTimeString("ko-KR", { hour12: false })}
        </time>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 p-2">
          {doc ? (
            <LiveCanvas key={`${opened?.id}:${page?.id}`} doc={doc} visible={visible} placed={match.placed} flashes={model.flashes} now={now} />
          ) : (
            <p className="p-4 text-sm text-slate-400">{openError ?? "도면 읽는 중…"}</p>
          )}
          {connection === "error" && connectionError ? (
            <p className="absolute bottom-3 left-3 rounded bg-red-900/80 px-3 py-1.5 text-xs text-red-100">
              브로커 {brokerUrl}: {connectionError}
            </p>
          ) : null}
        </main>

        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-800 bg-slate-900/60 p-3 text-sm">
          <section className="grid grid-cols-3 gap-2">
            <Stat label="태그 감지" value={presentCount} color={LIVE_COLORS.present} />
            <Stat label="배치된 리더" value={match.placed.length} color={LIVE_COLORS.empty} />
            <Stat label="오프라인" value={offlineCount} color={offlineCount > 0 ? LIVE_COLORS.remove : LIVE_COLORS.offline} />
          </section>

          <section>
            <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400">감시 PC</h2>
            {hosts.length === 0 ? <p className="text-xs text-slate-500">아직 상태 메시지가 없습니다. RfidReaderMonitor 의 MQTT 발행이 켜져 있는지 보십시오.</p> : null}
            <ul className="flex flex-col gap-1">
              {hosts.map((h) => (
                <li key={h.id} className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-2.5 py-1.5">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.online ? LIVE_COLORS.present : LIVE_COLORS.remove }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{h.host}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {h.online ? `리더 ${h.onlineReaders}/${h.readerCount} · 오늘 ${h.appearToday}↑ ${h.removeToday}↓ · ${formatAgo(h.time, now)}` : "오프라인 (브로커 유언)"}
                      {h.site && loc.site === "" ? ` · ${h.site}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {match.unplaced.length > 0 ? (
            <section>
              <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-amber-300">미배치 리더 {match.unplaced.length}</h2>
              <p className="mb-1 text-[11px] text-slate-400">이 페이지 칸에 자리가 없습니다. 편집기의 장치 대장에 S/N 으로 등록하고 칸에 연결하십시오.</p>
              <ul className="flex flex-col gap-1">
                {match.unplaced.map((r) => (
                  <li key={r.id} className="rounded-lg border border-dashed border-amber-500/40 px-2.5 py-1.5">
                    <span className="block truncate font-semibold">{r.reader}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      S/N {r.serial || "-"} · {r.host} · {r.state}{r.present && r.uid ? ` · ${r.uid}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400">리더 {match.placed.length}</h2>
            <ul className="flex flex-col gap-1">
              {match.placed.map(({ reader, cells }) => {
                const paint = readerPaint(reader);
                return (
                  <li key={reader.id} className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-2.5 py-1.5">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm border" style={{ borderColor: paint.stroke, background: paint.fill ?? "transparent" }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{reader.reader}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        가로 {cells[0].x + 1} · 세로 {cells[0].y + 1}
                        {cells.length > 1 ? ` (+${cells.length - 1})` : ""} · {reader.online ? (reader.present ? `UID ${reader.uid}` : "비어 있음") : "오프라인"} · {formatAgo(reader.at, now)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="min-h-0">
            <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400">최근 이벤트</h2>
            {model.events.length === 0 ? <p className="text-xs text-slate-500">아직 없습니다.</p> : null}
            <ol className="flex flex-col gap-0.5">
              {model.events.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 px-1 py-0.5 text-xs">
                  <span className="shrink-0 rounded px-1 font-semibold text-white" style={{ background: e.kind === "APPEAR" ? LIVE_COLORS.appear : LIVE_COLORS.remove }}>
                    {e.kind === "APPEAR" ? "등장" : "제거"}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-400">{e.time ? new Date(e.time).toLocaleTimeString("ko-KR", { hour12: false }) : "-"}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.reader}
                    {e.uid ? <span className="ml-1 font-mono text-slate-300">{e.uid}</span> : null}
                    {e.kind === "REMOVE" && e.dwellMs !== null ? <span className="ml-1 text-slate-400">체류 {formatDwell(e.dwellMs)}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 px-2 py-1.5 text-center">
      <span className="block text-2xl font-bold tabular-nums" style={{ color: props.color }}>
        {props.value}
      </span>
      <span className="block text-[10px] text-slate-400">{props.label}</span>
    </div>
  );
}
