import { useEffect, useState } from "react";
import { type BundledLanguage, codeToTokens } from "shiki";
import type { FileDiff } from "../shared";

const THEME = "dark-plus";

export type LineToken = {
  content: string;
  color?: string;
};

export interface HighlightIndex {
  getTokens(side: "old" | "new", line: number): readonly LineToken[] | null;
}

const EMPTY_INDEX: HighlightIndex = { getTokens: () => null };

export function useDiffHighlight(diff: FileDiff | null): HighlightIndex {
  const [index, setIndex] = useState<HighlightIndex>(EMPTY_INDEX);

  useEffect(() => {
    if (diff == null || diff.isBinary) {
      setIndex(EMPTY_INDEX);
      return;
    }
    const language = detectLanguage(diff.path);
    if (language == null) {
      setIndex(EMPTY_INDEX);
      return;
    }

    let cancelled = false;
    void buildIndex(diff, language).then((next) => {
      if (!cancelled) {
        setIndex(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [diff]);

  return index;
}

async function buildIndex(diff: FileDiff, language: BundledLanguage): Promise<HighlightIndex> {
  const oldSide = collectLines(diff, "old");
  const newSide = collectLines(diff, "new");
  const [oldTokens, newTokens] = await Promise.all([
    highlight(oldSide.text, language),
    highlight(newSide.text, language),
  ]);
  const oldMap = mapTokens(oldSide.lines, oldTokens);
  const newMap = mapTokens(newSide.lines, newTokens);
  return {
    getTokens: (side, line) => (side === "old" ? oldMap : newMap).get(line) ?? null,
  };
}

function collectLines(diff: FileDiff, side: "old" | "new"): { lines: number[]; text: string } {
  const byLine = new Map<number, string>();
  for (const hunk of diff.hunks) {
    for (const row of hunk.rows) {
      if (side === "old") {
        if (row.kind === "context" || row.kind === "delete") {
          byLine.set(row.oldLine, row.text);
        } else if (row.kind === "modify") {
          byLine.set(row.oldLine, row.oldText);
        }
      } else {
        if (row.kind === "context" || row.kind === "add") {
          byLine.set(row.newLine, row.text);
        } else if (row.kind === "modify") {
          byLine.set(row.newLine, row.newText);
        }
      }
    }
  }
  const lines = [...byLine.keys()].sort((a, b) => a - b);
  const text = lines.map((line) => byLine.get(line) ?? "").join("\n");
  return { lines, text };
}

async function highlight(code: string, language: BundledLanguage): Promise<LineToken[][]> {
  if (code.length === 0) {
    return [];
  }
  try {
    const { tokens } = await codeToTokens(code, { lang: language, theme: THEME });
    return tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color })));
  } catch {
    return [];
  }
}

function mapTokens(lines: readonly number[], tokens: readonly LineToken[][]): Map<number, LineToken[]> {
  const map = new Map<number, LineToken[]>();
  lines.forEach((line, index) => {
    const lineTokens = tokens[index];
    if (lineTokens != null) {
      map.set(line, lineTokens);
    }
  });
  return map;
}

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  astro: "astro",
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dart: "dart",
  elm: "elm",
  ex: "elixir",
  exs: "elixir",
  fish: "fish",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  ml: "ocaml",
  php: "php",
  pl: "perl",
  prisma: "prisma",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "bash",
};

function detectLanguage(path: string): BundledLanguage | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension == null) {
    return null;
  }
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}
