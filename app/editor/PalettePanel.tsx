"use client";

import { useEffect, useState } from "react";
import { layerCellCount, type ProjectDoc } from "./doc";
import { LayerAddForm, LayerRow } from "./LayerControls";
import { type LayerInput, layerSections, MAX_LAYERS } from "./layers";
import { itemsOfSection, type LayerId, NEW_ITEM_COLOR, type PaletteId, type PaletteRole } from "./palette";
import { type DeleteMode, type PaletteInput, usageCountInProject } from "./paletteOps";
import { type CollapseKey, expandCollapsed, isCollapsed, loadCollapsed, saveCollapsed, toggleCollapsed } from "./paletteCollapse";
import { PaletteDeleteConfirm } from "./PaletteDeleteConfirm";
import { PaletteItemForm } from "./PaletteItemForm";
import { PaletteSwatch } from "./PaletteSwatch";

const MINI_BUTTON =
  "h-6 shrink-0 border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900";
const ADD_BUTTON =
  "h-6 shrink-0 border border-slate-400 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-100";

type Mode =
  | { kind: "add"; section: CollapseKey; role: PaletteRole; layerId: string }
  | { kind: "edit"; id: PaletteId }
  | { kind: "delete"; id: PaletteId }
  | { kind: "addLayer" }
  | null;

interface PalettePanelProps {
  /** 팔레트는 프로젝트 공용이다. 사용량도 모든 페이지를 합쳐 센다. */
  project: ProjectDoc;
  activeId: PaletteId;
  activeLayer: LayerId;
  visible: Record<LayerId, boolean>;
  onSelect: (id: PaletteId) => void;
  onToggleLayer: (layer: LayerId) => void;
  onFocusLayer: (layer: LayerId) => void;
  onToggleLayerLock: (layer: LayerId) => void;
  onAddLayer: (input: LayerInput) => string | null;
  onRenameLayer: (layer: LayerId, name: string) => string | null;
  onMoveLayer: (layer: LayerId, delta: number) => void;
  onClearLayer: (layer: LayerId) => void;
  onDeleteLayer: (layer: LayerId) => void;
  onAddItem: (role: PaletteRole, input: PaletteInput, layerId?: string) => string | null;
  onUpdateItem: (id: PaletteId, input: PaletteInput) => string | null;
  onDeleteItem: (id: PaletteId, mode: DeleteMode) => void;
}

