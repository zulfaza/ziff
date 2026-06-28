import type {
  Annotation,
  AnnotationAuthor,
  AnnotationKind,
  AnnotationSide,
  AnnotationStatus,
  DiffComparison,
  RepoInfo,
} from "./shared";

export interface AnnotationStore {
  annotations: readonly Annotation[];
  version: 1;
}

export function getAnnotationAnchorKey(file: string, line: number, side: AnnotationSide): string {
  return `${side}\0${line}\0${file}`;
}

export function isLineInAnnotationRange(
  annotation: Annotation,
  file: string,
  line: number,
  side: AnnotationSide,
): boolean {
  return (
    annotation.file === file &&
    annotation.side === side &&
    line >= annotation.lineStart &&
    line <= annotation.lineEnd
  );
}

export function getComparisonKey(comparison: DiffComparison): string {
  switch (comparison.type) {
    case "working-tree":
      return "working-tree";
    case "branch":
      return `branch\0${comparison.base}\0${comparison.head}`;
    case "commit":
      return `commit\0${comparison.hash}`;
  }
}

export function formatComparisonLabel(comparison: DiffComparison): string {
  switch (comparison.type) {
    case "working-tree":
      return "Working tree";
    case "branch":
      return `${comparison.base}...${comparison.head}`;
    case "commit":
      return comparison.hash.slice(0, 12);
  }
}

export function parseAnnotationStore(value: unknown): AnnotationStore {
  if (typeof value !== "object" || value == null || !("annotations" in value)) {
    return { version: 1, annotations: [] };
  }
  if (!Array.isArray(value.annotations)) {
    return { version: 1, annotations: [] };
  }
  return {
    version: 1,
    annotations: value.annotations.flatMap((item): readonly Annotation[] => {
      const annotation = parseAnnotation(item);
      return annotation == null ? [] : [annotation];
    }),
  };
}

export function parseAnnotation(value: unknown): Annotation | null {
  if (
    typeof value !== "object" ||
    value == null ||
    !("id" in value) ||
    !("file" in value) ||
    !("side" in value) ||
    !("kind" in value) ||
    !("body" in value) ||
    !("comparison" in value) ||
    !("createdAt" in value) ||
    !("status" in value)
  ) {
    return null;
  }

  const id = parseNonEmptyString(value.id);
  const file = parseNonEmptyString(value.file);
  const lineRange = parseAnnotationLineRange(value);
  const side = parseAnnotationSide(value.side);
  const kind = parseAnnotationKind(value.kind);
  const body = parseNonEmptyString(value.body);
  const comparison = parseComparison(value.comparison);
  const createdAt = parseNonEmptyString(value.createdAt);
  const status = parseAnnotationStatus(value.status);
  if (
    id == null ||
    file == null ||
    lineRange == null ||
    side == null ||
    kind == null ||
    body == null ||
    comparison == null ||
    createdAt == null ||
    status == null
  ) {
    return null;
  }

  const annotation: Annotation = {
    id,
    file,
    lineStart: lineRange.start,
    lineEnd: lineRange.end,
    side,
    kind,
    body,
    comparison,
    createdAt,
    status,
  };
  const author = "author" in value ? parseAnnotationAuthor(value.author) : undefined;
  return author == null ? annotation : { ...annotation, author };
}

export function parseAnnotationAuthor(value: unknown): AnnotationAuthor | undefined {
  if (typeof value === "string") {
    const name = parseNonEmptyString(value);
    return name == null ? undefined : { name, avatarUrl: null };
  }
  if (typeof value !== "object" || value == null || !("name" in value)) {
    return undefined;
  }

  const name = parseNonEmptyString(value.name);
  if (name == null) {
    return undefined;
  }
  const avatarUrl =
    "avatarUrl" in value && typeof value.avatarUrl === "string" && value.avatarUrl.length > 0
      ? value.avatarUrl
      : null;
  return { name, avatarUrl };
}

