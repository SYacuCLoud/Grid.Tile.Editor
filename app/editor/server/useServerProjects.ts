"use client";

import { useCallback, useEffect, useState } from "react";

import type { ProjectDoc } from "../doc";
import {
  ApiUnavailableError,
  createProject,
  formatStamp,
  listProjects,
  loadAuthor,
  loadHistory,
  loadProject,
  type ProjectListEntry,
  restoreRevision,
  type RevisionMeta,
  saveAuthor,
  type SaveConflict,
  type SaveMode,
  saveProject,
} from "./api";

/**
 * 서버 도면 공유 상태.
 *
 * 화면 그리기와 떨어뜨려 둔다. 어떤 도면을 열어 두었는지 · 어느 리비전에서
 * 갈라져 나왔는지 · 저장이 충돌했는지가 여기 모여 있고, 컴포넌트는 그리기만 한다.
 */
export interface ServerProjectsState {
  /** null 이면 아직 확인 중, false 면 이 자리에 서버가 없다. */
  available: boolean | null;
  /** 서버에 닿지 못한 이유. 있으면 줄을 감추지 않고 이 말을 보여 준다. */
  offlineReason: string | null;
  projects: ProjectListEntry[];
  currentId: string | null;
  /** 열었거나 마지막으로 저장한 리비전. 저장할 때 이 값을 기준으로 충돌을 본다. */
  baseRevision: number;
  author: string;
  status: string;
  busy: boolean;
  conflict: SaveConflict | null;
  history: RevisionMeta[] | null;
}

export interface ServerProjectsActions {
  setAuthor(name: string): void;
  refresh(): Promise<void>;
  open(id: string): Promise<void>;
  createNew(title: string): Promise<void>;
  save(mode?: SaveMode): Promise<void>;
  dismissConflict(): void;
  openHistory(): Promise<void>;
  closeHistory(): void;
  restore(revision: number): Promise<void>;
}

export function useServerProjects(
  project: ProjectDoc,
  replaceProject: (next: ProjectDoc) => void,
): ServerProjectsState & { actions: ServerProjectsActions } {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [author, setAuthorState] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [history, setHistory] = useState<RevisionMeta[] | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소에서 1회 동기화
    setAuthorState(loadAuthor());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await listProjects();
      setProjects(result.projects);
      setAvailable(true);
      setOfflineReason(null);
    } catch (error) {
      // 닿지 못한 이유를 남긴다. 줄을 통째로 감추면 사용자는 "메뉴가 사라졌다"
      // 고만 느끼고 무엇을 해야 하는지 알 수 없다.
      setAvailable(false);
      setOfflineReason(error instanceof Error ? error.message : "서버에 닿지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버가 있는 자리인지 1회 확인
    void refresh();
  }, [refresh]);

  const setAuthor = useCallback((name: string) => {
    setAuthorState(name);
    saveAuthor(name);
  }, []);

  const open = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const loaded = await loadProject(id);
        replaceProject(loaded.project);
        setCurrentId(loaded.id);
        setBaseRevision(loaded.revision);
        setConflict(null);
        setHistory(null);
        setStatus(
          loaded.revision === 0
            ? `${loaded.id} 열기 (이력 없음)`
            : `${loaded.id} r${loaded.revision} 열기 · ${loaded.author ?? "익명"} · ${formatStamp(loaded.savedAt)}`,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "열지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [replaceProject],
  );

  const createNew = useCallback(
    async (title: string) => {
      setBusy(true);
      try {
        const created = await createProject(title, author);
        replaceProject(created.project);
        setCurrentId(created.id);
        setBaseRevision(created.revision);
        setConflict(null);
        setHistory(null);
        setStatus(`${created.id} 만듦 (r${created.revision})`);
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "만들지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [author, refresh, replaceProject],
  );

  const save = useCallback(
    async (mode: SaveMode = "save") => {
      if (!currentId) {
        setStatus("먼저 서버 도면을 열거나 새로 만들어 주십시오.");
        return;
      }

      setBusy(true);
      try {
        const result = await saveProject({ id: currentId, project, baseRevision, author, mode });
        if (!result.ok) {
          setConflict(result);
          setStatus(result.message);
          return;
        }

        setConflict(null);
        setCurrentId(result.id);
        setBaseRevision(result.revision);
        setHistory(null);
        setStatus(
          result.copied
            ? `사본으로 저장: ${result.id} (r${result.revision})`
            : `저장 완료 r${result.revision} · ${formatStamp(result.savedAt)}`,
        );
        await refresh();
      } catch (error) {
        // 서버가 사라졌으면(개발 서버 재시작 등) 서버 줄을 접는다. 저장 내용은
        // 브라우저 자동 저장과 JSON 내보내기로 그대로 남는다.
        if (error instanceof ApiUnavailableError) {
          setAvailable(false);
          setOfflineReason(error.message);
        }
        setStatus(error instanceof Error ? error.message : "저장하지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [author, baseRevision, currentId, project, refresh],
  );

  const openHistory = useCallback(async () => {
    if (!currentId) {
      setStatus("먼저 서버 도면을 열어 주십시오.");
      return;
    }
    setBusy(true);
    try {
      const result = await loadHistory(currentId);
      setHistory(result.revisions);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "이력을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [currentId]);

  const restore = useCallback(
    async (revision: number) => {
      if (!currentId) return;
      setBusy(true);
      try {
        const result = await restoreRevision(currentId, revision, author);
        const loaded = await loadProject(currentId);
        replaceProject(loaded.project);
        setBaseRevision(result.revision);
        setConflict(null);
        setHistory(null);
        setStatus(`r${revision} 로 되돌렸습니다 (새 리비전 r${result.revision})`);
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "되돌리지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [author, currentId, refresh, replaceProject],
  );

  return {
    available,
    offlineReason,
    projects,
    currentId,
    baseRevision,
    author,
    status,
    busy,
    conflict,
    history,
    actions: {
      setAuthor,
      refresh,
      open,
      createNew,
      save,
      dismissConflict: () => setConflict(null),
      openHistory,
      closeHistory: () => setHistory(null),
      restore,
    },
  };
}
