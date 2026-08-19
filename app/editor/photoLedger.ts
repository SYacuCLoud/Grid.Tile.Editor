/**
 * 사진 대장 — 도면에 붙은 사진을 좌표와 함께 모아 인쇄물·파일로 낸다.
 *
 * 도면 PNG 는 "어디에 무엇이 있는지" 를 보여 준다. 현장에서 필요한 다른 한 장은
 * "그 자리가 실제로 어떻게 생겼는지" 다. 사진은 칸마다 흩어져 있어 하나하나
 * 우클릭해 보는 수밖에 없었다 — 그걸 한 장으로 모으는 것이 사진 대장이다.
 *
 * 여기에는 DOM 이 없다. 사진 목록을 모으고(`collectPhotoEntries`), 파일 이름을
 * 짓고(`photoFileName`), 인쇄용 HTML 문서를 문자열로 만드는(`ledgerHtml`) 일까지만
 * 한다. 창을 열고 파일을 내려받는 일은 `photoExport.ts` 가 맡는다. 그래서 이
 * 모듈은 브라우저 없이 그대로 시험할 수 있다.
 */

import { cellKey, cellPhotos, parseCellKey, type ProjectDoc } from "./doc";

/** 사진 한 장 — 어느 페이지 어느 칸의 몇 번째 장인가. */
export interface PhotoEntry {
  pageId: string;
  pageName: string;
  /** 칸 좌표. 내부 기준(0부터)이다. 사람에게 보일 때만 1을 더한다. */
  x: number;
  y: number;
  key: string;
  label: string;
  memo: string;
  /** 그 칸에서 몇 번째 사진인가. 1부터. */
  index: number;
  /** 그 칸에 붙은 사진 총 장수. */
  total: number;
  photo: string;
}

/**
 * 프로젝트 전체의 사진을 읽는 순서(페이지 → 위에서 아래 → 왼쪽에서 오른쪽)로 모은다.
 *
 * 이전 판 문서의 단일 `photo` 도 `cellPhotos` 를 지나므로 함께 잡힌다.
 */
export function collectPhotoEntries(project: ProjectDoc): PhotoEntry[] {
  const out: PhotoEntry[] = [];

  for (const page of project.pages) {
    const cells = Object.entries(page.equipment)
      .map(([key, cell]) => ({ key, cell, ...parseCellKey(key) }))
      .filter((entry) => cellPhotos(entry.cell).length > 0)
      .sort((a, b) => a.y - b.y || a.x - b.x);

    for (const { cell, x, y } of cells) {
      out.push(
        ...entriesFromCell({
          pageId: page.id,
          pageName: page.name,
          x,
          y,
          label: cell.label ?? "",
          memo: cell.memo ?? "",
          photos: cellPhotos(cell),
        }),
      );
    }
  }

  return out;
}

/**
 * 칸 하나의 사진 목록.
 *
 * 편집 상자는 아직 저장하지 않은 사진도 뽑을 수 있어야 한다 — 그래서 문서를
 * 거치지 않고 지금 화면에 있는 값으로 바로 목록을 짓는 입구를 둔다.
 */
export function entriesFromCell(input: {
  pageId: string;
  pageName: string;
  x: number;
  y: number;
  label: string;
  memo: string;
  photos: string[];
}): PhotoEntry[] {
  return input.photos.map((photo, index) => ({
    pageId: input.pageId,
    pageName: input.pageName,
    x: input.x,
    y: input.y,
    key: cellKey(input.x, input.y),
    label: input.label,
    memo: input.memo,
    index: index + 1,
    total: input.photos.length,
    photo,
  }));
}

/** 파일 이름에 쓸 수 없는 글자를 걷어 낸다. 빈 값이면 자리를 비우지 않고 `-` 를 남긴다. */
function namePart(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "-";
}

/** data URL 이 말하는 확장자. 이전 판 문서에는 PNG·WebP 도 들어 있다. */
export function photoExtension(dataUrl: string): string {
  const match = /^data:image\/([a-z]+);/.exec(dataUrl);
  const type = match ? match[1] : "png";
  return type === "jpeg" ? "jpg" : type;
}

/**
 * 사진 파일 이름. `1층-메인-공장_5_3_C1101_photo_2.jpg`
 *
 * 좌표는 화면에 보이는 값(1부터)으로 적는다 — 인쇄물의 `가로 3 · 세로 5` 와
 * 파일 이름이 어긋나면 현장에서 대조할 수 없다. 순서는 세로·가로 순이다.
 */
export function photoFileName(entry: PhotoEntry): string {
  const parts = [namePart(entry.pageName), entry.y + 1, entry.x + 1, namePart(entry.label)];
  return `${parts.join("_")}_photo_${entry.index}.${photoExtension(entry.photo)}`;
}

/** 사람이 읽는 칸 자리. `가로 3 · 세로 5` */
export function positionText(entry: PhotoEntry): string {
  return `가로 ${entry.x + 1} · 세로 ${entry.y + 1}`;
}

