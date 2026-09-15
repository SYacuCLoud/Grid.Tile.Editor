"use client";

import { useMemo, useState } from "react";
import { loadAuthor, saveAuthor } from "../editor/server/api";
import { resetFormat, saveFormat } from "./formatClient";
import type { SiteSamples } from "./liveState";
import {
  defaultFormat,
  EVENT_FIELDS,
  FIELD_HELP,
  isDefaultFormat,
  type MessageFormat,
  previewFields,
  STATE_FIELDS,
  STATUS_FIELDS,
  type TimeFormat,
} from "./messageFormat";

/**
 * 메시지 형식 프로필 설정 창.
 *
 * 현황판이 쓰는 필드마다 "페이로드 JSON 의 어느 경로에서 읽을까" 를 적는다. 오른쪽에 **지금 실제로 오는 메시지**
 * 원문을 띄워 두고, 경로를 고치면 그 자리에서 무엇이 읽히는지 바로 보인다. 기본은 RfidReaderMonitor v1.
 * 토픽 구조는 여기서 바꾸지 않는다.
 */

interface Props {
  site: string;
  initial: MessageFormat;
  samples: SiteSamples | undefined;
  onClose: () => void;
  onSaved: (format: MessageFormat) => void;
}

type Kind = "state" | "event" | "status";

const KINDS: { kind: Kind; title: string; topic: string; fields: readonly string[] }[] = [
  { kind: "state", title: "리더 상태", topic: "{prefix}/{site}/reader/{key}/state (retained)", fields: STATE_FIELDS },
  { kind: "event", title: "등장 · 제거 이벤트", topic: "{prefix}/{site}/reader/{key}/event", fields: EVENT_FIELDS },
  { kind: "status", title: "감시 PC 상태", topic: "{prefix}/{site}/host/{host}/status (retained + LWT)", fields: STATUS_FIELDS },
];

const FIELD = "rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:opacity-50";
const BUTTON = "rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

