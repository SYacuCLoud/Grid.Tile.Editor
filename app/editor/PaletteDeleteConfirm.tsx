"use client";

import type { PaletteItem } from "./palette";
import type { DeleteMode } from "./paletteOps";

const DANGER_BUTTON = "h-7 w-full border border-red-300 bg-white text-[12px] text-red-700 hover:bg-red-50";
const CANCEL_BUTTON = "h-7 w-full border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100";

interface PaletteDeleteConfirmProps {
  item: PaletteItem;
  /** 이 항목이 쓰인 칸 수. */
  usage: number;
  onConfirm: (mode: DeleteMode) => void;
  onCancel: () => void;
}

/**
 * 삭제 확인. 쓰이지 않은 항목은 바로 지우고,
 * 쓰이고 있으면 배치된 칸을 남길지 함께 지울지 고르게 한다.
 */
export function PaletteDeleteConfirm(props: PaletteDeleteConfirmProps) {
  const { item, usage } = props;

  return (
    <div className="border border-red-300 bg-red-50 p-2">
      <p className="text-[12px] font-semibold text-slate-900">
        &lsquo;{item.name}&rsquo; 삭제
      </p>

      {usage === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-700">쓰이지 않은 항목이다. 목록에서 지운다.</p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-700">
          도면 {usage}칸에서 쓰이고 있다. 배치된 칸을 어떻게 할지 고른다.
        </p>
      )}

      <div className="mt-2 flex flex-col gap-1">
        {usage === 0 ? (
          <button type="button" className={DANGER_BUTTON} onClick={() => props.onConfirm("keepCells")}>
            삭제
          </button>
        ) : (
          <>
            <button type="button" className={CANCEL_BUTTON} onClick={() => props.onConfirm("keepCells")}>
              칸은 그대로 두고 목록에서만 삭제
            </button>
            <button type="button" className={DANGER_BUTTON} onClick={() => props.onConfirm("purgeCells")}>
              배치된 {usage}칸까지 함께 삭제
            </button>
          </>
        )}
        <button type="button" className={CANCEL_BUTTON} onClick={props.onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
