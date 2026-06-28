import type { Annotation, AnnotationKind, AnnotationSide, DiffComparison } from "../shared";

export interface LineSelection {
  side: AnnotationSide;
  start: number;
  end: number;
}

export interface AnnotationStoreDocument {
  version: 1;
  comparison: DiffComparison;
  annotations: Annotation[];
}

export interface AnnotationStoreFile {
  version: 1;
  sessions: Record<string, AnnotationStoreDocument>;
}

export function comparisonKey(comparison: DiffComparison): string {
  if (comparison.type === "working-tree") {
    return "working-tree";
  }
  if (comparison.type === "branch") {
    return `branch:${comparison.base}...${comparison.head}`;
  }
  return `commit:${comparison.hash}`;
}

export function describeComparison(comparison: DiffComparison): string {
  if (comparison.type === "working-tree") {
    return "Working tree changes";
  }
  if (comparison.type === "branch") {
    return `Branch diff \`${comparison.base}\` → \`${comparison.head}\``;
  }
  return `Commit \`${comparison.hash.slice(0, 7)}\``;
}

export function createAnnotation(input: {
  filePath: string;
  side: AnnotationSide;
  lineStart: number;
  lineEnd: number;
  kind: AnnotationKind;
  body: string;
  author?: string;
}): Annotation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    filePath: input.filePath,
    side: input.side,
    lineStart: Math.min(input.lineStart, input.lineEnd),
    lineEnd: Math.max(input.lineStart, input.lineEnd),
    kind: input.kind,
    body: input.body.trim(),
    createdAt: now,
    author: input.author,
    resolved: false,
  };
}

export function normalizeSelection(selection: LineSelection): LineSelection {
  return {
    side: selection.side,
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  };
}

export function selectionKey(filePath: string, selection: LineSelection): string {
  const normalized = normalizeSelection(selection);
  return `${filePath}:${normalized.side}:${normalized.start}-${normalized.end}`;
}

export function annotationsForLine(
  annotations: readonly Annotation[],
  side: AnnotationSide,
  line: number,
): Annotation[] {
  return annotations.filter(
    (annotation) =>
      annotation.side === side && line >= annotation.lineStart && line <= annotation.lineEnd,
  );
}

export function annotationsEndingAtLine(
  annotations: readonly Annotation[],
  side: AnnotationSide,
  line: number,
): Annotation[] {
  return annotations.filter((annotation) => annotation.side === side && annotation.lineEnd === line);
}

export function sortAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }
    if (left.lineStart !== right.lineStart) {
      return left.lineStart - right.lineStart;
    }
    if (left.lineEnd !== right.lineEnd) {
      return left.lineEnd - right.lineEnd;
    }
    return left.createdAt - right.createdAt;
  });
}

export function filterAnnotations(
  annotations: readonly Annotation[],
  options: {
    filePath?: string | null;
    kind?: AnnotationKind | "all";
    includeResolved?: boolean;
  },
): Annotation[] {
  return sortAnnotations(annotations).filter((annotation) => {
    if (options.filePath != null && annotation.filePath !== options.filePath) {
      return false;
    }
    if (options.kind != null && options.kind !== "all" && annotation.kind !== options.kind) {
      return false;
    }
    if (!options.includeResolved && annotation.resolved) {
      return false;
    }
    return true;
  });
}

function formatLineLocation(annotation: Annotation): string {
  const lineRange =
    annotation.lineStart === annotation.lineEnd
      ? `line ${annotation.lineStart}`
      : `lines ${annotation.lineStart}-${annotation.lineEnd}`;
  const sideLabel = annotation.side === "old" ? "before" : "after";
  return `${annotation.filePath} (${sideLabel}, ${lineRange})`;
}

