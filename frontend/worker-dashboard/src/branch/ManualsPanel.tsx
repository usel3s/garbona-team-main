import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, Plus } from "lucide-react";
import { BRANCH_MANUALS, formatShortDate } from "./mock";
import type { BranchManual } from "./types";
import "./branch-cabinet.css";

function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        parts.push(
          <a key={key++} href={link[2]}>
            {link[1]}
          </a>,
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Minimal markdown: # ## ** * - lists, quotes, links */
export function renderSimpleMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      nodes.push(<h1 key={key++}>{inlineMarkdown(line.slice(2))}</h1>);
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(<h2 key={key++}>{inlineMarkdown(line.slice(3))}</h2>);
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i += 1;
      }
      nodes.push(
        <blockquote key={key++}>{inlineMarkdown(quote.join(" "))}</blockquote>,
      );
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i += 1;
      }
      nodes.push(
        <ul key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i += 1;
      }
      nodes.push(
        <ol key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{inlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") &&
      !lines[i].startsWith("- ") &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    nodes.push(<p key={key++}>{inlineMarkdown(para.join(" "))}</p>);
  }

  return nodes;
}

type ViewMode = "list" | "read" | "edit";

const TOOLBAR: { id: string; label: string; insert: string; wrap?: [string, string] }[] = [
  { id: "h2", label: "H2", insert: "\n## " },
  { id: "bold", label: "B", insert: "", wrap: ["**", "**"] },
  { id: "italic", label: "I", insert: "", wrap: ["*", "*"] },
  { id: "quote", label: "«»", insert: "\n> " },
  { id: "list", label: "List", insert: "\n- " },
  { id: "link", label: "Link", insert: "", wrap: ["[", "](https://)"] },
];

export function ManualsPanel({
  canEdit = false,
  initialManuals,
}: {
  canEdit?: boolean;
  initialManuals?: BranchManual[];
}) {
  const [manuals, setManuals] = useState<BranchManual[]>(
    initialManuals ?? BRANCH_MANUALS,
  );
  const [mode, setMode] = useState<ViewMode>("list");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = manuals.find((item) => item.id === activeId) ?? null;
  const previewNodes = useMemo(
    () => renderSimpleMarkdown(draftBody || "_Пустой черновик_"),
    [draftBody],
  );

  function openReader(id: string) {
    setActiveId(id);
    setMode("read");
  }

  function startCreate() {
    setActiveId(null);
    setDraftTitle("");
    setDraftBody("# Новый мануал\n\n");
    setMode("edit");
  }

  function applyTool(tool: (typeof TOOLBAR)[number]) {
    const el = textareaRef.current;
    if (!el) {
      setDraftBody((current) => current + (tool.wrap ? `${tool.wrap[0]}текст${tool.wrap[1]}` : tool.insert));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draftBody.slice(start, end) || "текст";
    let insertion = tool.insert;
    if (tool.wrap) {
      insertion = `${tool.wrap[0]}${selected}${tool.wrap[1]}`;
    }
    const next =
      draftBody.slice(0, start) +
      (tool.wrap ? insertion : tool.insert + (tool.insert ? "" : selected)) +
      draftBody.slice(end);
    setDraftBody(next);
    window.requestAnimationFrame(() => {
      el.focus();
      const caret = start + insertion.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function saveDraft() {
    const title = draftTitle.trim() || "Без названия";
    const excerpt =
      draftBody
        .replace(/^#+\s*/gm, "")
        .replace(/[*_>\[\]()#-]/g, "")
        .trim()
        .slice(0, 120) || "Без описания";
    const created: BranchManual = {
      id: `man-${Date.now()}`,
      title,
      excerpt,
      updatedAt: new Date().toISOString().slice(0, 10),
      bodyMarkdown: draftBody,
      author: "you",
    };
    setManuals((current) => [created, ...current]);
    setActiveId(created.id);
    setMode("read");
  }

  if (mode === "edit") {
    return (
      <div className="gbc">
        <header className="gbc__head">
          <div>
            <p className="gbc__kicker">
              <BookOpen size={14} strokeWidth={1.7} />
              Мануалы
            </p>
            <h1>Новый мануал</h1>
            <p>Редактор с живым превью</p>
          </div>
          <div className="gbc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="gbc__btn is-ghost"
              onClick={() => setMode("list")}
            >
              Отмена
            </button>
            <button type="button" className="gbc__btn" onClick={saveDraft}>
              Опубликовать
            </button>
          </div>
        </header>

        <label className="gbc-field">
          <span className="gbc-field__label">Заголовок</span>
          <input
            value={draftTitle}
            maxLength={80}
            placeholder="Название статьи"
            onChange={(event) => setDraftTitle(event.target.value)}
          />
        </label>

        <div className="gbc-editor">
          <div>
            <div className="gbc-editor__tools">
              {TOOLBAR.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => applyTool(tool)}
                >
                  {tool.label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="gbc-editor__preview gbc-prose">{previewNodes}</div>
        </div>
      </div>
    );
  }

  if (mode === "read" && active) {
    return (
      <div className="gbc gbc-reader">
        <div className="gbc-reader__back">
          <button
            type="button"
            className="gbc__btn is-ghost"
            onClick={() => setMode("list")}
          >
            <ArrowLeft size={15} strokeWidth={2} />
            К списку
          </button>
        </div>
        <article className="gbc-prose">
          {renderSimpleMarkdown(active.bodyMarkdown)}
        </article>
        <p style={{ marginTop: 28, color: "var(--faint)", fontSize: 12 }}>
          @{active.author} · обновлено {formatShortDate(active.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <div className="gbc">
      <header className="gbc__head">
        <div>
          <p className="gbc__kicker">
            <BookOpen size={14} strokeWidth={1.7} />
            База знаний
          </p>
          <h1>Мануалы</h1>
          <p>Статьи и чеклисты для участников филиала</p>
        </div>
        {canEdit ? (
          <button type="button" className="gbc__btn" onClick={startCreate}>
            <Plus size={15} strokeWidth={2} />
            Новый мануал
          </button>
        ) : null}
      </header>

      <div className="gbc-manuals__grid">
        {manuals.map((manual) => (
          <button
            key={manual.id}
            type="button"
            className="gbc-manual-card"
            onClick={() => openReader(manual.id)}
          >
            <h3>{manual.title}</h3>
            <p>{manual.excerpt}</p>
            <footer>
              <span>@{manual.author}</span>
              <span>{formatShortDate(manual.updatedAt)}</span>
            </footer>
          </button>
        ))}
      </div>
    </div>
  );
}