export function parseComparison(value: unknown): DiffComparison | null {
  if (typeof value !== "object" || value == null || !("type" in value)) {
    return null;
  }

  if (value.type === "working-tree") {
    return { type: "working-tree" };
  }
  if (value.type === "branch" && "base" in value && "head" in value) {
    const base = parseRef(value.base);
    const head = parseRef(value.head);
    return base == null || head == null ? null : { type: "branch", base, head };
  }
  if (value.type === "commit" && "hash" in value) {
    const hash = parseRef(value.hash);
    return hash == null ? null : { type: "commit", hash };
  }
  return null;
}

export function parseAnnotationKind(value: unknown): AnnotationKind | null {
  return value === "agent-prompt" || value === "review" ? value : null;
}

export function parseAnnotationSide(value: unknown): AnnotationSide | null {
  return value === "old" || value === "new" ? value : null;
}

export function parseAnnotationStatus(value: unknown): AnnotationStatus | null {
  if (typeof value !== "object" || value == null || !("state" in value)) {
    return null;
  }
  if (value.state === "open") {
    return { state: "open" };
  }
  if (value.state === "resolved" && "resolvedAt" in value) {
    const resolvedAt = parseNonEmptyString(value.resolvedAt);
    return resolvedAt == null ? null : { state: "resolved", resolvedAt };
  }
  return null;
}

export function formatAnnotationsForAgentPrompt(
  annotations: readonly Annotation[],
  comparison: DiffComparison,
  info: RepoInfo,
): string {
  const sorted = [...annotations].toSorted(compareAnnotations);
  if (sorted.length === 0) {
    return "# Ziff Annotations\n\nNo annotations selected.";
  }

  let output =
    `# Ziff Annotations\n\n` +
    `Repository: ${info.projectName}\n` +
    `Path: ${info.path}\n` +
    `Diff: ${formatComparisonLabel(comparison)}\n\n`;
  let currentFile: string | null = null;
  for (const annotation of sorted) {
    if (annotation.file !== currentFile) {
      currentFile = annotation.file;
      output += `## ${annotation.file}\n\n`;
    }

    output +=
      `### ${formatKind(annotation.kind)} on ${annotation.side} ${formatLineRange(annotation)}\n\n` +
      `${annotation.body}\n\n`;
  }
  return output.trimEnd();
}

function compareAnnotations(left: Annotation, right: Annotation): number {
  const fileOrder = left.file.localeCompare(right.file, undefined, { sensitivity: "base" });
  if (fileOrder !== 0) {
    return fileOrder;
  }
  if (left.lineStart !== right.lineStart) {
    return left.lineStart - right.lineStart;
  }
  if (left.lineEnd !== right.lineEnd) {
    return left.lineEnd - right.lineEnd;
  }
  if (left.side !== right.side) {
    return left.side === "old" ? -1 : 1;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

function formatKind(kind: AnnotationKind): string {
  return kind === "agent-prompt" ? "Agent prompt" : "Review";
}

function formatLineRange(annotation: Annotation): string {
  return annotation.lineStart === annotation.lineEnd
    ? `line ${annotation.lineStart}`
    : `lines ${annotation.lineStart}-${annotation.lineEnd}`;
}

function parseAnnotationLineRange(value: object): { end: number; start: number } | null {
  if ("lineStart" in value || "lineEnd" in value) {
    if (!("lineStart" in value) || !("lineEnd" in value)) {
      return null;
    }
    const lineStart = parsePositiveInteger(value.lineStart);
    const lineEnd = parsePositiveInteger(value.lineEnd);
    if (lineStart == null || lineEnd == null || lineStart > lineEnd) {
      return null;
    }
    return { start: lineStart, end: lineEnd };
  }
  if (!("line" in value)) {
    return null;
  }
  const line = parsePositiveInteger(value.line);
  return line == null ? null : { start: line, end: line };
}

function parseRef(value: unknown): string | null {
  const text = parseNonEmptyString(value);
  return text == null || text.includes("\0") ? null : text;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