export function exportReviewMarkdown(
  annotations: readonly Annotation[],
  comparison: DiffComparison,
): string {
  const active = filterAnnotations(annotations, { includeResolved: false });
  if (active.length === 0) {
    return "";
  }

  let output = `# Code review notes\n\n`;
  output += `**Diff context:** ${describeComparison(comparison)}\n\n`;
  output += `I've reviewed the diff and have ${active.length} note${active.length === 1 ? "" : "s"}:\n\n`;

  let index = 1;
  let currentFile: string | null = null;
  for (const annotation of active) {
    if (annotation.filePath !== currentFile) {
      currentFile = annotation.filePath;
      output += `## ${currentFile}\n\n`;
    }
    const kindLabel = annotation.kind === "agent" ? "Agent prompt" : "Review";
    output += `### ${index}. ${kindLabel} — ${formatLineLocation(annotation)}\n\n`;
    output += `${annotation.body}\n\n`;
    index += 1;
  }

  return output.trimEnd();
}

export function exportAgentPrompt(
  annotations: readonly Annotation[],
  comparison: DiffComparison,
): string {
  const prompts = filterAnnotations(annotations, { kind: "agent", includeResolved: false });
  if (prompts.length === 0) {
    return "";
  }

  let output = `Please address the following review prompts for this diff.\n\n`;
  output += `Diff context: ${describeComparison(comparison)}\n\n`;

  prompts.forEach((annotation, index) => {
    output += `## Task ${index + 1}: ${formatLineLocation(annotation)}\n\n`;
    output += `${annotation.body}\n\n`;
  });

  return output.trimEnd();
}

export function parseAnnotationStore(raw: unknown): AnnotationStoreFile {
  if (typeof raw !== "object" || raw == null) {
    return { version: 1, sessions: {} };
  }

  if (!("sessions" in raw) || typeof raw.sessions !== "object" || raw.sessions == null) {
    return { version: 1, sessions: {} };
  }

  const sessions: Record<string, AnnotationStoreDocument> = {};
  for (const [key, value] of Object.entries(raw.sessions)) {
    const document = parseAnnotationStoreDocument(value);
    if (document != null) {
      sessions[key] = document;
    }
  }

  return { version: 1, sessions };
}

function parseAnnotationStoreDocument(value: unknown): AnnotationStoreDocument | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }

  const comparison = "comparison" in value ? parseComparison(value.comparison) : null;
  if (comparison == null) {
    return null;
  }

  const annotations = "annotations" in value && Array.isArray(value.annotations)
    ? value.annotations.flatMap((item) => {
        const annotation = parseAnnotation(item);
        return annotation == null ? [] : [annotation];
      })
    : [];

  return { version: 1, comparison, annotations };
}

function parseComparison(value: unknown): DiffComparison | null {
  if (typeof value !== "object" || value == null || !("type" in value)) {
    return null;
  }

  if (value.type === "working-tree") {
    return { type: "working-tree" };
  }

  if (
    value.type === "branch" &&
    "base" in value &&
    typeof value.base === "string" &&
    "head" in value &&
    typeof value.head === "string"
  ) {
    return { type: "branch", base: value.base, head: value.head };
  }

  if (value.type === "commit" && "hash" in value && typeof value.hash === "string") {
    return { type: "commit", hash: value.hash };
  }

  return null;
}

function parseAnnotation(value: unknown): Annotation | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }

  if (
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("filePath" in value) ||
    typeof value.filePath !== "string" ||
    !("side" in value) ||
    (value.side !== "old" && value.side !== "new") ||
    !("lineStart" in value) ||
    typeof value.lineStart !== "number" ||
    !("lineEnd" in value) ||
    typeof value.lineEnd !== "number" ||
    !("kind" in value) ||
    (value.kind !== "review" && value.kind !== "agent") ||
    !("body" in value) ||
    typeof value.body !== "string" ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }

  return {
    id: value.id,
    filePath: value.filePath,
    side: value.side,
    lineStart: value.lineStart,
    lineEnd: value.lineEnd,
    kind: value.kind,
    body: value.body,
    createdAt: value.createdAt,
    author: "author" in value && typeof value.author === "string" ? value.author : undefined,
    resolved: "resolved" in value && value.resolved === true,
  };
}
