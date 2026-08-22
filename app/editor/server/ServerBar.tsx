"use client";

import { formatStamp } from "./api";
import type { ServerProjectsActions, ServerProjectsState } from "./useServerProjects";

const BUTTON =
  "h-7 shrink-0 border border-slate-300 bg-white px-2 text-[12px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";
const PRIMARY =
  "h-7 shrink-0 border border-slate-800 bg-slate-800 px-2 text-[12px] text-white hover:bg-slate-700 disabled:opacity-40";
const FIELD = "h-7 border border-slate-300 bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-600";

interface ServerBarProps {
  state: ServerProjectsState;
  actions: ServerProjectsActions;
}

/**
 * 서버 도면 줄 — 열기 · 저장 · 이력 · 작성자.
 *
 * 서버에 닿지 못해도 줄은 남기고 이유와 `다시 연결` 을 보여 준다. 통째로 감추면
 * 사용자는 "메뉴가 사라졌다" 고만 느끼고 무엇을 해야 하는지 알 수 없다.
 *
 * 도면을 저장하는 곳은 서버 한 곳이므로, 닿지 못하는 동안 한 작업은 `JSON 내보내기`
 * 로 손에 들고 있어야 한다. 그 말을 여기서 분명히 해 둔다.
 */
export function ServerBar({ state, actions }: ServerBarProps) {
  // 아직 확인 중이면 자리만 잡아 둔다. 곧바로 그렸다 지우면 화면이 튄다.
  if (state.available === null) return null;

  // 닿지 못했을 때도 줄은 남긴다. 무엇이 잘못됐고 무엇을 하면 되는지 보여야 한다.
  if (state.available === false) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-amber-50 px-2 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-amber-900">서버 도면</span>
        <span className="text-[11px] text-amber-900">
          {state.offlineReason ?? "서버에 닿지 못했습니다."}
        </span>
        <button type="button" className={BUTTON} disabled={state.busy} onClick={() => void actions.refresh()}>
          다시 연결
        </button>
        <span className="text-[11px] text-amber-700">
          연결되기 전까지 한 작업은 저장되지 않습니다. `JSON 내보내기` 로 남겨 두십시오.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-slate-500">서버 도면</span>

      <select
        className={`${FIELD} min-w-40`}
        value={state.currentId ?? ""}
        disabled={state.busy}
        onChange={(event) => {
          const id = event.target.value;
          if (id) void actions.open(id);
        }}
        aria-label="서버 도면 열기"
      >
        <option value="">{state.projects.length > 0 ? "도면 고르기…" : "저장된 도면 없음"}</option>
        {state.projects.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.title} · r{entry.revision}
            {entry.author ? ` · ${entry.author}` : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={BUTTON}
        disabled={state.busy}
        onClick={() => {
          const title = window.prompt("새 도면 이름", "새 배치도");
          if (title) void actions.createNew(title);
        }}
      >
        새 도면
      </button>

      <button type="button" className={PRIMARY} disabled={state.busy || !state.currentId} onClick={() => void actions.save()}>
        서버 저장
      </button>

      <button type="button" className={BUTTON} disabled={state.busy || !state.currentId} onClick={() => void actions.openHistory()}>
        버전 이력
      </button>

      <label className="ml-1 flex items-center gap-1 text-[11px] text-slate-500">
        작성자
        <input
          className={`${FIELD} w-24`}
          value={state.author}
          maxLength={24}
          onChange={(event) => actions.setAuthor(event.target.value)}
          aria-label="작성자 이름"
        />
      </label>

      {state.currentId ? (
        <span className="text-[11px] text-slate-500">
          {state.currentId} · r{state.baseRevision}
        </span>
      ) : null}

      {state.status ? <span className="text-[11px] text-slate-600">{state.status}</span> : null}

      {state.conflict ? (
        <div className="flex w-full items-center gap-1.5 border border-amber-400 bg-amber-50 px-2 py-1">
          <span className="text-[11px] text-amber-900">
            {state.conflict.message} (서버 r{state.conflict.revision} ·{" "}
            {formatStamp(state.conflict.savedAt)})
          </span>
          <button type="button" className={BUTTON} disabled={state.busy} onClick={() => void actions.save("overwrite")}>
            덮어쓰기
          </button>
          <button type="button" className={BUTTON} disabled={state.busy} onClick={() => void actions.save("copy")}>
            사본으로 저장
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={state.busy}
            onClick={() => {
              if (state.currentId) void actions.open(state.currentId);
            }}
          >
            서버 것 열기
          </button>
          <button type="button" className={BUTTON} onClick={actions.dismissConflict}>
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}
