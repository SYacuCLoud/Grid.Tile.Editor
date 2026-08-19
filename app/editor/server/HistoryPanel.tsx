"use client";

import { formatStamp } from "./api";
import type { ServerProjectsActions, ServerProjectsState } from "./useServerProjects";

const BUTTON =
  "h-6 shrink-0 border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";

interface HistoryPanelProps {
  state: ServerProjectsState;
  actions: ServerProjectsActions;
}

/** 저장 시점 타임라인. 한 줄이 스냅샷 하나이고, 거기서 바로 되돌릴 수 있다. */
export function HistoryPanel({ state, actions }: HistoryPanelProps) {
  if (!state.history) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[70vh] w-[520px] max-w-full flex-col border border-slate-400 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <p className="text-[12px] font-semibold text-slate-800">
            버전 이력 — {state.currentId} (지금 r{state.baseRevision})
          </p>
          <button type="button" className={BUTTON} onClick={actions.closeHistory}>
            닫기
          </button>
        </div>

        {state.history.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-slate-500">아직 저장된 이력이 없습니다.</p>
        ) : (
          <ul className="flex flex-col overflow-auto">
            {state.history.map((entry) => (
              <li
                key={entry.revision}
                className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[12px]"
              >
                <span className="w-12 shrink-0 font-semibold text-slate-800">r{entry.revision}</span>
                <span className="w-32 shrink-0 text-slate-600">{formatStamp(entry.savedAt)}</span>
                <span className="w-24 shrink-0 truncate text-slate-600">{entry.author}</span>
                <span className="flex-1 truncate text-slate-500">
                  {entry.title} · {entry.pages}페이지
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={state.busy || entry.revision === state.baseRevision}
                  onClick={() => {
                    if (window.confirm(`r${entry.revision} 내용으로 되돌립니다. 계속하시겠습니까?`)) {
                      void actions.restore(entry.revision);
                    }
                  }}
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
          되돌리기는 이력을 지우지 않습니다. 고른 내용을 새 리비전으로 다시 저장합니다.
        </p>
      </div>
    </div>
  );
}