export function PalettePanel(props: PalettePanelProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [collapsed, setCollapsed] = useState<CollapseKey[]>([]);
  const close = () => setMode(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소에서 1회 동기화
    setCollapsed(loadCollapsed());
  }, []);

  const applyCollapsed = (next: CollapseKey[]) => {
    setCollapsed(next);
    saveCollapsed(next);
  };

  // 접힌 분류에서 '추가' 를 누르면 입력 칸이 보이도록 함께 펼친다.
  const startAdd = (section: CollapseKey, role: PaletteRole, layerId: string) => {
    applyCollapsed(expandCollapsed(collapsed, section));
    setMode({ kind: "add", section, role, layerId });
  };

  // 위에 얹히는 레이어를 위에 보여 준다. 그리는 순서(앞이 아래)와 목록 순서가
  // 뒤집혀 있으면 '위로' 를 눌렀을 때 목록에서 아래로 내려가 보인다.
  const layers = [...props.project.layers].reverse();
  const full = props.project.layers.length >= MAX_LAYERS;

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-300 bg-slate-50 p-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-300 pb-1">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500">
            레이어 <span className="font-normal text-slate-400">({props.project.layers.length})</span>
          </span>
          <button
            type="button"
            className={ADD_BUTTON}
            onClick={() => setMode(mode?.kind === "addLayer" ? null : { kind: "addLayer" })}
            disabled={full}
            title={full ? `레이어는 ${MAX_LAYERS}개까지 만들 수 있다` : "새 레이어를 만든다"}
            aria-expanded={mode?.kind === "addLayer"}
          >
            + 레이어 추가
          </button>
        </div>
        {mode?.kind === "addLayer" ? <LayerAddForm onSubmit={props.onAddLayer} onCancel={close} /> : null}
      </div>

      {layers.map((layer, indexFromTop) => (
        <section key={layer.id}>
          <LayerRow
            layer={layer}
            active={props.activeLayer === layer.id}
            cellCount={layerCellCount(props.project, layer.id)}
            canMoveUp={indexFromTop > 0}
            canMoveDown={indexFromTop < layers.length - 1}
            onFocus={() => props.onFocusLayer(layer.id)}
            onToggleVisible={() => props.onToggleLayer(layer.id)}
            onToggleLock={() => props.onToggleLayerLock(layer.id)}
            onRename={(name) => props.onRenameLayer(layer.id, name)}
            onMove={(delta) => props.onMoveLayer(layer.id, delta)}
            onClear={() => props.onClearLayer(layer.id)}
            onDelete={() => props.onDeleteLayer(layer.id)}
          />

          {layerSections(layer).map((section) => {
            const items = itemsOfSection(props.project.palette, section.layerId, section.role);
            const folded = isCollapsed(collapsed, section.key);
            const activeItem = items.find((item) => item.id === props.activeId) ?? null;

            return (
              <div key={section.key} className="mb-2">
                <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-200 pb-0.5">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 text-left text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                    onClick={() => applyCollapsed(toggleCollapsed(collapsed, section.key))}
                    aria-expanded={!folded}
                    title={`${section.hint} — 눌러서 ${folded ? "펼치기" : "접기"}`}
                  >
                    <span className="w-3 shrink-0 text-slate-400">{folded ? "▶" : "▼"}</span>
                    <span className="truncate">{section.name}</span>
                    <span className="font-normal text-slate-400">({items.length})</span>
                  </button>
                  {section.editable ? (
                    <button
                      type="button"
                      className={ADD_BUTTON}
                      onClick={() => startAdd(section.key, section.role, section.layerId)}
                      title={`${section.name} 항목을 새로 만든다`}
                    >
                      {section.addLabel}
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">고정</span>
                  )}
                </div>

                {/* 접어 두어도 지금 고른 항목은 보여 준다. 무엇으로 칠하는 중인지 놓치지 않게. */}
                {folded && activeItem ? (
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center gap-2 border border-slate-800 bg-white px-1 py-1 text-left text-[12px] font-semibold text-slate-900"
                    onClick={() => applyCollapsed(expandCollapsed(collapsed, section.key))}
                    title="눌러서 이 분류를 펼친다"
                  >
                    <PaletteSwatch item={activeItem} size={16} />
                    <span className="truncate">{activeItem.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] font-normal text-slate-400">선택됨</span>
                  </button>
                ) : null}

                {!folded && mode?.kind === "add" && mode.section === section.key ? (
                  <div className="mb-1">
                    <PaletteItemForm
                      title={`${section.name} 추가`}
                      role={section.role}
                      initialName=""
                      initialColor={NEW_ITEM_COLOR}
                      initialDescription=""
                      submitLabel="추가"
                      onSubmit={(input) => {
                        const error = props.onAddItem(section.role, input, section.layerId);
                        if (!error) close();
                        return error;
                      }}
                      onCancel={close}
                    />
                  </div>
                ) : null}

                <ul className={`flex flex-col gap-1 ${folded ? "hidden" : ""}`}>
                  {items.map((item) => (
                    <li key={item.id}>
                      {mode?.kind === "edit" && mode.id === item.id ? (
                        <PaletteItemForm
                          title={`${section.name} 편집`}
                          role={section.role}
                          initialName={item.name}
                          initialColor={item.color ?? NEW_ITEM_COLOR}
                          initialDescription={item.description ?? ""}
                          initialPattern={item.pattern}
                          initialLineStyle={item.lineStyle}
                          submitLabel="저장"
                          onSubmit={(input) => {
                            const error = props.onUpdateItem(item.id, input);
                            if (!error) close();
                            return error;
                          }}
                          onCancel={close}
                        />
                      ) : mode?.kind === "delete" && mode.id === item.id ? (
                        <PaletteDeleteConfirm
                          item={item}
                          usage={usageCountInProject(props.project, item)}
                          onConfirm={(deleteMode) => {
                            props.onDeleteItem(item.id, deleteMode);
                            close();
                          }}
                          onCancel={close}
                        />
                      ) : (
                        <div
                          className={`flex items-center gap-1 border px-1 py-1 ${
                            props.activeId === item.id ? "border-slate-800 bg-white" : "border-slate-200 bg-white"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => props.onSelect(item.id)}
                            className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] ${
                              props.activeId === item.id ? "font-semibold text-slate-900" : "text-slate-700"
                            }`}
                            title={item.description ? `${item.name} — ${item.description}` : "이 항목으로 칠하기"}
                          >
                            <PaletteSwatch item={item} />
                            <span className="truncate">{item.name}</span>
                          </button>

                          {section.editable ? (
                            <>
                              <button
                                type="button"
                                className={MINI_BUTTON}
                                onClick={() => setMode({ kind: "edit", id: item.id })}
                                title="이름 · 색 고치기"
                              >
                                편집
                              </button>
                              <button
                                type="button"
                                className={MINI_BUTTON}
                                onClick={() => setMode({ kind: "delete", id: item.id })}
                                title="이 항목 삭제"
                              >
                                삭제
                              </button>
                            </>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {!folded && items.length === 0 ? (
                  <p className="py-1 text-[11px] text-slate-400">항목 없음</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
