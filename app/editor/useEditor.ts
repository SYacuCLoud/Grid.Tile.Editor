"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeLayoutDoc,
  activePage,
  addPageToProject,
  cellKey,
  createPage,
  deletePageFromProject,
  eraseCellsOnPage,
  type LayoutDoc,
  paintCellsOnPage,
  parseCellKey,

  type PageDoc,
  type Point,
  type ProjectDoc,
  renamePageInProject,
  resizePage,
  switchActivePage,
  updateActivePage,
  updateEquipmentInfoOnPage,
} from "./doc";
import {
  itemsOfRole,
  type LayerId,
  type PaletteId,
  type PaletteItem,
  type PaletteRole,
} from "./palette";
import {
  addPaletteEntry,
  deleteItemInProject,
  type DeleteMode,
  type PaletteInput,
  updatePaletteEntry,
  validateInput,
  withUserItems,
} from "./paletteOps";
import {
  type CellRange,
  type ClipboardData,
  copyRange,
  cutRange,
  normalizeRange,
  pasteClipboard,
} from "./range";
import type { PagePaper } from "./paper";
import { createSampleProject } from "./sample";
import { floodFillPoints, linePoints, rectFillPoints, rectOutlinePoints } from "./shapes";
import { clearLocal, loadLocal, saveLocal } from "./storage";

export type ToolId = "brush" | "eraser" | "line" | "rect" | "rectFill" | "fill" | "pick";

export interface ToolMeta {
  id: ToolId;
  name: string;
  hint: string;
}

export const TOOLS: ToolMeta[] = [
  { id: "brush", name: "브러시", hint: "끌어서 연속 칠하기" },
  { id: "eraser", name: "지우개", hint: "현재 레이어 내용 지우기" },
  { id: "line", name: "직선", hint: "시작 칸에서 끝 칸까지" },
  { id: "rect", name: "사각형", hint: "테두리만 그리기" },
  { id: "rectFill", name: "사각형 채움", hint: "영역 전체 칠하기" },
  { id: "fill", name: "채우기", hint: "이어진 같은 칸 한번에" },
  { id: "pick", name: "선택", hint: "범위 드래그 선택 · 장비 ID · 메모" },
];

export const ZOOM_STEPS = [14, 18, 22, 26, 32];
const HISTORY_LIMIT = 60;

interface History {
  past: ProjectDoc[];
  project: ProjectDoc;
  future: ProjectDoc[];
}

export interface EditorState {
  project: ProjectDoc;
  activePageDoc: PageDoc;
  doc: LayoutDoc;
  tool: ToolId;
  activeId: PaletteId;
  /** 고른 팔레트 항목. 항목이 지워졌으면 null. */
  activeItem: PaletteItem | null;
  activeLayer: LayerId;
  visible: Record<LayerId, boolean>;
  showGrid: boolean;
  cell: number;
  selectedKey: string | null;
  /** 메모 편집 상자를 열어 둔 칸. 없으면 null. */
  noteKey: string | null;
  selectionRange: CellRange | null;
  clipboard: ClipboardData | null;
  hover: Point | null;
  preview: Point[];
  canUndo: boolean;
  canRedo: boolean;
  savedAt: string | null;
}

/**
 * 되돌리기·다시 실행은 칸과 페이지 구성만 오간다. 어느 페이지를 보고 있었는지는
 * 이력에 넣지 않으므로, 복원한 프로젝트에 그 페이지가 남아 있으면 그대로 머문다.
 */
function keepViewedPage(restored: ProjectDoc, viewedPageId: string): ProjectDoc {
  if (!restored.pages.some((page) => page.id === viewedPageId)) return restored;
  if (restored.activePageId === viewedPageId) return restored;
  return { ...restored, activePageId: viewedPageId };
}

/** 고른 항목이 사라졌을 때 대신 고를 항목. */
function fallbackItem(palette: PaletteItem[], role: PaletteRole): PaletteItem | null {
  return itemsOfRole(palette, role)[0] ?? palette.find((item) => !item.retired) ?? null;
}

