"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CellNotePopover } from "./CellNotePopover";
import { deviceById, deviceLabel } from "./device";
import { DevicePanel } from "./DevicePanel";
import { legendBandCells, legendColumns, sheetCells } from "./paper";
import { cellPhotos, parseCellKey } from "./doc";
import { GridCanvas } from "./GridCanvas";
import { InspectorPanel } from "./InspectorPanel";
import { PageTabs } from "./PageTabs";
import { PalettePanel } from "./PalettePanel";
import { legendItemsForPage } from "./paletteOps";
import { canvasCells, renderSheet, sheetPixelSize } from "./render";
import { Ruler, RulerCorner } from "./Ruler";
import { HistoryPanel } from "./server/HistoryPanel";
import { ServerBar } from "./server/ServerBar";
import { useServerProjects } from "./server/useServerProjects";
import { downloadPhotos, openPhotoLedger } from "./photoExport";
import { collectPhotoEntries, ledgerSubtitle } from "./photoLedger";
import { collectMemos, MEMO_LINE_MM, MEMO_TEXT_MM, planMemoPages } from "./memoPrint";
import { DEFAULT_MEMO_MODE } from "./paper";
import {
  DEFAULT_PRINT_DPI,
  lastSheetGrid,
  planPrint,
  printSheetSuffix,
  renderMemoSheet,
  renderPrintSheet,
} from "./printSheet";
import { anchoredScroll, keyPanScroll, panScroll, type ScrollAnchor, type WheelAnchor } from "./zoom";
import { downloadCanvasPng, downloadJson, fileStamp, parseProjectJson, safeFileName } from "./storage";
import { Toolbar } from "./Toolbar";
import { useEditor } from "./useEditor";
import type { Zone } from "./zone";
import { ZONE_LAYER_ID, zoneLabelAt, zoneLegendEntries } from "./zone";
import { ZonePopover } from "./ZonePopover";

const PNG_SCALE = 2;
/** 구역이 없는 페이지가 매 렌더마다 새 배열을 만들지 않게 한 개를 돌려 쓴다. */
const EMPTY_ZONES: Zone[] = [];

/** W/A/S/D → 화면을 옮길 방향. */
const PAN_KEYS: Record<string, { x: number; y: number }> = {
  w: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  s: { x: 0, y: 1 },
  d: { x: 1, y: 0 },
};

