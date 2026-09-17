"use client";

import { useMemo, useState } from "react";
import { fromLocalInput, newRequestId, type ReplayDone, replayPayload, replayTopic, shortStamp, toLocalInput } from "./replay";

/**
 * 빠진 이력 요청 — 기록기(서버)가 죽어 있던 구간을 감시 PC 에게 다시 내 달라고 하는 작은 폼.
 * 감시 PC 목록 아래에 접혀 있고, 펼치면 구간(이 브라우저 시간대) · 대상 PC 를 고르고 `요청` 을 누른다.
 * 답(`replay-done`)이 오면 PC 마다 몇 건을 냈는지 아래에 쌓인다.
 */

interface Props {
  prefix: string;
  /** 주소의 사업장. 비어 있으면(모든 사업장) 감시 PC 의 사업장 중에서 고른다. */
  site: string;
  hosts: { host: string; site: string; online: boolean }[];
  connected: boolean;
  /** MQTT 로 낸다. 접속이 없어 못 냈으면 false. */
  publish: (topic: string, payload: string) => boolean;
  done: ReplayDone[];
}

export function ReplayRequest(props: Props) {
  const { prefix, site, hosts, connected, publish, done } = props;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => toLocalInput(Date.now() - 24 * 3_600_000));
  const [to, setTo] = useState(() => toLocalInput(Date.now()));
  const [host, setHost] = useState("");
  const [pickedSite, setPickedSite] = useState("");
  const [sent, setSent] = useState<{ id: string; at: number; fromMs: number; toMs: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const sites = useMemo(() => Array.from(new Set(hosts.map((h) => h.site).filter(Boolean))).sort(), [hosts]);
  const targetSite = site || pickedSite || sites[0] || "default";
  const hostChoices = useMemo(() => hosts.filter((h) => !targetSite || h.site === targetSite).map((h) => h.host).sort(), [hosts, targetSite]);

  const send = () => {
    const fromMs = fromLocalInput(from);
    const toMs = fromLocalInput(to);
    if (fromMs === null || toMs === null) {
      setNote("시작 · 끝 시각을 넣으십시오.");
      return;
    }
    if (toMs <= fromMs) {
      setNote("끝이 시작보다 뒤여야 합니다.");
      return;
    }
    if (toMs - fromMs > 31 * 86_400_000) {
      setNote("한 번에 31일까지입니다.");
      return;
    }
    const id = newRequestId();
    const ok = publish(replayTopic(prefix, targetSite, host || null), replayPayload({ fromMs, toMs, requestId: id, host: host || null }));
    if (!ok) {
      setNote("브로커에 붙어 있지 않아 보내지 못했습니다.");
      return;
    }
    setSent({ id, at: Date.now(), fromMs, toMs });
    setNote(null);
  };

  const answers = sent ? done.filter((d) => d.requestId === sent.id) : [];
  const total = answers.reduce((n, d) => n + d.count, 0);
  const input = "rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-100 disabled:opacity-50";

  return (
    <div className="mt-1 text-[11px] text-slate-400">
      <button type="button" className="rounded px-1.5 py-0.5 text-sky-300 hover:bg-slate-800" onClick={() => setOpen((o) => !o)} title="기록기가 죽어 있던 구간의 이력을 감시 PC 의 CSV 에서 다시 받습니다">
        {open ? "▾" : "▸"} 빠진 이력 요청
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1 rounded-lg border border-slate-700/70 bg-slate-800/40 p-2">
          <p className="text-slate-500">
            서버 이력이 비어 있는 구간을 넣으면 감시 PC 가 자기 CSV 에서 그 구간을 다시 냅니다. 화면의 지금 상태는 바뀌지 않고 이력에만 들어갑니다.
          </p>
          <label className="flex items-center gap-1">
            <span className="w-8 shrink-0">시작</span>
            <input type="datetime-local" className={`${input} flex-1`} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="시작 시각" />
          </label>
          <label className="flex items-center gap-1">
            <span className="w-8 shrink-0">끝</span>
            <input type="datetime-local" className={`${input} flex-1`} value={to} onChange={(e) => setTo(e.target.value)} aria-label="끝 시각" />
          </label>
          {!site && sites.length > 1 ? (
            <label className="flex items-center gap-1">
              <span className="w-8 shrink-0">사업장</span>
              <select className={`${input} flex-1`} value={pickedSite || sites[0]} onChange={(e) => { setPickedSite(e.target.value); setHost(""); }} aria-label="사업장">
                {sites.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1">
            <span className="w-8 shrink-0">PC</span>
            <select className={`${input} flex-1`} value={host} onChange={(e) => setHost(e.target.value)} aria-label="대상 감시 PC">
              <option value="">모든 감시 PC ({hostChoices.length})</option>
              {hostChoices.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-emerald-700 px-2 py-0.5 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              onClick={send}
              disabled={!connected}
              title={connected ? `${replayTopic(prefix, targetSite, host || null)} 로 요청` : "브로커에 붙은 뒤 보낼 수 있습니다"}
            >
              요청
            </button>
            {sent ? (
              <span className="truncate text-slate-400">
                {shortStamp(new Date(sent.fromMs).toISOString())} ~ {shortStamp(new Date(sent.toMs).toISOString())} 요청함 · 답 {answers.length}대 · {total.toLocaleString("ko-KR")}건
              </span>
            ) : null}
          </div>
          {note ? <p className="text-amber-300">{note}</p> : null}
          {answers.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {answers.map((d) => (
                <li key={`${d.host}:${d.at}`} className="truncate" title={d.error ?? `${d.files}개 파일`}>
                  <span className="font-semibold text-slate-300">{d.host}</span> {d.error ? <span className="text-amber-300">{d.error}</span> : `${d.count.toLocaleString("ko-KR")}건${d.truncated ? " (최대에 걸려 일부만)" : ""}`}
                </li>
              ))}
            </ul>
          ) : null}
          {sent && answers.length === 0 ? <p className="text-slate-500">답을 기다립니다… 구버전(0.4.x) 감시 PC 는 이 요청을 모릅니다.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
