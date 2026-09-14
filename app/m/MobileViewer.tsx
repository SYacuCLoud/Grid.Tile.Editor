"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONNECTION_LAYER_ID } from "../editor/connection";
import { type Device, DEVICE_TEXT_FIELDS, deviceLabel } from "../editor/device";
import { activeLayoutDoc, activePage, cellKey, type Point, type ProjectDoc } from "../editor/doc";
import { visibleMap } from "../editor/layers";
import type { PaletteItem } from "../editor/palette";
import { collectMemos, memoNumbers } from "../editor/memoPrint";
import { legendItemsForPage } from "../editor/paletteOps";
import { PaletteSwatch } from "../editor/PaletteSwatch";
import { formatStamp, listProjects, loadProject, type ProjectListEntry } from "../editor/server/api";
import { ZONE_LAYER_ID, zoneLegendEntries } from "../editor/zone";
import { MobileCanvas, type MobileCanvasHandle } from "./MobileCanvas";
import { cellSummary, isEmptyCell } from "./mobileView";

/** 서버 도면을 다시 확인하는 간격. 벽에 걸어 둔 태블릿이 최신 판을 따라오게 한다. */
const REFRESH_MS = 30_000;
const TOAST_MS = 2_500;

const DEVICE_FIELD_LABEL: Record<(typeof DEVICE_TEXT_FIELDS)[number], string> = {
  type: "장치 종류",
  program: "프로그램",
  station: "작업장",
  role: "구분",
  serial: "S/N",
  ip: "IP",
  mac: "MAC",
  port: "PORT",
  memo: "비고",
};

type Sheet = "legend" | "memo" | "cell" | null;

interface Opened {
  id: string;
  project: ProjectDoc;
  revision: number;
  savedAt: string | null;
  author: string | null;
}

/** 주소의 `?id=…&page=…`. 링크를 나눠 주면 그 도면·페이지가 바로 열린다. */
function readLocation(): { id: string | null; page: string | null } {
  if (typeof window === "undefined") return { id: null, page: null };
  const params = new URLSearchParams(window.location.search);
  return { id: params.get("id"), page: params.get("page") };
}

function writeLocation(id: string | null, page: string | null, replace: boolean) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (id) params.set("id", id);
  if (id && page) params.set("page", page);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

/**
 * 휴대폰용 도면 보기.
 *
 * 편집기(`/`)는 책상 화면을 전제로 한다 — 도구 막대 · 팔레트 · 검사 패널이 옆에
 * 붙고 마우스 오른쪽 단추와 휠을 쓴다. 현장에서 휴대폰으로 열면 글자가 점이 되고
 * 두 손가락은 페이지를 키운다. 그래서 **보기만 하는** 화면을 따로 둔다: 목록에서
 * 도면을 고르고, 손가락으로 옮기고 키우고, 칸을 누르면 그 칸의 메모·사진·장치를
 * 아래 시트로 읽는다. 저장·편집 단추는 어디에도 없다.
 */
