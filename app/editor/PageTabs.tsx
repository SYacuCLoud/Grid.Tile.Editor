"use client";

import { useEffect, useRef, useState } from "react";
import { type PageDoc } from "./doc";

interface PageTabsProps {
  pages: PageDoc[];
  activePageId: string;
  onSwitchPage: (pageId: string) => void;
  onAddPage: () => void;
  onRenamePage: (pageId: string, newName: string) => void;
  onDeletePage: (pageId: string) => void;
}

export function PageTabs(props: PageTabsProps) {
  const { pages, activePageId, onSwitchPage, onAddPage, onRenamePage, onDeletePage } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // 이름 편집을 시작한 순간에만 한 번 포커스한다.
  // autoFocus 는 접근성 규칙에 걸리고, 인라인 ref 콜백은 렌더마다 다시 붙어
  // focus() 가 반복 호출된다(한글 조합 중 방해 소지).
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const startRename = (page: PageDoc) => {
    setEditingId(page.id);
    setEditName(page.name);
  };

  const commitRename = (pageId: string) => {
    if (editingId === pageId) {
      onRenamePage(pageId, editName);
      setEditingId(null);
    }
  };

  const handleDelete = (page: PageDoc) => {
    if (pages.length <= 1) return;
    const ok = window.confirm(`'${page.name}' 페이지를 삭제하시겠습니까? 해당 페이지의 모든 설비 배치가 삭제됩니다.`);
    if (ok) onDeletePage(page.id);
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-[13px]">
      <span className="mr-1 text-[11px] font-semibold text-slate-500">페이지:</span>

      <div className="flex items-center gap-1.5">
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          const isEditing = editingId === page.id;

          return (
            <div
              key={page.id}
              className={`group flex items-center gap-1.5 rounded-t border px-3 py-1 transition-colors ${
                isActive
                  ? "border-slate-400 bg-white font-medium text-slate-900 shadow-xs"
                  : "border-transparent bg-slate-200/70 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              {isEditing ? (
                <input
                  type="text"
                  className="h-6 w-28 border border-slate-400 bg-white px-1 text-[12px] text-slate-900 outline-none"
                  value={editName}
                  ref={editInputRef}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => commitRename(page.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(page.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSwitchPage(page.id)}
                  onDoubleClick={() => startRename(page)}
                  className="truncate text-left outline-none"
                  title="클릭하여 이동, 더블클릭하여 이름 변경"
                >
                  {page.name}
                </button>
              )}

              {!isEditing && (
                <button
                  type="button"
                  onClick={() => startRename(page)}
                  className="hidden text-slate-400 hover:text-slate-700 group-hover:inline-block"
                  title="페이지 이름 변경"
                >
                  ✏️
                </button>
              )}

              <button
                type="button"
                disabled={pages.length <= 1}
                onClick={() => handleDelete(page)}
                className={`ml-1 text-[14px] leading-none ${
                  pages.length <= 1
                    ? "cursor-not-allowed opacity-30 text-slate-400"
                    : "text-slate-400 hover:text-red-600"
                }`}
                title={pages.length <= 1 ? "최소 1개의 페이지는 유지되어야 합니다" : `'${page.name}' 페이지 삭제`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        // 핸들러를 그대로 넘기면 React 가 클릭 이벤트를 첫 인자로 준다.
        // 받는 쪽은 페이지 이름을 기대하므로 인자 없이 부른다.
        onClick={() => onAddPage()}
        className="ml-2 flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs"
        title="새 빈 독립 도면 페이지 추가"
      >
        <span>+</span>
        <span>페이지 추가</span>
      </button>
    </div>
  );
}
