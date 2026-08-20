"use client";

import { useState } from "react";

import {
  LAYER_HINT_MAX,
  LAYER_NAME_MAX,
  type LayerDef,
  type LayerInput,
  type LayerKind,
  layerKindName,
  USER_LAYER_KINDS,
} from "./layers";

const MINI =
  "h-6 shrink-0 border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-35 disabled:hover:border-slate-200";
const MINI_ON = "h-6 shrink-0 border border-slate-800 bg-slate-800 px-1.5 text-[11px] text-white";
const FIELD =
  "h-6 w-full border border-slate-300 bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-600";

interface LayerRowProps {
  layer: LayerDef;
  active: boolean;
  /** 이 레이어에 놓인 칸 수 — 프로젝트 전체 기준. 비우기·삭제 확인에 쓴다. */
  cellCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onFocus: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => string | null;
  onMove: (delta: number) => void;
  onClear: () => void;
  onDelete: () => void;
}

/**
 * 레이어 한 줄 — 이름 · 눈 · 자물쇠, 그리고 접혀 있는 관리 줄.
 *
 * 이름 변경 · 순서 · 비우기 · 삭제는 자주 쓰는 일이 아니라서 `관리` 를 눌러야
 * 펼쳐진다. 눈과 자물쇠는 그리는 중에도 계속 누르므로 항상 꺼내 둔다.
 */