export function MobileViewer() {
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selected, setSelected] = useState<Point | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  /** 화면 가득 재생 중인 영상. 닫혀 있으면 null. */
  const [video, setVideo] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const canvas = useRef<MobileCanvasHandle | null>(null);
  /** 지금 보고 있는 리비전. 자동 갱신이 "바뀌었나" 를 여기에 대고 본다. */
  const revisionRef = useRef<number>(-1);

  useEffect(() => {
    revisionRef.current = opened?.revision ?? -1;
  }, [opened]);

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), TOAST_MS);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const result = await listProjects();
      setEntries(result.projects);
      setListError(null);
    } catch (error) {
      setEntries([]);
      setListError(error instanceof Error ? error.message : "목록을 읽지 못했습니다.");
    }
  }, []);

  const open = useCallback(
    async (id: string, page: string | null, pushHistory: boolean) => {
      setBusy(true);
      setOpenError(null);
      try {
        const loaded = await loadProject(id);
        const pages = loaded.project.pages;
        const target = page && pages.some((p) => p.id === page) ? page : loaded.project.activePageId;
        setOpened({
          id: loaded.id,
          project: loaded.project,
          revision: loaded.revision,
          savedAt: loaded.savedAt,
          author: loaded.author,
        });
        setPageId(target);
        setSheet(null);
        setSelected(null);
        if (pushHistory) writeLocation(loaded.id, target, false);
      } catch (error) {
        setOpened(null);
        setOpenError(error instanceof Error ? error.message : "도면을 열지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** 목록으로 돌아간다. 목록은 그때마다 새로 읽는다 — 그 사이 저장된 도면이 보여야 한다. */
  const close = useCallback(
    (pushHistory: boolean) => {
      setOpened(null);
      setOpenError(null);
      setSheet(null);
      setSelected(null);
      if (pushHistory) writeLocation(null, null, false);
      void refreshList();
    },
    [refreshList],
  );

  // 처음 열 때 주소를 읽고, 뒤로 가기에 따라간다.
  useEffect(() => {
    const apply = () => {
      const here = readLocation();
      if (here.id) void open(here.id, here.page, false);
      else close(false);
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [close, open]);

  // 열어 둔 도면이 서버에서 바뀌면 조용히 따라온다.
  useEffect(() => {
    if (!opened) return;
    const id = opened.id;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const loaded = await loadProject(id);
        if (loaded.revision === revisionRef.current) return;
        setOpened((current) =>
          !current || current.id !== id
            ? current
            : { id: loaded.id, project: loaded.project, revision: loaded.revision, savedAt: loaded.savedAt, author: loaded.author },
        );
        say(`r${loaded.revision} 로 갱신 · ${loaded.author ?? "익명"}`);
      } catch {
        // 잠깐 끊긴 것이다. 다음 번에 다시 본다.
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [opened?.id, opened, say]);

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

  const memos = useMemo(() => (doc ? collectMemos(doc) : []), [doc]);
  const memoIndex = useMemo(() => (doc ? memoNumbers(doc) : {}), [doc]);

  // 구역은 팔레트 항목 모양으로 바꿔 뒤에 붙인다 — 편집기 범례와 같은 목록이다.
  const legend = useMemo<PaletteItem[]>(() => {
    if (!project || !page) return [];
    const items = legendItemsForPage(project.palette, page);
    if (page.zonesHidden) return items;
    return [...items, ...zoneLegendEntries(page.zones)];
  }, [page, project]);

  const summary = useMemo(
    () => (project && page && selected ? cellSummary(project, page, selected.x, selected.y) : null),
    [page, project, selected],
  );

  const switchPage = (id: string) => {
    setPageId(id);
    setSelected(null);
    setSheet(null);
    if (opened) writeLocation(opened.id, id, true);
  };

  const onTap = (point: Point | null) => {
    if (!point) {
      setSelected(null);
      if (sheet === "cell") setSheet(null);
      return;
    }
    setSelected(point);
    setSheet("cell");
  };

  const jumpToMemo = (point: Point) => {
    setSelected(point);
    canvas.current?.focusCell(point);
    setSheet(null);
  };

  const manualRefresh = async () => {
    if (!opened) {
      await refreshList();
      say("목록을 다시 읽었습니다");
      return;
    }
    setBusy(true);
    try {
      const loaded = await loadProject(opened.id);
      const same = loaded.revision === opened.revision;
      setOpened({ id: loaded.id, project: loaded.project, revision: loaded.revision, savedAt: loaded.savedAt, author: loaded.author });
      say(same ? `최신입니다 (r${loaded.revision})` : `r${loaded.revision} 로 갱신`);
    } catch (error) {
      say(error instanceof Error ? error.message : "다시 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // ---- 화면 ----
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-900 text-slate-100 [padding-top:env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 px-3 py-2">
        {opened ? (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-lg leading-none active:bg-slate-700"
            onClick={() => close(true)}
            aria-label="목록으로"
          >
            ‹
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{opened ? opened.project.title : "도면 보기"}</h1>
          <p className="truncate text-[11px] text-slate-400">
            {opened
              ? opened.revision === 0
                ? `${opened.id} · 이력 없음`
                : `r${opened.revision} · ${opened.author ?? "익명"} · ${formatStamp(opened.savedAt)}`
              : "서버에 저장된 도면 · 읽기 전용"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-sm text-slate-300 active:bg-slate-700 disabled:opacity-40"
          onClick={() => void manualRefresh()}
          disabled={busy}
          aria-label="다시 읽기"
        >
          {busy ? "…" : "↻"}
        </button>
      </header>

      {opened && doc && page ? (
        <>
          {opened.project.pages.length > 1 ? (
            <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none]" aria-label="페이지">
              {opened.project.pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchPage(p.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                    p.id === page.id ? "bg-sky-500 text-white" : "bg-slate-700 text-slate-200 active:bg-slate-600"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </nav>
          ) : null}

          <main className="relative min-h-0 flex-1">
            {/* key: 도면·페이지가 바뀌면 배율·위치를 비워 새 페이지가 전체 보기로 시작한다. */}
            <MobileCanvas
              key={`${opened.id}:${page.id}`}
              ref={canvas}
              doc={doc}
              visible={visible}
              memoIndex={memoIndex}
              selected={selected ? cellKey(selected.x, selected.y) : null}
              onTap={onTap}
            />

            {sheet ? (
              <section
                className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-y-auto rounded-t-2xl bg-white text-slate-900 shadow-[0_-4px_16px_rgba(0,0,0,0.35)]"
                aria-live="polite"
              >
                <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
                  <h2 className="text-sm font-semibold">
                    {sheet === "legend" ? "범례" : sheet === "memo" ? `메모 ${memos.length}건` : summary ? `칸 (${summary.x + 1}, ${summary.y + 1})` : "칸"}
                  </h2>
                  <button
                    type="button"
                    className="rounded px-2 py-0.5 text-slate-500 active:bg-slate-100"
                    onClick={() => setSheet(null)}
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </div>

                {sheet === "legend" ? (
                  <ul className="grid grid-cols-2 gap-x-3 px-4 py-3">
                    {legend.length === 0 ? <li className="col-span-2 text-sm text-slate-500">이 페이지에 쓰인 항목이 없습니다.</li> : null}
                    {legend.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 py-1.5">
                        <PaletteSwatch item={item} size={18} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{item.name}</span>
                          {item.description ? <span className="block truncate text-[11px] text-slate-500">{item.description}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {sheet === "memo" ? (
                  <ol className="divide-y divide-slate-100 px-2 py-1">
                    {memos.length === 0 ? <li className="px-2 py-3 text-sm text-slate-500">이 페이지에는 메모가 없습니다.</li> : null}
                    {memos.map((entry) => (
                      <li key={entry.key}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 px-2 py-2 text-left active:bg-slate-50"
                          onClick={() => jumpToMemo({ x: entry.x, y: entry.y })}
                        >
                          <span className="mt-0.5 shrink-0 rounded bg-slate-900 px-1.5 text-[11px] font-semibold text-white">{entry.no}</span>
                          <span className="min-w-0 flex-1">
                            {entry.label ? <span className="mr-1 text-xs font-semibold text-slate-700">{entry.label}</span> : null}
                            <span className="whitespace-pre-wrap text-sm text-slate-800">{entry.memo}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}

                {sheet === "cell" && summary ? (
                  <CellDetail summary={summary} onPhoto={setPhoto} onVideo={setVideo} />
                ) : null}
              </section>
            ) : null}

            {toast ? (
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/85 px-3 py-1 text-xs text-white">
                {toast}
              </div>
            ) : null}
          </main>

          <footer className="flex items-stretch justify-around border-t border-slate-800 bg-slate-900 text-xs [padding-bottom:env(safe-area-inset-bottom)]">
            <FooterButton active={sheet === "legend"} onClick={() => setSheet(sheet === "legend" ? null : "legend")}>
              범례
            </FooterButton>
            <FooterButton active={sheet === "memo"} onClick={() => setSheet(sheet === "memo" ? null : "memo")}>
              메모{memos.length > 0 ? ` ${memos.length}` : ""}
            </FooterButton>
            <FooterButton
              onClick={() => {
                canvas.current?.fit();
                setSheet(null);
              }}
            >
              전체 보기
            </FooterButton>
          </footer>
        </>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {openError ? (
            <p className="mb-3 rounded-lg bg-rose-900/60 px-3 py-2 text-sm text-rose-100">{openError}</p>
          ) : null}
          {busy && !entries ? <p className="px-1 py-6 text-center text-sm text-slate-400">불러오는 중…</p> : null}
          {entries === null && !busy ? <p className="px-1 py-6 text-center text-sm text-slate-400">목록을 읽는 중…</p> : null}
          {listError ? (
            <div className="rounded-lg bg-slate-800 px-3 py-3 text-sm text-slate-300">
              <p>{listError}</p>
              <button type="button" className="mt-2 rounded bg-slate-700 px-3 py-1 text-xs" onClick={() => void refreshList()}>
                다시 시도
              </button>
            </div>
          ) : null}
          {entries && entries.length === 0 && !listError ? (
            <p className="px-1 py-6 text-center text-sm text-slate-400">저장된 도면이 없습니다. 편집기에서 `서버 저장` 을 하면 여기에 보입니다.</p>
          ) : null}
          {entries && entries.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl bg-slate-800 px-4 py-3 text-left active:bg-slate-700"
                    onClick={() => void open(entry.id, null, true)}
                    disabled={busy}
                  >
                    <span className="block truncate text-base font-semibold">{entry.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {entry.pages} 페이지 · {entry.revision === 0 ? "이력 없음" : `r${entry.revision} · ${entry.author ?? "익명"} · ${formatStamp(entry.savedAt)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-6 text-center text-[11px] text-slate-500">
            보기 전용입니다. 편집은 책상에서{" "}
            <Link href="/" className="underline">
              편집기
            </Link>
            를 엽니다.
          </p>
        </main>
      )}

      {photo ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2"
          onClick={() => setPhoto(null)}
          aria-label="사진 닫기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL 사진, 최적화 대상이 아니다 */}
          <img src={photo} alt="칸 사진" className="max-h-full max-w-full object-contain" />
        </button>
      ) : null}

      {video ? (
        // 사진과 달리 아무 곳을 눌러 닫지 않는다 — 재생 조절 단추를 누르다 닫히면 곤란하다.
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-label="칸 영상">
          <div className="flex items-center justify-end px-3 py-2 [padding-top:max(0.5rem,env(safe-area-inset-top))]">
            <button
              type="button"
              className="rounded-full bg-slate-800 px-4 py-1.5 text-sm text-white active:bg-slate-700"
              onClick={() => setVideo(null)}
            >
              닫기
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 현장 기록 영상이라 자막이 없다 */}
            <video src={video} controls autoPlay playsInline className="max-h-full max-w-full" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FooterButton(props: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex-1 py-3 ${props.active ? "text-sky-400" : "text-slate-300"} active:bg-slate-800`}
    >
      {props.children}
    </button>
  );
}

/** 누른 칸의 내용. 비어 있으면 그렇다고만 적는다. */
function CellDetail(props: {
  summary: ReturnType<typeof cellSummary>;
  onPhoto: (src: string) => void;
  onVideo: (src: string) => void;
}) {
  const { summary } = props;
  if (isEmptyCell(summary)) {
    return <p className="px-4 py-4 text-sm text-slate-500">빈 칸입니다.</p>;
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 text-sm">
      {summary.zones.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {summary.zones.map((name) => (
            <span key={name} className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-800">
              구역 · {name}
            </span>
          ))}
        </div>
      ) : null}

      {summary.label ? <p className="text-lg font-semibold tracking-wide">{summary.label}</p> : null}

      {summary.items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {summary.items.map(({ layer, item }) => (
            <li key={`${layer}:${item.id}`} className="flex items-center gap-2">
              <PaletteSwatch item={item} size={16} />
              <span>{item.name}</span>
              <span className="text-[11px] text-slate-500">{layer}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {summary.device ? <DeviceDetail device={summary.device} /> : null}

      {summary.memo ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">메모</p>
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-slate-800">{summary.memo}</p>
        </div>
      ) : null}

      {summary.photos.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">사진 {summary.photos.length}장</p>
          <div className="grid grid-cols-3 gap-1.5">
            {summary.photos.map((src, i) => (
              <button key={i} type="button" className="aspect-square overflow-hidden rounded-lg bg-slate-100" onClick={() => props.onPhoto(src)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL 사진, 최적화 대상이 아니다 */}
                <img src={src} alt={`사진 ${i + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {summary.videos.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">영상 {summary.videos.length}편</p>
          <div className="grid grid-cols-3 gap-1.5">
            {summary.videos.map((src, i) => (
              <button
                key={i}
                type="button"
                className="relative aspect-square overflow-hidden rounded-lg bg-slate-900"
                onClick={() => props.onVideo(src)}
                aria-label={`영상 ${i + 1} 재생`}
              >
                {/* 첫 프레임만 보인다. metadata 까지만 읽어 시트가 무거워지지 않게 한다. */}
                <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center text-2xl text-white drop-shadow">
                  ▶
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeviceDetail({ device }: { device: Device }) {
  const rows = DEVICE_TEXT_FIELDS.filter((field) => device[field]);
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-slate-500">장치 · {deviceLabel(device)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-slate-50 px-3 py-2">
        {rows.map((field) => (
          <div key={field} className="contents">
            <dt className="text-[11px] text-slate-500">{DEVICE_FIELD_LABEL[field]}</dt>
            <dd className="truncate">{device[field]}</dd>
          </div>
        ))}
        {device.comPort ? (
          <div className="contents">
            <dt className="text-[11px] text-slate-500">COM 포트</dt>
            <dd>연결</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