export function useEditor() {
  // 초기 상태는 서버·클라이언트가 같아야 한다. localStorage 는 서버 렌더에 없으므로
  // 여기서 읽지 않고 마운트 후 한 번만 동기화한다. (초기값으로 읽으면 hydration 이 깨진다.)
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    project: createSampleProject(),
    future: [],
  }));
  const [tool, setTool] = useState<ToolId>("brush");
  const [activeId, setActiveId] = useState<PaletteId>("installed");
  const [activeLayer, setActiveLayer] = useState<LayerId>("equipment");
  const [visible, setVisible] = useState<Record<LayerId, boolean>>({
    background: true,
    equipment: true,
    wiring: true,
  });
  const [showGrid, setShowGrid] = useState(true);
  const [cell, setCell] = useState(22);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<CellRange | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [preview, setPreview] = useState<Point[]>([]);
  // 서버 렌더에 시각을 넣으면 hydration 때 값이 달라진다. 실제로 저장한 뒤에만 채운다.
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const project = history.project;
  const activePageDoc = useMemo(() => activePage(project), [project]);
  const doc = useMemo(() => activeLayoutDoc(project), [project]);

  const dragStart = useRef<Point | null>(null);
  const dragging = useRef(false);
  /** 마운트 후 localStorage 를 읽었는지. 첫 렌더 내용을 저장소에 덮어쓰지 않으려는 표시. */
  const restored = useRef(false);

  const activeItem = useMemo(
    () => project.palette.find((item) => item.id === activeId) ?? null,
    [activeId, project.palette],
  );

  /** 되돌리기 지점을 남기고 프로젝트를 바꾼다. */
  const applyEdit = useCallback((updater: (current: ProjectDoc) => ProjectDoc) => {
    setHistory((current) => {
      const next = updater(current.project);
      if (next === current.project) return current;
      return {
        past: [...current.past, current.project].slice(-HISTORY_LIMIT),
        project: next,
        future: [],
      };
    });
  }, []);

  /** 진행 중인 드래그 — 되돌리기 지점을 새로 만들지 않는다. */
  const applyLive = useCallback((updater: (current: ProjectDoc) => ProjectDoc) => {
    setHistory((current) => {
      const next = updater(current.project);
      if (next === current.project) return current;
      return { ...current, project: next };
    });
  }, []);

  // 저장된 작업 복원 — 마운트 후 1회. 이전 v1 단일 문서 키도 함께 살펴본다.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const loaded = loadLocal();
    if (!loaded) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소에서 1회 동기화
    setHistory({ past: [], project: loaded.project, future: [] });

    // 이전 키에서 이관했다면 새 키에 바로 한 번 남긴다. 다음 편집까지 기다리지 않는다.
    if (loaded.fromLegacy) saveLocal(loaded.project);
  }, []);

  // 자동 저장 — 드래그 중에는 프로젝트가 매 이동마다 바뀌므로 400ms 모아서 한 번만 쓴다.
  useEffect(() => {
    if (!restored.current) return;
    const timer = window.setTimeout(() => {
      saveLocal(project);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [project]);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        project: keepViewedPage(previous, current.project.activePageId),
        future: [current.project, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
    setSelectedKey(null);
    setSelectionRange(null);
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) return current;
      return {
        past: [...current.past, current.project].slice(-HISTORY_LIMIT),
        project: keepViewedPage(current.future[0], current.project.activePageId),
        future: current.future.slice(1),
      };
    });
    setSelectedKey(null);
    setSelectionRange(null);
  }, []);

  const selectPalette = useCallback(
    (id: PaletteId) => {
      const item = project.palette.find((entry) => entry.id === id);
      if (!item) return;
      setActiveId(id);
      // 지우개·채우기는 activeLayer 를 보고 대상을 정한다. 고른 항목의 레이어로 맞춰 둔다.
      setActiveLayer(item.layer);
      setTool((current) => (current === "pick" || current === "eraser" ? "brush" : current));
    },
    [project.palette],
  );

  /** 도형 미리보기 좌표 계산. */
  const pointsFor = useCallback(
    (targetDoc: LayoutDoc, from: Point, to: Point): Point[] => {
      if (tool === "line") return linePoints(from, to);
      if (tool === "rect") return rectOutlinePoints(from, to);
      if (tool === "rectFill") return rectFillPoints(from, to);
      return [];
    },
    [tool],
  );

  /** 활성 페이지에 포인트 칠하기/지우기 */
  const writePointsOnPage = useCallback(
    (currentProject: ProjectDoc, points: Point[]): ProjectDoc => {
      return updateActivePage(currentProject, (page) => {
        if (tool === "eraser") return eraseCellsOnPage(page, activeLayer, points);
        if (!activeItem) return page;
        return paintCellsOnPage(page, activeItem, points);
      });
    },
    [activeItem, activeLayer, tool],
  );

  const beginStroke = useCallback(
    (p: Point) => {
      // 도면을 누르면 열려 있던 메모 상자를 닫는다.
      setNoteKey(null);

      if (tool === "pick") {
        dragging.current = true;
        dragStart.current = p;
        const range = normalizeRange(p, p, doc);
        setSelectionRange(range);
        setSelectedKey(cellKey(p.x, p.y));
        return;
      }

      dragging.current = true;
      dragStart.current = p;

      if (tool === "brush" || tool === "eraser") {
        applyEdit((current) => writePointsOnPage(current, [p]));
      } else if (tool === "fill") {
        applyEdit((current) => updateActivePage(current, (page) => {
          const pageView: LayoutDoc = { ...doc, background: page.background, equipment: page.equipment, wiring: page.wiring };
          const fillPts = floodFillPoints(pageView, activeLayer, p);
          if (!activeItem) return page;
          return paintCellsOnPage(page, activeItem, fillPts);
        }));
      } else {
        setPreview([p]);
      }
    },
    [activeItem, activeLayer, applyEdit, doc, tool, writePointsOnPage],
  );

  const moveStroke = useCallback(
    (p: Point) => {
      setHover(p);
      if (!dragging.current || !dragStart.current) return;

      if (tool === "pick") {
        const range = normalizeRange(dragStart.current, p, doc);
        setSelectionRange(range);
        setSelectedKey(cellKey(range.minX, range.minY));
        return;
      }

      if (tool === "brush" || tool === "eraser") {
        const from = dragStart.current;
        dragStart.current = p;
        applyLive((current) => writePointsOnPage(current, linePoints(from, p)));
        return;
      }

      if (tool === "line" || tool === "rect" || tool === "rectFill") {
        setPreview(pointsFor(doc, dragStart.current, p));
      }
    },
    [applyLive, doc, pointsFor, tool, writePointsOnPage],
  );

  const endStroke = useCallback(
    (p: Point | null) => {
      if (!dragging.current) return;

      const from = dragStart.current;
      dragging.current = false;
      dragStart.current = null;

      if (tool === "pick") {
        if (from && p) {
          const range = normalizeRange(from, p, doc);
          setSelectionRange(range);
          setSelectedKey(cellKey(range.minX, range.minY));
        }
        return;
      }

      if ((tool === "line" || tool === "rect" || tool === "rectFill") && from && p) {
        applyEdit((current) => writePointsOnPage(current, pointsFor(doc, from, p)));
      }

      setPreview([]);
    },
    [applyEdit, doc, pointsFor, tool, writePointsOnPage],
  );

  const copy = useCallback(() => {
    if (!selectionRange) return;
    setClipboard(copyRange(doc, selectionRange));
  }, [doc, selectionRange]);

  const cut = useCallback(() => {
    if (!selectionRange) return;
    const { nextDoc, data } = cutRange(doc, selectionRange);
    applyEdit((current) => updateActivePage(current, (page) => ({
      ...page,
      background: nextDoc.background,
      equipment: nextDoc.equipment,
      wiring: nextDoc.wiring,
    })));
    setClipboard(data);
  }, [applyEdit, doc, selectionRange]);

  const paste = useCallback(() => {
    if (!clipboard) return;
    const origin = selectionRange
      ? { x: selectionRange.minX, y: selectionRange.minY }
      : selectedKey
        ? parseCellKey(selectedKey)
        : { x: 0, y: 0 };

    const { nextDoc, pastedRange } = pasteClipboard(doc, clipboard, origin);
    applyEdit((current) => updateActivePage(current, (page) => ({
      ...page,
      background: nextDoc.background,
      equipment: nextDoc.equipment,
      wiring: nextDoc.wiring,
    })));
    setSelectionRange(pastedRange);
    setSelectedKey(cellKey(pastedRange.minX, pastedRange.minY));
    setTool("pick");
  }, [applyEdit, clipboard, doc, selectedKey, selectionRange]);

  /** 칸 우클릭 — 그 자리에서 메모를 고치게 한다. 도구는 바꾸지 않는다. */
  const openNote = useCallback((p: Point) => {
    setNoteKey(cellKey(p.x, p.y));
  }, []);

  const closeNote = useCallback(() => setNoteKey(null), []);

  /** 장비 ID 와 메모를 함께 바꾼다. 같은 칸의 상태·장비는 건드리지 않는다. */
  const saveNote = useCallback(
    (key: string, value: { label: string; memo: string }) => {
      applyEdit((current) =>
        updateActivePage(current, (page) =>
          updateEquipmentInfoOnPage(page, key, { label: value.label.trim(), memo: value.memo }),
        ),
      );
      setNoteKey(null);
    },
    [applyEdit],
  );

  const setInfo = useCallback(
    (key: string, patch: { label?: string; memo?: string }) => {
      applyEdit((current) => updateActivePage(current, (page) => updateEquipmentInfoOnPage(page, key, patch)));
    },
    [applyEdit],
  );

  const setTitle = useCallback(
    (title: string) => {
      applyLive((current) => ({ ...current, title }));
    },
    [applyLive],
  );

  /** 활성 페이지의 인쇄 용지 설정. null 이면 경계선을 끈다. */
  const setPaper = useCallback(
    (paper: PagePaper | null) => {
      applyEdit((current) =>
        updateActivePage(current, (page) => {
          if (!paper) {
            if (!page.paper) return page;
            const next = { ...page };
            delete next.paper;
            return next;
          }
          return { ...page, paper };
        }),
      );
    },
    [applyEdit],
  );

  const setSize = useCallback(
    (cols: number, rows: number) => {
      applyEdit((current) => updateActivePage(current, (page) => resizePage(page, cols, rows)));
    },
    [applyEdit],
  );

  const replaceProject = useCallback(
    (next: ProjectDoc) => {
      applyEdit(() => next);
      setSelectedKey(null);
      setSelectionRange(null);
      if (!next.palette.some((item) => item.id === activeId && !item.retired)) {
        const item = fallbackItem(next.palette, "status");
        setActiveId(item ? item.id : "");
        if (item) setActiveLayer(item.layer);
      }
    },
    [activeId, applyEdit],
  );

  const resetAll = useCallback(() => {
    // 페이지 구성·이름·크기와 팔레트는 남기고 칸만 비운다.
    applyEdit((current) => ({
      ...current,
      pages: current.pages.map((page) => createPage(page.id, page.name, page.cols, page.rows)),
    }));
    // 이전 v1 키까지 지워 옛 데이터가 되살아나지 않게 한다.
    // 비워진 프로젝트 자체는 곧이어 자동 저장이 새 키에 기록한다.
    clearLocal();
    setSelectedKey(null);
    setSelectionRange(null);
    setSavedAt(null);
  }, [applyEdit]);

  const loadSample = useCallback(() => {
    applyEdit((current) => {
      const sample = createSampleProject();
      return { ...sample, palette: withUserItems(sample.palette, current.palette) };
    });
    setSelectedKey(null);
    setSelectionRange(null);
  }, [applyEdit]);

  // 페이지 관리 액션
  const addPage = useCallback(
    (name?: string) => {
      applyEdit((current) => addPageToProject(current, name));
      setSelectedKey(null);
      setSelectionRange(null);
    },
    [applyEdit],
  );

  const renamePage = useCallback(
    (pageId: string, newName: string) => {
      applyEdit((current) => renamePageInProject(current, pageId, newName));
    },
    [applyEdit],
  );

  const deletePage = useCallback(
    (pageId: string) => {
      applyEdit((current) => deletePageFromProject(current, pageId));
      setSelectedKey(null);
      setSelectionRange(null);
    },
    [applyEdit],
  );

  // 페이지 전환은 내용을 바꾸지 않으므로 되돌리기 지점을 만들지 않는다.
  // (페이지 추가·이름변경·삭제는 내용 변경이므로 이력에 남는다.)
  const switchPage = useCallback(
    (pageId: string) => {
      applyLive((current) => switchActivePage(current, pageId));
      setSelectedKey(null);
      setSelectionRange(null);
    },
    [applyLive],
  );

  /** 팔레트 항목 추가 */
  const addPaletteItem = useCallback(
    (role: PaletteRole, input: PaletteInput): string | null => {
      const error = validateInput(project.palette, role, input);
      if (error) return error;

      const { palette, created } = addPaletteEntry(project.palette, role, input);
      applyEdit((current) => ({ ...current, palette }));
      setActiveId(created.id);
      setActiveLayer(created.layer);
      setTool((current) => (current === "pick" || current === "eraser" ? "brush" : current));
      return null;
    },
    [applyEdit, project.palette],
  );

  const updatePaletteItem = useCallback(
    (id: PaletteId, input: PaletteInput): string | null => {
      const item = project.palette.find((entry) => entry.id === id);
      if (!item) return "이미 지워진 항목이다.";

      const error = validateInput(project.palette, item.role, input, id);
      if (error) return error;

      applyEdit((current) => ({ ...current, palette: updatePaletteEntry(current.palette, id, input) }));
      return null;
    },
    [applyEdit, project.palette],
  );

  const deletePaletteItem = useCallback(
    (id: PaletteId, mode: DeleteMode) => {
      const item = project.palette.find((entry) => entry.id === id);
      if (!item) return;

      // 사용 여부·칸 비우기 모두 프로젝트의 모든 페이지를 대상으로 한다.
      const nextProject = deleteItemInProject(project, id, mode);
      applyEdit(() => nextProject);

      if (activeId === id) {
        const replacement = fallbackItem(nextProject.palette, item.role);
        setActiveId(replacement ? replacement.id : "");
        if (replacement) setActiveLayer(replacement.layer);
      }
    },
    [activeId, applyEdit, project],
  );

  const toggleLayer = useCallback((layer: LayerId) => {
    setVisible((current) => ({ ...current, [layer]: !current[layer] }));
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setCell((current) => {
      const index = ZOOM_STEPS.indexOf(current);
      const nextIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index < 0 ? 2 : index) + delta));
      return ZOOM_STEPS[nextIndex];
    });
  }, []);

  // 키보드 보조: Ctrl+Z 되돌리기, Ctrl+Y 다시 실행, Ctrl+C / Ctrl+X / Ctrl+V 클립보드
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copy();
      } else if (key === "x") {
        event.preventDefault();
        cut();
      } else if (key === "v") {
        event.preventDefault();
        paste();
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copy, cut, paste, redo, undo]);

  const state: EditorState = useMemo(
    () => ({
      project,
      activePageDoc,
      doc,
      tool,
      activeId,
      activeItem,
      activeLayer,
      visible,
      showGrid,
      cell,
      selectedKey,
      noteKey,
      selectionRange,
      clipboard,
      hover,
      preview,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      savedAt,
    }),
    [
      activeId,
      activeItem,
      activeLayer,
      activePageDoc,
      cell,
      clipboard,
      doc,
      history.future.length,
      history.past.length,
      hover,
      noteKey,
      preview,
      project,
      savedAt,
      selectedKey,
      selectionRange,
      showGrid,
      tool,
      visible,
    ],
  );

  return {
    state,
    actions: {
      beginStroke,
      moveStroke,
      endStroke,
      setHover,
      setTool,
      selectPalette,
      setActiveLayer,
      toggleLayer,
      setShowGrid,
      zoomBy,
      undo,
      redo,
      copy,
      cut,
      paste,
      setInfo,
      setTitle,
      setSize,
      setPaper,
      replaceProject,
      resetAll,
      loadSample,
      setSelectedKey,
      setSelectionRange,
      openNote,
      closeNote,
      saveNote,
      addPage,
      renamePage,
      deletePage,
      switchPage,
      addPaletteItem,
      updatePaletteItem,
      deletePaletteItem,
    },
  };
}