export function LayerRow(props: LayerRowProps) {
  const { layer } = props;
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState(layer.name);
  const [error, setError] = useState<string | null>(null);

  const hidden = layer.hidden === true;
  const locked = layer.locked === true;

  const submitName = () => {
    const message = props.onRename(name);
    setError(message);
    if (!message) setManaging(false);
  };

  const clear = () => {
    if (props.cellCount === 0) return;
    const ok = window.confirm(
      `'${layer.name}' 레이어의 칸 ${props.cellCount}개를 모두 비웁니다. 레이어는 남습니다. 계속하시겠습니까?`,
    );
    if (ok) props.onClear();
  };

  const remove = () => {
    const ok = window.confirm(
      props.cellCount > 0
        ? `'${layer.name}' 레이어를 지웁니다. 이 레이어의 칸 ${props.cellCount}개와 팔레트 항목도 함께 사라집니다. 계속하시겠습니까?`
        : `'${layer.name}' 레이어를 지웁니다. 계속하시겠습니까?`,
    );
    if (ok) props.onDelete();
  };

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={props.onFocus}
          className={`min-w-0 flex-1 text-left text-[12px] font-semibold ${
            props.active ? "text-slate-900" : "text-slate-500"
          }`}
          title="이 레이어를 편집 대상으로"
        >
          <span className="truncate">{layer.name}</span>
          <span className="ml-1 font-normal text-slate-400">{layer.hint}</span>
          {locked ? <span className="ml-1 font-normal text-amber-700">잠김</span> : null}
        </button>

        <button
          type="button"
          className={hidden ? MINI : MINI_ON}
          onClick={props.onToggleVisible}
          title={hidden ? `${layer.name} 레이어 보이기` : `${layer.name} 레이어 숨기기`}
          aria-label={`${layer.name} 레이어 표시`}
          aria-pressed={!hidden}
        >
          {hidden ? "🚫" : "👁"}
        </button>
        <button
          type="button"
          className={locked ? MINI_ON : MINI}
          onClick={props.onToggleLock}
          title={locked ? `${layer.name} 레이어 잠금 풀기` : `${layer.name} 레이어 잠그기 — 칠하기·지우기를 막는다`}
          aria-label={`${layer.name} 레이어 잠금`}
          aria-pressed={locked}
        >
          {locked ? "🔒" : "🔓"}
        </button>
        <button
          type="button"
          className={managing ? MINI_ON : MINI}
          onClick={() => {
            setManaging(!managing);
            setName(layer.name);
            setError(null);
          }}
          title="이름 변경 · 순서 · 비우기 · 삭제"
          aria-expanded={managing}
        >
          관리
        </button>
      </div>

      {managing ? (
        <div className="mt-1 border border-slate-300 bg-white p-1.5">
          <label className="block text-[10px] font-semibold tracking-wide text-slate-500">
            레이어 이름
            <input
              value={name}
              maxLength={LAYER_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitName();
                }
              }}
              className={`mt-0.5 ${FIELD}`}
              aria-label="레이어 이름"
            />
          </label>

          <div className="mt-1 flex gap-1">
            <button type="button" className={MINI} onClick={submitName}>
              이름 저장
            </button>
            <button
              type="button"
              className={MINI}
              onClick={() => props.onMove(1)}
              disabled={!props.canMoveUp}
              title="위로 — 나중에 그려서 위에 얹힌다"
            >
              ▲ 위로
            </button>
            <button
              type="button"
              className={MINI}
              onClick={() => props.onMove(-1)}
              disabled={!props.canMoveDown}
              title="아래로 — 먼저 그려서 아래에 깔린다"
            >
              ▼ 아래로
            </button>
          </div>

          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              className={MINI}
              onClick={clear}
              disabled={props.cellCount === 0}
              title={props.cellCount === 0 ? "비울 칸이 없다" : `칸 ${props.cellCount}개를 비운다`}
            >
              칸 비우기 ({props.cellCount})
            </button>
            {layer.builtin ? null : (
              <button
                type="button"
                className="h-6 shrink-0 border border-red-300 bg-white px-1.5 text-[11px] text-red-700 hover:bg-red-50"
                onClick={remove}
              >
                레이어 삭제
              </button>
            )}
          </div>

          {/* 기본 레이어에는 삭제 단추가 없다. 그 이유를 여기 한 줄로 붙여 둔다. */}
          <p className="mt-1 text-[10px] text-slate-400">
            {layerKindName(layer.kind)}
            {layer.builtin ? " · 기본 레이어(삭제 불가)" : ""}
          </p>
          {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

interface LayerAddFormProps {
  onSubmit: (input: LayerInput) => string | null;
  onCancel: () => void;
}

/** 새 레이어 만들기 — 이름 · 그리는 방식 · 한 줄 설명. */
export function LayerAddForm(props: LayerAddFormProps) {
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const [kind, setKind] = useState<LayerKind>("fill");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const message = props.onSubmit({ name, kind, hint });
    setError(message);
    if (!message) props.onCancel();
  };

  return (
    <div className="mb-2 border border-slate-400 bg-white p-2">
      <p className="mb-1 text-[11px] font-semibold text-slate-700">레이어 추가</p>

      <label className="block text-[10px] font-semibold tracking-wide text-slate-500">
        이름
        <input
          value={name}
          placeholder="예: 구역, 안전선"
          maxLength={LAYER_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className={`mt-0.5 ${FIELD}`}
          aria-label="새 레이어 이름"
        />
      </label>

      <p className="mt-1.5 text-[10px] font-semibold tracking-wide text-slate-500">그리는 방식</p>
      <div className="mt-0.5 flex gap-1">
        {USER_LAYER_KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className={`h-6 flex-1 border px-1 text-[11px] ${
              kind === entry.kind
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => setKind(entry.kind)}
            title={entry.hint}
            aria-pressed={kind === entry.kind}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <label className="mt-1.5 block text-[10px] font-semibold tracking-wide text-slate-500">
        설명 (선택)
        <input
          value={hint}
          placeholder="예: 작업 구역"
          maxLength={LAYER_HINT_MAX}
          onChange={(event) => setHint(event.target.value)}
          className={`mt-0.5 ${FIELD}`}
          aria-label="새 레이어 설명"
        />
      </label>

      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}

      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          className="h-6 flex-1 border border-slate-800 bg-slate-800 text-[11px] text-white hover:bg-slate-700"
          onClick={submit}
        >
          추가
        </button>
        <button
          type="button"
          className="h-6 flex-1 border border-slate-300 bg-white text-[11px] text-slate-700 hover:bg-slate-100"
          onClick={props.onCancel}
        >
          취소
        </button>
      </div>
    </div>
  );
}
