import type { Dispatch, SetStateAction } from "react";
import type { RecentProject } from "./types";

const recentProjectsKey = "ziff.recentProjects";

export function rememberProject(
  name: string,
  path: string,
  setRecentProjects: Dispatch<SetStateAction<readonly RecentProject[]>>,
): void {
  setRecentProjects((current) => {
    const next = [{ name, path }, ...current.filter((project) => project.path !== path)].slice(
      0,
      12,
    );
    writeRecentProjects(next);
    return next;
  });
}

export function readRecentProjects(): readonly RecentProject[] {
  try {
    const raw = localStorage.getItem(recentProjectsKey);
    if (raw == null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((value): readonly RecentProject[] => {
      const project = parseRecentProject(value);
      return project == null ? [] : [project];
    });
  } catch {
    return [];
  }
}

function writeRecentProjects(projects: readonly RecentProject[]): void {
  try {
    localStorage.setItem(recentProjectsKey, JSON.stringify(projects));
  } catch {
    return;
  }
}

function parseRecentProject(value: unknown): RecentProject | null {
  if (
    typeof value !== "object" ||
    value == null ||
    !("name" in value) ||
    !("path" in value) ||
    typeof value.name !== "string" ||
    typeof value.path !== "string"
  ) {
    return null;
  }
  return { name: value.name, path: value.path };
}