function pretty(payload: string | undefined): string {
  if (!payload) return "";
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function FormatSettings(props: Props) {
  const { site, initial, samples, onClose, onSaved } = props;
  const [maps, setMaps] = useState<Record<Kind, Record<string, string>>>({
    state: { ...initial.state },
    event: { ...initial.event },
    status: { ...initial.status },
  });
  const [trueValues, setTrueValues] = useState(initial.values.trueValues.join(", "));
  const [removeValues, setRemoveValues] = useState(initial.values.removeValues.join(", "));
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(initial.values.timeFormat);
  const [author, setAuthor] = useState(() => loadAuthor());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Kind>("state");

  /** 지금 화면 값으로 만든 초안. 미리보기와 저장이 같은 것을 본다. */
  const draft = useMemo<MessageFormat>(
    () => ({
      v: 1,
      site,
      state: maps.state as MessageFormat["state"],
      event: maps.event as MessageFormat["event"],
      status: maps.status as MessageFormat["status"],
      values: {
        trueValues: trueValues.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        removeValues: removeValues.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        timeFormat,
      },
    }),
    [maps, removeValues, site, timeFormat, trueValues],
  );
  const draftIsDefault = isDefaultFormat(draft);

  const setPath = (kind: Kind, field: string, path: string) => setMaps((cur) => ({ ...cur, [kind]: { ...cur[kind], [field]: path } }));

  const resetToDefault = () => {
    const base = defaultFormat(site);
    setMaps({ state: { ...base.state }, event: { ...base.event }, status: { ...base.status } });
    setTrueValues(base.values.trueValues.join(", "));
    setRemoveValues(base.values.removeValues.join(", "));
    setTimeFormat("auto");
  };

  const save = () => {
    setBusy(true);
    setError(null);
    saveAuthor(author);
    const call = draftIsDefault ? resetFormat(site) : saveFormat(site, draft, author);
    call
      .then((r) => onSaved(r.format))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="format-settings-title">
      <div className="my-4 w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="format-settings-title" className="text-base font-semibold">
              메시지 형식 프로필 · {site}
              <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-normal ${draftIsDefault ? "bg-slate-700 text-slate-300" : "bg-sky-900 text-sky-200"}`}>{draftIsDefault ? "기본 (RfidReaderMonitor v1)" : "사용자 정의"}</span>
            </h2>
            <p className="truncate text-[11px] text-slate-400">
              현황판이 쓰는 필드마다 페이로드 JSON 의 어느 경로에서 읽을지 정합니다. 토픽 구조는 v1 그대로입니다.
              {initial.updatedAt ? ` · 마지막 저장 ${initial.updatedBy ?? "익명"} · ${new Date(initial.updatedAt).toLocaleString("ko-KR")}` : ""}
            </p>
          </div>
          <button type="button" className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <nav className="flex gap-1 border-b border-slate-800 px-5 pt-2" aria-label="메시지 종류">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => setOpen(k.kind)}
              className={`rounded-t px-3 py-1.5 text-sm ${open === k.kind ? "bg-slate-800 font-semibold text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
            >
              {k.title}
              {samples?.[k.kind] ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" title="표본 메시지 있음" aria-hidden="true" /> : null}
            </button>
          ))}
        </nav>

        {KINDS.filter((k) => k.kind === open).map((k) => {
          const preview = previewFields(draft, k.kind, samples?.[k.kind] ?? "");
          return (
            <section key={k.kind} className="grid gap-4 px-5 py-4 md:grid-cols-[3fr_2fr]">
              <div>
                <p className="mb-2 font-mono text-[11px] text-slate-500">{k.topic}</p>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="px-1 py-1">필드</th>
                      <th className="px-1 py-1">JSON 경로</th>
                      <th className="px-1 py-1">표본에서 읽은 값</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.fields.map((field) => {
                      const row = preview.find((p) => p.field === field);
                      const missing = !!samples?.[k.kind] && maps[k.kind][field] !== "" && row?.raw === undefined;
                      return (
                        <tr key={field} className="border-t border-slate-800 align-top">
                          <td className="px-1 py-1.5">
                            <span className="font-mono font-semibold text-slate-200">{field}</span>
                            <span className="block text-[10px] text-slate-500">{FIELD_HELP[field] ?? ""}</span>
                          </td>
                          <td className="px-1 py-1.5">
                            <input
                              className={`${FIELD} w-full font-mono ${missing ? "border-amber-500" : ""}`}
                              value={maps[k.kind][field] ?? ""}
                              onChange={(e) => setPath(k.kind, field, e.target.value)}
                              placeholder="(읽지 않음)"
                              aria-label={`${field} 경로`}
                            />
                          </td>
                          <td className="px-1 py-1.5">
                            {samples?.[k.kind] ? (
                              row?.raw === undefined ? (
                                <span className={maps[k.kind][field] ? "text-amber-300" : "text-slate-500"}>{maps[k.kind][field] ? "표본에 없음" : "—"}</span>
                              ) : (
                                <span className="text-emerald-300" title={JSON.stringify(row.raw)}>{row.shown || <span className="text-slate-500">(빈 값)</span>}</span>
                              )
                            ) : (
                              <span className="text-slate-600">표본 없음</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400">마지막에 받은 메시지 원문</p>
                {samples?.[k.kind] ? (
                  <pre className="max-h-96 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-[11px] leading-snug text-slate-300">{pretty(samples[k.kind])}</pre>
                ) : (
                  <p className="rounded border border-dashed border-slate-700 p-3 text-xs text-slate-500">
                    이 사업장에서 아직 이 종류의 메시지를 받지 못했습니다. 브로커에 연결된 뒤 메시지가 오면 여기 나타납니다.
                  </p>
                )}
              </div>
            </section>
          );
        })}

        <section className="grid gap-3 border-t border-slate-800 px-5 py-3 md:grid-cols-3">
          <label className="block text-xs text-slate-300">
            <span className="block text-[11px] font-semibold tracking-wide text-slate-400">참으로 볼 글자 값 (present · online)</span>
            <input className={`${FIELD} mt-1 w-full`} value={trueValues} onChange={(e) => setTrueValues(e.target.value)} placeholder="true, 1, yes, on" />
            <span className="block text-[10px] text-slate-500">불리언 · 숫자는 그대로 해석합니다. 쉼표로 나눕니다.</span>
          </label>
          <label className="block text-xs text-slate-300">
            <span className="block text-[11px] font-semibold tracking-wide text-slate-400">제거로 볼 kind 값</span>
            <input className={`${FIELD} mt-1 w-full`} value={removeValues} onChange={(e) => setRemoveValues(e.target.value)} placeholder="REMOVE, OUT" />
            <span className="block text-[10px] text-slate-500">목록에 없으면 등장으로 봅니다.</span>
          </label>
          <label className="block text-xs text-slate-300">
            <span className="block text-[11px] font-semibold tracking-wide text-slate-400">시각 해석</span>
            <select className={`${FIELD} mt-1 w-full`} value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}>
              <option value="auto">자동 (숫자는 크기로 ms/s 판단, 글자는 그대로)</option>
              <option value="iso">ISO 8601 글자</option>
              <option value="epochMs">epoch 밀리초</option>
              <option value="epochS">epoch 초</option>
            </select>
          </label>
        </section>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-5 py-3">
          <input className={`${FIELD} w-32`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="저장자 이름" aria-label="저장자 이름" />
          <button type="button" className={`${BUTTON} text-slate-300 hover:bg-slate-800`} onClick={resetToDefault} disabled={draftIsDefault}>
            기본값(v1)으로
          </button>
          <div className="min-w-0 flex-1 text-[11px] text-amber-300">{error ?? ""}</div>
          <button type="button" className={`${BUTTON} text-slate-300 hover:bg-slate-800`} onClick={onClose}>취소</button>
          <button type="button" className={`${BUTTON} bg-sky-600 text-white hover:bg-sky-500`} onClick={save} disabled={busy}>
            {busy ? "저장 중…" : draftIsDefault ? "기본으로 저장하고 다시 읽기" : "저장하고 다시 읽기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
