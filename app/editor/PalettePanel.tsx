"use client";

import { useState } from "react";
import type { ProjectDoc } from "./doc";
import {
  itemsOfRole,
  LAYERS,
  type LayerId,
  NEW_ITEM_COLOR,
  type PaletteId,
  type PaletteRole,
  rolesOfLayer,
} from "./palette";
import { type DeleteMode, type PaletteInput, usageCountInProject } from "./paletteOps";
import { PaletteDeleteConfirm } from "./PaletteDeleteConfirm";
import { PaletteItemForm } from "./PaletteItemForm";
import { PaletteSwatch } from "./PaletteSwatch";

const MINI_BUTTON =
  "h-6 shrink-0 border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900";
const ADD_BUTTON =
  "h-6 shrink-0 border border-slate-400 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-100";

type Mode =
  | { kind: "add"; role: PaletteRole }
  | { kind: "edit"; id: PaletteId }
  | { kind: "delete"; id: PaletteId }
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
  onAddItem: (role: PaletteRole, input: PaletteInput) => string | null;
  onUpdateItem: (id: PaletteId, input: PaletteInput) => string | null;
  onDeleteItem: (id: PaletteId, mode: DeleteMode) => void;
}

export function PalettePanel(props: PalettePanelProps) {
  const [mode, setMode] = useState<Mode>(null);
  const close = () => setMode(null);

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-300 bg-slate-50 p-3">
      {LAYERS.map((layer) => (
        <section key={layer.id}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => props.onFocusLayer(layer.id)}
              className={`text-left text-[12px] font-semibold ${
                props.activeLayer === layer.id ? "text-slate-900" : "text-slate-500"
              }`}
              title="이 레이어를 편집 대상으로"
            >
              {layer.name}
              <span className="ml-1 font-normal text-slate-400">{layer.hint}</span>
            </button>
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={props.visible[layer.id]}
                onChange={() => props.onToggleLayer(layer.id)}
                aria-label={`${layer.name} 레이어 표시`}
              />
              표시
            </label>
          </div>

          {rolesOfLayer(layer.id).map((role) => (
            <div key={role.id} className="mb-2">
              <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-200 pb-0.5">
                <span className="text-[11px] font-semibold text-slate-600" title={role.hint}>
                  {role.name}
                </span>
                {role.editable ? (
                  <button
                    type="button"
                    className={ADD_BUTTON}
                    onClick={() => setMode({ kind: "add", role: role.id })}
                    title={`${role.name} 항목을 새로 만든다`}
                  >
                    {role.addLabel}
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400">고정</span>
                )}
              </div>

              {mode?.kind === "add" && mode.role === role.id ? (
                <div className="mb-1">
                  <PaletteItemForm
                    title={`${role.name} 추가`}
                    initialName=""
                    initialColor={NEW_ITEM_COLOR}
                    initialDescription=""
                    submitLabel="추가"
                    onSubmit={(input) => {
                      const error = props.onAddItem(role.id, input);
                      if (!error) close();
                      return error;
                    }}
                    onCancel={close}
                  />
                </div>
              ) : null}

              <ul className="flex flex-col gap-1">
                {itemsOfRole(props.project.palette, role.id).map((item) => (
                  <li key={item.id}>
                    {mode?.kind === "edit" && mode.id === item.id ? (
                      <PaletteItemForm
                        title={`${role.name} 편집`}
                        initialName={item.name}
                        initialColor={item.color ?? NEW_ITEM_COLOR}
                        initialDescription={item.description ?? ""}
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

                        {role.editable ? (
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

              {itemsOfRole(props.project.palette, role.id).length === 0 ? (
                <p className="py-1 text-[11px] text-slate-400">
                  항목이 없다. {role.editable ? `위의 '${role.name} 추가' 로 만든다.` : ""}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ))}

      <p className="mt-auto border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-500">
        상태는 칸을 그 색으로 칠하고, 장비는 같은 칸에 이름을 올리며 그 색을 테두리로 두른다. 배선은 고른 색으로 선을 잇는다.
        <br />
        추가·수정한 항목은 도면과 함께 자동 저장되고 JSON 에도 담긴다.
      </p>
    </aside>
  );
}
