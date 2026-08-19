"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CellNotePopover } from "./CellNotePopover";
import { legendBandCells, legendColumns, sheetCells } from "./paper";
import { parseCellKey } from "./doc";
import { GridCanvas } from "./GridCanvas";
import { InspectorPanel } from "./InspectorPanel";
import { PageTabs } from "./PageTabs";
import { PalettePanel } from "./PalettePanel";
import { legendItemsForProject } from "./paletteOps";
import { renderSheet, sheetPixelSize } from "./render";
import { anchoredScroll, panScroll, type ScrollAnchor, type WheelAnchor } from "./zoom";
import { downloadCanvasPng, downloadJson, fileStamp, parseProjectJson } from "./storage";
import { Toolbar } from "./Toolbar";
import { useEditor } from "./useEditor";

const PNG_SCALE = 2;

function safeFileName(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "배치도";
}

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


  // 범례는 프로젝트 공용 팔레트 기준이다. 다른 페이지에서만 쓰이는 항목의 색 설명도 남는다.
  const legend = useMemo(() => legendItemsForProject(state.project), [state.project]);

  const exportPng = useCallback(() => {
    const size = sheetPixelSize(state.doc, state.cell, legend);
    const canvas = document.createElement("canvas");
    canvas.width = size.width * PNG_SCALE;
    canvas.height = size.height * PNG_SCALE;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(PNG_SCALE, 0, 0, PNG_SCALE, 0, 0);
    renderSheet(ctx, state.doc, state.cell, state.visible, legend);
    downloadCanvasPng(
      canvas,
      `${safeFileName(state.project.title)}-${safeFileName(state.activePageDoc.name)}-${fileStamp()}.png`,
    );
  }, [legend, state.activePageDoc.name, state.cell, state.doc, state.project.title, state.visible]);

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
  const noteCell = state.noteKey
    ? {
        key: state.noteKey,
        point: parseCellKey(state.noteKey),
        label: state.doc.equipment[state.noteKey]?.label ?? "",
        memo: state.doc.equipment[state.noteKey]?.memo ?? "",
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

  const cursor = state.tool === "pick" ? "pointer" : state.tool === "eraser" ? "cell" : "crosshair";
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
        cell={state.cell}
        savedAt={state.savedAt}
        onTitle={actions.setTitle}
        onTool={actions.setTool}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onCopy={actions.copy}
        onCut={actions.cut}
        onPaste={actions.paste}
        onShowGrid={actions.setShowGrid}
        onZoom={actions.zoomBy}
        onExportJson={exportJson}
        onImportJson={importJson}
        onExportPng={exportPng}
        onLoadSample={actions.loadSample}
        onReset={resetAll}
      />

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
          onAddItem={actions.addPaletteItem}
          onUpdateItem={actions.updatePaletteItem}
          onDeleteItem={actions.deletePaletteItem}
        />

        <main ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
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
            noteOpen={!!state.noteKey}
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
                caption={noteCaption}
                onSave={(value) => actions.saveNote(noteCell.key, value)}
                onClose={actions.closeNote}
              />
            ) : null}
          </GridCanvas>
        </main>

        <InspectorPanel
          doc={state.doc}
          selectedKey={state.selectedKey}
          selectionRange={state.selectionRange}
          legend={legend}
          hasClipboard={!!state.clipboard}
          onInfo={actions.setInfo}
          onSize={actions.setSize}
          paper={state.activePageDoc.paper}
          legendCount={legend.length}
          onPaper={actions.setPaper}
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