export interface LedgerMeta {
  /** 인쇄물 머리에 크게 적을 줄. */
  title: string;
  /** 그 아래 작게 적을 줄. 리비전 · 작성자 · 뽑은 시각 같은 것. */
  subtitle?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A4 에 맞춘 인쇄용 스타일.
 *
 * 화면 스타일(Tailwind)을 가져오지 않는다 — 새 창은 우리 CSS 번들을 모른다.
 * 인쇄물 한 장에 필요한 만큼만 여기에 직접 적는 편이 확실하고 짧다.
 *
 * `break-inside: avoid` 가 핵심이다. 사진과 그 설명이 장 경계에서 갈리면
 * 대장으로 못 쓴다.
 */
const LEDGER_CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", "Malgun Gothic", system-ui, sans-serif;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header { border-bottom: 1.5px solid #0f172a; padding-bottom: 4mm; margin-bottom: 5mm; }
  h1 { margin: 0; font-size: 15pt; }
  .subtitle { margin: 1.5mm 0 0; font-size: 8.5pt; color: #64748b; }
  h2 {
    margin: 0 0 3mm;
    padding-bottom: 1.5mm;
    border-bottom: 1px solid #cbd5e1;
    font-size: 11pt;
  }
  section { margin-bottom: 6mm; break-inside: auto; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  figure {
    margin: 0;
    border: 1px solid #94a3b8;
    padding: 2mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  figure img {
    display: block;
    width: 100%;
    height: 42mm;
    object-fit: contain;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
  }
  figcaption { margin-top: 1.5mm; font-size: 8pt; line-height: 1.35; }
  .pos { font-weight: 600; }
  .label { color: #1d4ed8; }
  .count { color: #64748b; }
  .memo {
    margin-top: 1mm;
    color: #334155;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .empty { padding: 10mm 0; text-align: center; color: #64748b; font-size: 10pt; }
  @media print { .hint { display: none; } }
  .hint { margin-top: 6mm; font-size: 8.5pt; color: #64748b; }
`;

function figureHtml(entry: PhotoEntry): string {
  const count = entry.total > 1 ? ` <span class="count">(${entry.index}/${entry.total})</span>` : "";
  const label = entry.label ? ` · <span class="label">${escapeHtml(entry.label)}</span>` : "";
  const memo = entry.memo ? `<div class="memo">${escapeHtml(entry.memo)}</div>` : "";
  return [
    "<figure>",
    `<img src="${entry.photo}" alt="${escapeHtml(positionText(entry))} 사진 ${entry.index}">`,
    "<figcaption>",
    `<span class="pos">${escapeHtml(positionText(entry))}</span>${label}${count}`,
    memo,
    "</figcaption>",
    "</figure>",
  ].join("");
}

/**
 * 사진 대장 HTML 한 편. 그대로 새 창에 써 넣으면 인쇄할 수 있는 완성된 문서다.
 *
 * 페이지가 여럿이면 페이지별로 모아 이름을 머리에 붙인다 — 좌표만으로는 어느
 * 층 도면인지 알 수 없다. 한 페이지뿐이면 그 머리를 생략한다(칸 하나만 뽑을
 * 때도 이 길로 온다).
 */
export function ledgerHtml(entries: PhotoEntry[], meta: LedgerMeta): string {
  const pages: Array<{ id: string; name: string; entries: PhotoEntry[] }> = [];
  for (const entry of entries) {
    const last = pages[pages.length - 1];
    if (last && last.id === entry.pageId) last.entries.push(entry);
    else pages.push({ id: entry.pageId, name: entry.pageName, entries: [entry] });
  }

  const body =
    entries.length === 0
      ? '<p class="empty">붙어 있는 사진이 없습니다.</p>'
      : pages
          .map((page) =>
            [
              "<section>",
              pages.length > 1 ? `<h2>${escapeHtml(page.name)} (${page.entries.length}장)</h2>` : "",
              '<div class="grid">',
              page.entries.map(figureHtml).join(""),
              "</div>",
              "</section>",
            ].join(""),
          )
          .join("");

  const subtitle = meta.subtitle ? `<p class="subtitle">${escapeHtml(meta.subtitle)}</p>` : "";

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(meta.title)}</title>`,
    `<style>${LEDGER_CSS}</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<h1>${escapeHtml(meta.title)}</h1>`,
    subtitle,
    "</header>",
    body,
    '<p class="hint">인쇄 창이 저절로 열리지 않으면 Ctrl+P 를 누르십시오.</p>',
    "</body>",
    "</html>",
  ].join("\n");
}

/** 사진 대장 머리에 적을 둘째 줄. 없는 값은 자리를 비우지 않고 빼 버린다. */
export function ledgerSubtitle(input: {
  count: number;
  revision?: number | null;
  author?: string | null;
  printedAt?: Date | null;
}): string {
  const stamp = input.printedAt
    ? `${input.printedAt.getFullYear()}-${String(input.printedAt.getMonth() + 1).padStart(2, "0")}-${String(
        input.printedAt.getDate(),
      ).padStart(2, "0")} ${String(input.printedAt.getHours()).padStart(2, "0")}:${String(
        input.printedAt.getMinutes(),
      ).padStart(2, "0")}`
    : null;

  return [
    `사진 ${input.count}장`,
    input.revision ? `r${input.revision}` : null,
    input.author || null,
    stamp,
  ]
    .filter(Boolean)
    .join(" · ");
}
