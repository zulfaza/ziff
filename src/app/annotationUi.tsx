import { Bot, Check, Copy, MessageSquare, Trash2, X } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  annotationsEndingAtLine,
  annotationsForLine,
  createAnnotation,
  exportAgentPrompt,
  exportReviewMarkdown,
  filterAnnotations,
  type LineSelection,
} from "./annotations";
import { getBasename } from "./diffModel";
import type { Annotation, AnnotationKind, AnnotationSide, DiffComparison } from "../shared";

interface FileAnnotationContextValue {
  filePath: string;
  annotations: readonly Annotation[];
  selectedAnnotationId: string | null;
  pendingSelection: LineSelection | null;
  onLineNumberClick(side: AnnotationSide, line: number, extend: boolean): void;
  onSelectAnnotation(id: string | null): void;
  onSaveAnnotation(input: {
    kind: AnnotationKind;
    body: string;
    selection: LineSelection;
    editingId?: string | null;
  }): void;
  onDeleteAnnotation(id: string): void;
  onToggleResolved(id: string): void;
  onDismissComposer(): void;
}

const FileAnnotationContext = createContext<FileAnnotationContextValue | null>(null);

export function FileAnnotationProvider({
  annotations,
  children,
  filePath,
  onChange,
  onSelectAnnotation,
  selectedAnnotationId,
}: {
  annotations: readonly Annotation[];
  children: ReactNode;
  filePath: string;
  onChange(next: readonly Annotation[]): void;
  onSelectAnnotation(id: string | null): void;
  selectedAnnotationId: string | null;
}) {
  const [pendingSelection, setPendingSelection] = useState<LineSelection | null>(null);
  const fileAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.filePath === filePath),
    [annotations, filePath],
  );

  useEffect(() => {
    setPendingSelection(null);
  }, [filePath]);

  const onLineNumberClick = useCallback(
    (side: AnnotationSide, line: number, extend: boolean) => {
      setPendingSelection((current) => {
        if (extend && current != null && current.side === side) {
          return { side, start: current.start, end: line };
        }
        return { side, start: line, end: line };
      });
      onSelectAnnotation(null);
    },
    [onSelectAnnotation],
  );

  const onDismissComposer = useCallback(() => {
    setPendingSelection(null);
  }, []);

  const onSaveAnnotation = useCallback(
    (input: {
      kind: AnnotationKind;
      body: string;
      selection: LineSelection;
      editingId?: string | null;
    }) => {
      const trimmed = input.body.trim();
      if (trimmed.length === 0) {
        return;
      }

      const start = Math.min(input.selection.start, input.selection.end);
      const end = Math.max(input.selection.start, input.selection.end);

      if (input.editingId != null) {
        onChange(
          annotations.map((annotation) =>
            annotation.id === input.editingId
              ? { ...annotation, kind: input.kind, body: trimmed, lineStart: start, lineEnd: end }
              : annotation,
          ),
        );
        onSelectAnnotation(input.editingId);
      } else {
        const next = createAnnotation({
          filePath,
          side: input.selection.side,
          lineStart: start,
          lineEnd: end,
          kind: input.kind,
          body: trimmed,
        });
        onChange([...annotations, next]);
        onSelectAnnotation(next.id);
      }

      setPendingSelection(null);
    },
    [annotations, filePath, onChange, onSelectAnnotation],
  );

  const onDeleteAnnotation = useCallback(
    (id: string) => {
      onChange(annotations.filter((annotation) => annotation.id !== id));
      if (selectedAnnotationId === id) {
        onSelectAnnotation(null);
      }
    },
    [annotations, onChange, onSelectAnnotation, selectedAnnotationId],
  );

  const onToggleResolved = useCallback(
    (id: string) => {
      onChange(
        annotations.map((annotation) =>
          annotation.id === id ? { ...annotation, resolved: !annotation.resolved } : annotation,
        ),
      );
    },
    [annotations, onChange],
  );

  const value = useMemo(
    () => ({
      filePath,
      annotations: fileAnnotations,
      selectedAnnotationId,
      pendingSelection,
      onLineNumberClick,
      onSelectAnnotation,
      onSaveAnnotation,
      onDeleteAnnotation,
      onToggleResolved,
      onDismissComposer,
    }),
    [
      fileAnnotations,
      filePath,
      onDeleteAnnotation,
      onDismissComposer,
      onLineNumberClick,
      onSaveAnnotation,
      onSelectAnnotation,
      onToggleResolved,
      pendingSelection,
      selectedAnnotationId,
    ],
  );

  return (
    <FileAnnotationContext.Provider value={value}>
      {children}
      {pendingSelection != null ? <AnnotationComposer /> : null}
    </FileAnnotationContext.Provider>
  );
}