export function GridEditor() {
  const { state, actions } = useEditor();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  /** 휠 확대 직후 스크롤을 맞추려고 남겨 두는 기준점. */
  const pendingAnchor = useRef<ScrollAnchor | null>(null);

  const onWheelZoom = useCallback(
    (delta: number, anchor: WheelAnchor) => {
      const box = scrollRef.current;
      pendingAnchor.current = box
        ? { ...anchor, scrollLeft: box.scrollLeft, scrollTop: box.scrollTop }
        : null;
      actions.zoomBy(delta);
    },
    [actions],
  );

  // 가운데 버튼으로 화면 끌기. 도구를 바꾸지 않고 도면을 옮길 수 있다.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;

    let start: { scrollLeft: number; scrollTop: number; clientX: number; clientY: number } | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      // 윈도우 브라우저의 가운데 버튼 자동 스크롤을 막는다.
      event.preventDefault();
      start = {
        scrollLeft: box.scrollLeft,
        scrollTop: box.scrollTop,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      box.setPointerCapture(event.pointerId);
      box.style.cursor = "grabbing";
    };

    const onMove = (event: PointerEvent) => {
      if (!start) return;
      const next = panScroll(start, event.clientX, event.clientY);
      box.scrollLeft = next.scrollLeft;
      box.scrollTop = next.scrollTop;
    };

    const stop = (event: PointerEvent) => {
      if (!start) return;
      start = null;
      box.style.cursor = "";
      if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId);
    };

    // 가운데 버튼 클릭이 새 탭 열기 등으로 새지 않게 한다.
    const swallowAux = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", stop);
    box.addEventListener("pointercancel", stop);
    box.addEventListener("auxclick", swallowAux);
    box.addEventListener("mousedown", swallowAux);

    return () => {
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", stop);
      box.removeEventListener("pointercancel", stop);
      box.removeEventListener("auxclick", swallowAux);
      box.removeEventListener("mousedown", swallowAux);
    };
  }, []);

  // W/A/S/D 로 화면 영역을 옮긴다(스크롤). 도구를 바꾸지 않고 도면을 둘러볼 수 있다.
  // Shift 를 누르면 한 화면씩. 칸 메모 상자가 열려 있으면 쉰다 — 그 안은 글자 입력 자리다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 상자가 열려 있으면 도면을 옮기지 않는다 — 상자는 그 자리에 붙어 있어서
      // 도면만 움직이면 상자가 엉뚱한 칸을 가리킨다.
      if (state.noteKey || state.zonePopover) return;

      const dir = PAN_KEYS[event.key.toLowerCase()];
      if (!dir) return;

      const box = scrollRef.current;
      if (!box) return;

      event.preventDefault();
      const next = keyPanScroll(box, dir, state.cell, event.shiftKey);
      box.scrollLeft = next.scrollLeft;
      box.scrollTop = next.scrollTop;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.cell, state.noteKey, state.zonePopover]);

  // 확대 배율이 바뀐 뒤, 굴리기 직전 커서 아래 있던 지점이 그대로 커서 밑에 오도록 스크롤을 옮긴다.
  // 이게 없으면 확대할 때마다 보던 자리가 왼쪽 위로 달아난다.
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const box = scrollRef.current;
    pendingAnchor.current = null;
    if (!anchor || !box) return;

    const next = anchoredScroll(anchor, state.cell);
    box.scrollLeft = next.scrollLeft;
    box.scrollTop = next.scrollTop;
  }, [state.cell]);


  // 범례는 **보고 있는 페이지에서 실제로 쓴 항목**만 담는다. 팔레트는 프로젝트 공용이라
  // 다른 페이지에서만 쓰는 항목까지 넣으면 범례 띠가 길어지고 인쇄 자리를 잡아먹는다.
  //
  // 구역은 팔레트 항목이 아니지만 범례에는 함께 올라온다 — 도면을 처음 보는 사람은
  // "이 색 테두리가 무엇인가" 를 팔레트와 구역으로 나눠 묻지 않는다. 팔레트 항목
  // 뒤에 붙여 한 목록으로 읽게 한다. 눈 아이콘으로 구역을 껐으면 범례에서도 빠진다.
  const legend = useMemo(() => {
    const items = legendItemsForPage(state.project.palette, state.activePageDoc);
    if (state.visible[ZONE_LAYER_ID] === false) return items;
    return [...items, ...zoneLegendEntries(state.activePageDoc.zones)];
  }, [state.activePageDoc, state.project.palette, state.visible]);


  // 메모는 번호를 매겨 둔다. 도면 칸에 찍는 번호와 인쇄물 본문이 같은 번호를
  // 써야 하므로 한 곳에서 만든다. 메모를 인쇄하지 않아도 번호는 매긴다.
  const memos = useMemo(() => collectMemos(state.doc), [state.doc]);
  const memoIndex = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of memos) map[entry.key] = entry.no;
    return map;
  }, [memos]);

  // 로컬 폴더(.grid-projects) 기반 공유. 서버가 없는 자리에서는 스스로 접힌다.
  // 워터마크에 리비전 · 작성자를 적으므로 내보내기보다 먼저 둔다.
  const server = useServerProjects(state.project, actions.replaceProject);

  // 탭 제목에 도면 이름과 서버 리비전을 적는다. 같은 도면을 탭 여럿에 띄워 두면
  // 제목만으로 어느 판을 보고 있는지 가려야 한다. 서버 도면이 아니면 리비전은 뺀다.
  useEffect(() => {
    const revision = server.currentId ? ` · r${server.baseRevision}` : "";
    document.title = `${state.project.title}${revision} — 격자형 배치 편집기`;
  }, [server.currentId, server.baseRevision, state.project.title]);

  // 장치 대장 목록 상자. 열 때 특정 장치를 바로 펼칠 수 있다(칸 우클릭 → 수정).
  const [devicePanel, setDevicePanel] = useState<{ focusId?: string } | null>(null);
  /** 배치 모드에 든 장치. 배너에 이름을 적는 데만 쓴다. */
  const placingDevice = deviceById(state.project.devices, state.placingDeviceId ?? undefined);
  const jumpToDevice = useCallback(
    (pageId: string, key: string) => {
      actions.switchPage(pageId);
      actions.setSelectedKey(key);
      actions.setTool("pick");
      setDevicePanel(null);
    },
    [actions],
  );

  const exportPng = useCallback(() => {
    const stamp = fileStamp();
    const base = `${safeFileName(state.project.title)}-${safeFileName(state.activePageDoc.name)}-${stamp}`;
    const paper = state.activePageDoc.paper;

    // 종이만 보고도 어느 판인지 가릴 수 있게 출처를 여백에 남긴다.
    const meta = {
      title: state.project.title,
      revision: server.baseRevision,
      author: server.author,
      printedAt: new Date(),
    };

    // 용지를 정해 두었으면 그 규격 그대로 뽑는다. 이미지 크기 = 용지 크기(mm→px)이고,
    // 여러 장에 걸치면 장마다 파일을 나눈다. 화면 경계선과 장수·자리가 같다.
    if (paper) {
      const plan = planPrint(state.doc, paper, legend.length, DEFAULT_PRINT_DPI);
      const memoMode = paper.memoMode ?? DEFAULT_MEMO_MODE;

      // 메모 본문을 실을 자리를 미리 나눈다. `inline` 은 마지막 장의 빈 곳부터,
      // `appendix` 는 별지부터 채운다.
      const memoPages = planMemoPages(
        memoMode,
        memos,
        paper,
        memoMode === "inline" ? lastSheetGrid(state.doc, plan) : null,
      );
      const inlinePage = memoPages.find((page) => page.onGridSheet) ?? null;
      const extraPages = memoPages.filter((page) => !page.onGridSheet);

      const newCanvas = () => {
        const canvas = document.createElement("canvas");
        canvas.width = plan.pageWidth;
        canvas.height = plan.pageHeight;
        return canvas;
      };

      for (let index = 0; index < plan.total; index += 1) {
        const canvas = newCanvas();
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        renderPrintSheet(ctx, state.doc, plan, index, state.visible, legend, meta, {
          index: memoIndex,
          page: inlinePage && inlinePage.gridSheetIndex === index ? inlinePage : null,
        });
        downloadCanvasPng(canvas, `${base}-${printSheetSuffix(plan, index)}.png`);
      }

      // 빈 곳에 못 담은 메모는 뒤에 장을 더 붙인다. 도면 장수와 이어지도록
      // 파일 이름에 `메모N` 을 붙인다.
      extraPages.forEach((page, order) => {
        const canvas = newCanvas();
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const title =
          extraPages.length > 1 ? `메모 (${order + 1}/${extraPages.length})` : "메모";
        renderMemoSheet(ctx, page, plan, title, meta.title);
        downloadCanvasPng(
          canvas,
          `${base}-${printSheetSuffix(plan, plan.total - 1)}-메모${order + 1}.png`,
        );
      });
      return;
    }

    const size = sheetPixelSize(state.doc, state.cell, legend);
    const canvas = document.createElement("canvas");
    canvas.width = size.width * PNG_SCALE;
    canvas.height = size.height * PNG_SCALE;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(PNG_SCALE, 0, 0, PNG_SCALE, 0, 0);
    renderSheet(ctx, state.doc, state.cell, state.visible, legend, meta, memoIndex);
    downloadCanvasPng(canvas, `${base}.png`);
  }, [
    legend,
    memoIndex,
    memos,
    server.author,
    server.baseRevision,
    state.activePageDoc.name,
    state.activePageDoc.paper,
    state.cell,
    state.doc,
    state.project.title,
    state.visible,
  ]);

  // 사진 대장은 프로젝트 전체를 훑는다 — 층을 넘나드는 현장에서 페이지마다
  // 따로 뽑으면 대장 구실을 못한다. 인쇄물에서는 페이지 이름으로 갈라 준다.
  const photoEntries = useMemo(() => collectPhotoEntries(state.project), [state.project]);

  const printPhotoLedger = useCallback(() => {
    const opened = openPhotoLedger(photoEntries, {
      title: `${state.project.title} 사진 대장`,
      subtitle: ledgerSubtitle({
        count: photoEntries.length,
        revision: server.baseRevision,
        author: server.author,
        printedAt: new Date(),
      }),
    });
    if (!opened) window.alert("팝업이 막혀 사진 대장을 열지 못했습니다. 이 사이트의 팝업을 허용해 주십시오.");
  }, [photoEntries, server.author, server.baseRevision, state.project.title]);

  const downloadAllPhotos = useCallback(() => {
    if (photoEntries.length === 0) return;
    // 낱장으로 나가므로 장수를 먼저 알린다. 브라우저 설정에 따라 저장 위치를
    // 장마다 물을 수도 있어서, 모르고 누르면 곤란해진다.
    const ok = window.confirm(
      `사진 ${photoEntries.length}장을 각각 파일로 저장합니다. 브라우저가 여러 파일 저장을 물으면 허용해 주십시오. 계속하시겠습니까?`,
    );
    if (ok) void downloadPhotos(photoEntries);
  }, [photoEntries]);

  const exportJson = useCallback(() => {
    downloadJson(state.project, `${safeFileName(state.project.title)}-${fileStamp()}.json`);
  }, [state.project]);

  const importJson = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const next = parseProjectJson(await file.text());
        actions.replaceProject(next);
      } catch {
        window.alert("이 파일은 배치도 JSON 형식이 아닙니다. 이 도구에서 내보낸 파일을 선택해 주십시오.");
      }
    },
    [actions],
  );

  const resetAll = useCallback(() => {
    const ok = window.confirm("배치도의 모든 칸을 지웁니다. 되돌릴 수 없는 작업은 아니지만 자동 저장 내용도 함께 지워집니다. 계속하시겠습니까?");
    if (ok) actions.resetAll();
  }, [actions]);

  // 우클릭으로 연 메모 상자에 넘길 정보 — 칸 위치와 그 칸에 무엇이 놓여 있는지.
  const zones = state.activePageDoc.zones ?? EMPTY_ZONES;

  const noteCell = state.noteKey
    ? {
        key: state.noteKey,
        point: parseCellKey(state.noteKey),
        label: state.doc.equipment[state.noteKey]?.label ?? "",
        memo: state.doc.equipment[state.noteKey]?.memo ?? "",
        photos: cellPhotos(state.doc.equipment[state.noteKey]),
      }
    : null;

  const noteCaption = noteCell
    ? [
        `가로 ${noteCell.point.x + 1} · 세로 ${noteCell.point.y + 1}`,
        legend.find((item) => item.id === state.doc.equipment[noteCell.key]?.status)?.name,
        legend.find((item) => item.id === state.doc.equipment[noteCell.key]?.kind)?.name,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  /**
   * 우클릭으로 연 구역 상자에 넘길 정보.
   *
   * 상태는 구역 ID만 들고 있으므로 여기서 지금의 목록에서 다시 찾는다 — 그 사이
   * 되돌리기 등으로 구역이 사라졌다면 상자를 그리지 않는다(낡은 값을 고치지 않게).
   */
  const zoneEdit = (() => {
    const open = state.zonePopover;
    if (!open) return null;
    const mode = open.mode;
    if (mode.kind === "create") {
      return { x: open.x, y: open.y, mode: { kind: "create" as const, rect: mode.rect } };
    }
    const zone = zones.find((item) => item.id === mode.zoneId);
    if (!zone) return null;
    return { x: open.x, y: open.y, mode: { kind: "edit" as const, zone } };
  })();

  // 인쇄 경계선은 화면에서만 그린다. PNG 내보내기에는 넘기지 않는다.
  const printGuide = useMemo(
    () => (state.activePageDoc.paper ? sheetCells(state.activePageDoc.paper) : null),
    [state.activePageDoc.paper],
  );

  // 인쇄물에는 도면 아래로 범례가 함께 실린다. 그 자리를 경계선 안에 미리 잡아 둔다.
  const printLegend = useMemo(() => {
    const paper = state.activePageDoc.paper;
    if (!paper || legend.length === 0) return null;
    return {
      items: legend,
      bandCells: legendBandCells(paper, legend.length),
      columns: legendColumns(paper),
    };
  }, [legend, state.activePageDoc.paper]);

  /**
   * 인쇄물에 실릴 메모 본문의 자리. 경계선 안에 미리 그려 둔다.
   *
   * `inline` 은 도면 마지막 장의 빈 곳에 얹히므로 그 장의 좌상단 칸을 함께
   * 넘긴다. `appendix` 는 도면 밖 별지라 화면 경계선에는 실을 자리가 없어
   * 미리보기에서 뺀다 — 종이에서 도면 뒤에 따로 붙는다.
   */
  const printMemo = useMemo(() => {
    const paper = state.activePageDoc.paper;
    if (!paper) return null;
    const memoMode = paper.memoMode ?? DEFAULT_MEMO_MODE;
    if (memoMode !== "inline" || memos.length === 0) return null;

    const plan = planPrint(state.doc, paper, legend.length, DEFAULT_PRINT_DPI);
    const last = lastSheetGrid(state.doc, plan);
    const inline = planMemoPages(memoMode, memos, paper, last).find((page) => page.onGridSheet);
    if (!inline) return null;

    return {
      pages: [
        {
          block: inline.block,
          entries: inline.entries,
          // 이 장의 좌상단 칸. 도면이 여러 장이면 마지막 장으로 밀려 있다.
          originCells: {
            x: (last.index % plan.across) * plan.sheet.cols,
            y: Math.floor(last.index / plan.across) * plan.sheet.rows,
          },
        },
      ],
      cellMm: paper.cellMm,
      marginMm: paper.marginMm,
      lineMm: MEMO_LINE_MM,
      textMm: MEMO_TEXT_MM,
    };
  }, [legend.length, memos, state.activePageDoc.paper, state.doc]);

  // 눈금자는 캔버스와 같은 칸 수를 써야 도면과 어긋나지 않는다.
  // 인쇄 경계선을 켜면 캔버스가 용지 범위까지 넓어진다는 점까지 같이 본다.
  const canvasSize = useMemo(
    () => canvasCells(state.doc, printGuide, printLegend?.bandCells ?? 0),
    [printGuide, printLegend?.bandCells, state.doc],
  );

  // 선택 도구에서 이름표 위에 오면 커서를 바꾼다 — 끌 수 있다는 표시가 없으면
  // 이름표를 옮길 수 있다는 것을 아무도 모른다.
  const overZoneLabel =
    state.tool === "pick" &&
    state.hover !== null &&
    state.visible[ZONE_LAYER_ID] !== false &&
    zoneLabelAt(state.activePageDoc.zones, state.hover.x, state.hover.y) !== null;

  const cursor = overZoneLabel
    ? "grab"
    : state.tool === "pick"
      ? "pointer"
      : state.tool === "eraser"
        ? "cell"
        : "crosshair";
  const activeItem = state.tool === "eraser" ? null : state.activeItem;

  return (
    <div className="flex h-screen min-h-0 w-full flex-col bg-slate-100 text-slate-900">
      <Toolbar
        title={state.project.title}
        tool={state.tool}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        hasSelection={!!state.selectionRange}
        hasClipboard={!!state.clipboard}
        showGrid={state.showGrid}
        showRuler={state.showRuler}
        cell={state.cell}
        onTitle={actions.setTitle}
        onTool={actions.setTool}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onCopy={actions.copy}
        onCut={actions.cut}
        onPaste={actions.paste}
        onShowGrid={actions.setShowGrid}
        onShowRuler={actions.setShowRuler}
        onZoom={actions.zoomBy}
        onExportJson={exportJson}
        onImportJson={importJson}
        onExportPng={exportPng}
        photoCount={photoEntries.length}
        onPrintPhotoLedger={printPhotoLedger}
        onDownloadPhotos={downloadAllPhotos}
        deviceCount={state.project.devices?.length ?? 0}
        onOpenDevices={() => setDevicePanel({})}
        onLoadSample={actions.loadSample}
        onReset={resetAll}
      />

      <ServerBar state={server} actions={server.actions} />
      <HistoryPanel state={server} actions={server.actions} />

      <DevicePanel
        key={devicePanel?.focusId ?? "plain"}
        open={devicePanel !== null}
        focusId={devicePanel?.focusId}
        project={state.project}
        onClose={() => setDevicePanel(null)}
        onJump={jumpToDevice}
        onPlace={(deviceId) => {
          setDevicePanel(null);
          actions.startPlacing(deviceId);
        }}
        onUnplace={actions.unplaceDevice}
        onUpsert={actions.upsertDevice}
        onDelete={actions.deleteDevice}
      />

      {placingDevice ? (
        <div className="fixed inset-x-0 top-2 z-40 flex justify-center">
          <div className="flex items-center gap-2 border border-slate-700 bg-slate-800 px-3 py-1.5 text-[12px] text-white shadow-lg">
            <span>
              배치 중: {deviceLabel(placingDevice)} — 도면에서 놓을 칸을 클릭하세요
            </span>
            <button
              type="button"
              className="border border-slate-500 bg-slate-700 px-2 py-0.5 text-[11px] hover:bg-slate-600"
              onClick={actions.cancelPlacing}
              title="Esc"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}

      <PageTabs
        pages={state.project.pages}
        activePageId={state.project.activePageId}
        onSwitchPage={actions.switchPage}
        onAddPage={actions.addPage}
        onRenamePage={actions.renamePage}
        onDeletePage={actions.deletePage}
      />

      <div className="flex min-h-0 flex-1">
        <PalettePanel
          project={state.project}
          activeId={state.activeId}
          activeLayer={state.activeLayer}
          visible={state.visible}
          onSelect={actions.selectPalette}
          onToggleLayer={actions.toggleLayer}
          onFocusLayer={actions.setActiveLayer}
          onToggleLayerLock={actions.toggleLayerLock}
          onAddLayer={actions.addLayer}
          onRenameLayer={actions.renameLayer}
          onMoveLayer={actions.moveLayer}
          onClearLayer={actions.clearLayer}
          onDeleteLayer={actions.deleteLayer}
          onAddItem={actions.addPaletteItem}
          onUpdateItem={actions.updatePaletteItem}
          onDeleteItem={actions.deletePaletteItem}
          zones={zones}
          onToggleZones={actions.toggleZonesHidden}
          onToggleZoneLegend={actions.toggleZoneLegend}
        />

        <main ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
          {/* 눈금자는 스크롤 상자 안에서 sticky 로 붙어 도면과 함께 움직인다. */}
          {state.showRuler ? (
            <div className="flex w-fit">
              <RulerCorner />
              <Ruler orientation="horizontal" count={canvasSize.cols} cell={state.cell} highlight={state.hover?.x ?? null} />
            </div>
          ) : null}

          <div className="flex w-fit">
            {state.showRuler ? (
              <Ruler orientation="vertical" count={canvasSize.rows} cell={state.cell} highlight={state.hover?.y ?? null} />
            ) : null}

            <GridCanvas
            doc={state.doc}
            cell={state.cell}
            visible={state.visible}
            showGrid={state.showGrid}
            previewPoints={state.preview}
            previewItem={activeItem}
            activeLayer={state.activeLayer}
            selectedKey={state.selectedKey}
            selectionRange={state.selectionRange}
            hover={state.hover}
            cursor={cursor}
            onBegin={actions.beginStroke}
            onMove={actions.moveStroke}
            onEnd={actions.endStroke}
            onContextMenu={actions.openNote}
            onWheelZoom={onWheelZoom}
            printGuide={printGuide}
            printLegend={printLegend}
            memoIndex={memoIndex}
            printMemo={printMemo}
            noteOpen={!!state.noteKey || !!state.zonePopover}
            onLeave={() => {
              actions.setHover(null);
              actions.endStroke(null);
            }}
          >
            {noteCell ? (
              <CellNotePopover
                key={noteCell.key}
                x={noteCell.point.x}
                y={noteCell.point.y}
                cell={state.cell}
                cols={state.doc.cols}
                rows={state.doc.rows}
                initialLabel={noteCell.label}
                initialMemo={noteCell.memo}
                initialPhotos={noteCell.photos}
                pageId={state.project.activePageId}
                pageName={state.activePageDoc.name}
                caption={noteCaption}
                {...(() => {
                  const linked = deviceById(state.project.devices, state.doc.equipment[noteCell.key]?.deviceId);
                  if (linked) {
                    // 연결된 칸: 장치 블록을 누르면 대장 수정 모달이 그 장치를 펼친 채 열린다.
                    return {
                      deviceText: deviceLabel(linked),
                      onOpenDevice: () => {
                        actions.closeNote();
                        setDevicePanel({ focusId: linked.id });
                      },
                    };
                  }
                  return {
                    devices: state.project.devices ?? [],
                    onLinkDevice: (deviceId: string) => actions.linkDevice(noteCell.key, deviceId),
                    onRegisterDevice: () => actions.registerDevice(noteCell.key),
                  };
                })()}
                onSave={(value) => actions.saveNote(noteCell.key, value)}
                onClose={actions.closeNote}
              />
            ) : null}

            {zoneEdit ? (
              <ZonePopover
                key={`zone-${zoneEdit.x},${zoneEdit.y}`}
                x={zoneEdit.x}
                y={zoneEdit.y}
                cell={state.cell}
                cols={state.doc.cols}
                rows={state.doc.rows}
                zones={zones}
                mode={zoneEdit.mode}
                onChange={actions.setZones}
                onNote={actions.zonePopoverToNote}
                onClose={actions.closeZonePopover}
              />
            ) : null}
            </GridCanvas>
          </div>
        </main>

        <InspectorPanel
          doc={state.doc}
          selectedKey={state.selectedKey}
          selectionRange={state.selectionRange}
          legend={legend}
          hasClipboard={!!state.clipboard}
          devices={state.project.devices ?? []}
          onSize={actions.setSize}
          paper={state.activePageDoc.paper}
          legendCount={legend.length}
          memos={memos}
          onPaper={actions.setPaper}
          zones={zones}
          onPick={() => actions.setTool("pick")}
          onCopy={actions.copy}
          onCut={actions.cut}
          onPaste={actions.paste}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          void onFileChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