function useFileAnnotations(): FileAnnotationContextValue {
  const value = useContext(FileAnnotationContext);
  if (value == null) {
    throw new Error("FileAnnotationProvider is required");
  }
  return value;
}

export function useOptionalFileAnnotations(): FileAnnotationContextValue | null {
  return useContext(FileAnnotationContext);
}

function AnnotationComposer() {
  const { pendingSelection, onDismissComposer, onSaveAnnotation } = useFileAnnotations();
  const [kind, setKind] = useState<AnnotationKind>("review");
  const [body, setBody] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setKind("review");
    setBody("");
  }, [pendingSelection]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [pendingSelection]);

  if (pendingSelection == null) {
    return null;
  }

  const start = Math.min(pendingSelection.start, pendingSelection.end);
  const end = Math.max(pendingSelection.start, pendingSelection.end);
  const lineLabel =
    start === end ? `line ${start}` : `lines ${start}-${end}`;
  const sideLabel = pendingSelection.side === "old" ? "before" : "after";

  return (
    <section className="annotation-composer" aria-label="Add annotation">
      <header className="annotation-composer-header">
        <span>
          {sideLabel}, {lineLabel}
        </span>
        <button aria-label="Close composer" className="icon-button" onClick={onDismissComposer}>
          <X size={14} />
        </button>
      </header>
      <div className="annotation-kind-toggle" role="group" aria-label="Annotation kind">
        <button
          className={kind === "review" ? "active" : ""}
          onClick={() => setKind("review")}
          type="button"
        >
          <MessageSquare size={14} />
          Review
        </button>
        <button
          className={kind === "agent" ? "active" : ""}
          onClick={() => setKind("agent")}
          type="button"
        >
          <Bot size={14} />
          Agent prompt
        </button>
      </div>
      <textarea
        onChange={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDismissComposer();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSaveAnnotation({
              kind,
              body,
              selection: pendingSelection,
            });
          }
        }}
        placeholder={
          kind === "agent"
            ? "Instruction for a coding agent..."
            : "Review note or question..."
        }
        ref={textareaRef}
        rows={4}
        value={body}
      />
      <footer className="annotation-composer-actions">
        <button className="link-button" onClick={onDismissComposer} type="button">
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={body.trim().length === 0}
          onClick={() =>
            onSaveAnnotation({
              kind,
              body,
              selection: pendingSelection,
            })
          }
          type="button"
        >
          Save
        </button>
      </footer>
    </section>
  );
}

export function AnnotationInlineCards({
  line,
  mode,
  side,
}: {
  line: number;
  mode: "split" | "stacked";
  side: AnnotationSide;
}) {
  const context = useOptionalFileAnnotations();
  if (context == null) {
    return null;
  }

  const cards = annotationsEndingAtLine(context.annotations, side, line);
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className={mode === "split" ? "annotation-inline-row split" : "annotation-inline-row stacked"}>
      {mode === "split" ? (
        <>
          <div className="annotation-inline-slot old">
            {side === "old"
              ? cards.map((annotation) => (
                  <AnnotationCard annotation={annotation} key={annotation.id} />
                ))
              : null}
          </div>
          <div className="annotation-inline-slot new">
            {side === "new"
              ? cards.map((annotation) => (
                  <AnnotationCard annotation={annotation} key={annotation.id} />
                ))
              : null}
          </div>
        </>
      ) : (
        cards.map((annotation) => <AnnotationCard annotation={annotation} key={annotation.id} />)
      )}
    </div>
  );
}

function AnnotationCard({ annotation }: { annotation: Annotation }) {
  const { onDeleteAnnotation, onSelectAnnotation, onToggleResolved, selectedAnnotationId } =
    useFileAnnotations();
  const selected = selectedAnnotationId === annotation.id;

  return (
    <article
      className={selected ? "annotation-card selected" : "annotation-card"}
      data-annotation-id={annotation.id}
      onClick={() => onSelectAnnotation(annotation.id)}
    >
      <header className="annotation-card-header">
        <span className={`annotation-kind-badge ${annotation.kind}`}>
          {annotation.kind === "agent" ? "Agent" : "Review"}
        </span>
        {annotation.resolved ? <span className="annotation-resolved-badge">Resolved</span> : null}
        <span className="annotation-card-actions">
          <button
            aria-label={annotation.resolved ? "Mark unresolved" : "Mark resolved"}
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleResolved(annotation.id);
            }}
            type="button"
          >
            <Check size={13} />
          </button>
          <button
            aria-label="Delete annotation"
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteAnnotation(annotation.id);
            }}
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </header>
      <p>{annotation.body}</p>
    </article>
  );
}

export function AnnotationsPanel({
  annotations,
  comparison,
  onDeleteAnnotation,
  onSelectAnnotation,
  onToggleResolved,
  selectedAnnotationId,
}: {
  annotations: readonly Annotation[];
  comparison: DiffComparison;
  onDeleteAnnotation(id: string): void;
  onSelectAnnotation(id: string): void;
  onToggleResolved(id: string): void;
  selectedAnnotationId: string | null;
}) {
  const [kindFilter, setKindFilter] = useState<AnnotationKind | "all">("all");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const visible = useMemo(
    () =>
      filterAnnotations(annotations, {
        kind: kindFilter,
        includeResolved: false,
      }),
    [annotations, kindFilter],
  );
  const allVisible = useMemo(
    () => filterAnnotations(annotations, { kind: kindFilter, includeResolved: false }),
    [annotations, kindFilter],
  );

  useEffect(() => {
    if (copyMessage == null) {
      return;
    }
    const timer = window.setTimeout(() => setCopyMessage(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyMessage]);

  async function copyExport(build: (items: readonly Annotation[]) => string, emptyLabel: string) {
    const text = build(allVisible);
    if (text.length === 0) {
      setCopyMessage(emptyLabel);
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopyMessage("Copied to clipboard");
  }

  return (
    <section className="annotations-panel">
      <div className="annotations-panel-toolbar">
        <div className="segmented" aria-label="Annotation filter">
          <button
            className={kindFilter === "all" ? "active" : ""}
            onClick={() => setKindFilter("all")}
            type="button"
          >
            All
          </button>
          <button
            className={kindFilter === "review" ? "active" : ""}
            onClick={() => setKindFilter("review")}
            type="button"
          >
            Review
          </button>
          <button
            className={kindFilter === "agent" ? "active" : ""}
            onClick={() => setKindFilter("agent")}
            type="button"
          >
            Agent
          </button>
        </div>
      </div>
      <div className="annotations-panel-actions">
        <button
          className="link-button"
          onClick={() => void copyExport((items) => exportReviewMarkdown(items, comparison), "No review notes")}
          type="button"
        >
          <Copy size={13} />
          Copy review
        </button>
        <button
          className="link-button"
          onClick={() => void copyExport((items) => exportAgentPrompt(items, comparison), "No agent prompts")}
          type="button"
        >
          <Copy size={13} />
          Copy agent prompt
        </button>
      </div>
      {copyMessage != null ? <div className="annotations-copy-message">{copyMessage}</div> : null}
      <div className="annotations-list">
        {visible.length === 0 ? (
          <div className="annotations-empty">
            Click a line number in the diff to add a review note or agent prompt.
          </div>
        ) : (
          visible.map((annotation) => (
            <button
              className={
                annotation.id === selectedAnnotationId
                  ? "annotation-list-row active"
                  : "annotation-list-row"
              }
              key={annotation.id}
              onClick={() => onSelectAnnotation(annotation.id)}
              type="button"
            >
              <span className="annotation-list-row-top">
                <span className={`annotation-kind-badge ${annotation.kind}`}>
                  {annotation.kind === "agent" ? "Agent" : "Review"}
                </span>
                <span className="annotation-list-file">{getBasename(annotation.filePath)}</span>
              </span>
              <span className="annotation-list-location">
                {annotation.side === "old" ? "before" : "after"} ·{" "}
                {annotation.lineStart === annotation.lineEnd
                  ? `line ${annotation.lineStart}`
                  : `lines ${annotation.lineStart}-${annotation.lineEnd}`}
              </span>
              <span className="annotation-list-body">{annotation.body}</span>
              <span className="annotation-list-row-actions">
                <button
                  aria-label={annotation.resolved ? "Mark unresolved" : "Mark resolved"}
                  className="icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleResolved(annotation.id);
                  }}
                  type="button"
                >
                  <Check size={13} />
                </button>
                <button
                  aria-label="Delete annotation"
                  className="icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteAnnotation(annotation.id);
                  }}
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export function annotationMarkerCount(
  annotations: readonly Annotation[],
  side: AnnotationSide,
  line: number,
): number {
  return annotationsForLine(annotations, side, line).length;
}

export function scrollToAnnotation(id: string): void {
  const element = document.querySelector(`[data-annotation-id="${id}"]`);
  element?.scrollIntoView({ block: "center", inline: "nearest" });
}
