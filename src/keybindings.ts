export const MAX_KEYBINDING_VALUE_LENGTH = 64;
export const MAX_KEYBINDING_WHEN_LENGTH = 256;
export const MAX_WHEN_EXPRESSION_DEPTH = 64;
export const MAX_KEYBINDINGS_COUNT = 64;

export const KEYBINDING_COMMANDS = [
  "sidebar.toggle",
  "menu.project",
  "menu.worktree",
  "menu.branch",
  "settings.open",
  "repo.refresh",
] as const;

export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number];

export interface KeybindingRule {
  key: string;
  command: KeybindingCommand;
  when?: string;
}

export interface KeybindingShortcut {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  modKey: boolean;
}

export type KeybindingWhenNode =
  | { type: "identifier"; name: string }
  | { type: "not"; node: KeybindingWhenNode }
  | { type: "and"; left: KeybindingWhenNode; right: KeybindingWhenNode }
  | { type: "or"; left: KeybindingWhenNode; right: KeybindingWhenNode };

export interface ResolvedKeybindingRule {
  command: KeybindingCommand;
  shortcut: KeybindingShortcut;
  whenAst?: KeybindingWhenNode;
}

export type ResolvedKeybindingsConfig = readonly ResolvedKeybindingRule[];

export const DEFAULT_KEYBINDINGS: readonly KeybindingRule[] = [
  { key: "mod+b", command: "sidebar.toggle" },
  { key: "mod+alt+o", command: "menu.project" },
  { key: "mod+ctrl+w", command: "menu.worktree" },
  { key: "mod+ctrl+b", command: "menu.branch" },
  { key: "mod+,", command: "settings.open" },
  { key: "mod+r", command: "repo.refresh" },
];

type WhenToken =
  | { type: "identifier"; value: string }
  | { type: "not" }
  | { type: "and" }
  | { type: "or" }
  | { type: "lparen" }
  | { type: "rparen" };

function normalizeKeyToken(token: string): string {
  if (token === "space") {
    return " ";
  }
  if (token === "esc") {
    return "escape";
  }
  return token;
}

export function parseKeybindingShortcut(value: string): KeybindingShortcut | null {
  const rawTokens = value
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());
  const tokens = [...rawTokens];
  let trailingEmptyCount = 0;
  while (tokens[tokens.length - 1] === "") {
    trailingEmptyCount += 1;
    tokens.pop();
  }
  if (trailingEmptyCount > 0) {
    tokens.push("+");
  }
  if (tokens.some((token) => token.length === 0)) {
    return null;
  }
  if (tokens.length === 0) {
    return null;
  }

  let key: string | null = null;
  let metaKey = false;
  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;
  let modKey = false;

  for (const token of tokens) {
    switch (token) {
      case "cmd":
      case "meta":
        metaKey = true;
        break;
      case "ctrl":
      case "control":
        ctrlKey = true;
        break;
      case "shift":
        shiftKey = true;
        break;
      case "alt":
      case "option":
        altKey = true;
        break;
      case "mod":
        modKey = true;
        break;
      default: {
        if (key !== null) {
          return null;
        }
        key = normalizeKeyToken(token);
      }
    }
  }

  if (key === null) {
    return null;
  }
  return {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    modKey,
  };
}

function tokenizeWhenExpression(expression: string): WhenToken[] | null {
  const tokens: WhenToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const current = expression[index];
    if (current == null) {
      break;
    }

    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (expression.startsWith("&&", index)) {
      tokens.push({ type: "and" });
      index += 2;
      continue;
    }
    if (expression.startsWith("||", index)) {
      tokens.push({ type: "or" });
      index += 2;
      continue;
    }
    if (current === "!") {
      tokens.push({ type: "not" });
      index += 1;
      continue;
    }
    if (current === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (current === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index));
    if (identifier == null) {
      return null;
    }
    tokens.push({ type: "identifier", value: identifier[0] });
    index += identifier[0].length;
  }

  return tokens;
}

export function parseKeybindingWhenExpression(expression: string): KeybindingWhenNode | null {
  const tokens = tokenizeWhenExpression(expression);
  if (tokens == null || tokens.length === 0) {
    return null;
  }
  let index = 0;

  const parsePrimary = (depth: number): KeybindingWhenNode | null => {
    if (depth > MAX_WHEN_EXPRESSION_DEPTH) {
      return null;
    }
    const token = tokens[index];
    if (token == null) {
      return null;
    }

    if (token.type === "identifier") {
      index += 1;
      return { type: "identifier", name: token.value };
    }

    if (token.type === "lparen") {
      index += 1;
      const expressionNode = parseOr(depth + 1);
      const closeToken = tokens[index];
      if (expressionNode == null || closeToken == null || closeToken.type !== "rparen") {
        return null;
      }
      index += 1;
      return expressionNode;
    }

    return null;
  };

  const parseUnary = (depth: number): KeybindingWhenNode | null => {
    let notCount = 0;
    while (tokens[index]?.type === "not") {
      index += 1;
      notCount += 1;
      if (notCount > MAX_WHEN_EXPRESSION_DEPTH) {
        return null;
      }
    }

    let node = parsePrimary(depth);
    if (node == null) {
      return null;
    }

    while (notCount > 0) {
      node = { type: "not", node };
      notCount -= 1;
    }

    return node;
  };

  const parseAnd = (depth: number): KeybindingWhenNode | null => {
    let left = parseUnary(depth);
    if (left == null) {
      return null;
    }

    while (tokens[index]?.type === "and") {
      index += 1;
      const right = parseUnary(depth);
      if (right == null) {
        return null;
      }
      left = { type: "and", left, right };
    }

    return left;
  };

  const parseOr = (depth: number): KeybindingWhenNode | null => {
    let left = parseAnd(depth);
    if (left == null) {
      return null;
    }

    while (tokens[index]?.type === "or") {
      index += 1;
      const right = parseAnd(depth);
      if (right == null) {
        return null;
      }
      left = { type: "or", left, right };
    }

    return left;
  };

  const abstractSyntaxTree = parseOr(0);
  if (abstractSyntaxTree == null || index !== tokens.length) {
    return null;
  }
  return abstractSyntaxTree;
}

export function compileResolvedKeybindingRule(rule: KeybindingRule): ResolvedKeybindingRule | null {
  const shortcut = parseKeybindingShortcut(rule.key);
  if (shortcut == null) {
    return null;
  }

  if (rule.when != null) {
    const whenAst = parseKeybindingWhenExpression(rule.when);
    if (whenAst == null) {
      return null;
    }
    return {
      command: rule.command,
      shortcut,
      whenAst,
    };
  }

  return {
    command: rule.command,
    shortcut,
  };
}

export function compileResolvedKeybindingsConfig(
  config: readonly KeybindingRule[],
): ResolvedKeybindingsConfig {
  const compiled: ResolvedKeybindingRule[] = [];
  for (const rule of config) {
    const result = compileResolvedKeybindingRule(rule);
    if (result != null) {
      compiled.push(result);
    }
  }
  return compiled.slice(-MAX_KEYBINDINGS_COUNT);
}

export function mergeWithDefaultKeybindings(
  custom: ResolvedKeybindingsConfig,
): ResolvedKeybindingsConfig {
  if (custom.length === 0) {
    return compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);
  }

  const overriddenCommands = new Set(custom.map((binding) => binding.command));
  const retainedDefaults = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS).filter(
    (binding) => !overriddenCommands.has(binding.command),
  );
  const merged = [...retainedDefaults, ...custom];
  if (merged.length <= MAX_KEYBINDINGS_COUNT) {
    return merged;
  }
  return merged.slice(-MAX_KEYBINDINGS_COUNT);
}

export function parseKeybindingRule(value: unknown): KeybindingRule | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  if (!("key" in value) || !("command" in value)) {
    return null;
  }
  if (typeof value.key !== "string" || value.key.trim().length === 0) {
    return null;
  }
  if (value.key.length > MAX_KEYBINDING_VALUE_LENGTH) {
    return null;
  }
  if (!isKeybindingCommand(value.command)) {
    return null;
  }
  if ("when" in value) {
    if (typeof value.when !== "string" || value.when.trim().length === 0) {
      return null;
    }
    if (value.when.length > MAX_KEYBINDING_WHEN_LENGTH) {
      return null;
    }
    if (parseKeybindingWhenExpression(value.when) == null) {
      return null;
    }
    return {
      key: value.key.trim(),
      command: value.command,
      when: value.when.trim(),
    };
  }
  return {
    key: value.key.trim(),
    command: value.command,
  };
}

export function parseKeybindingsConfig(value: unknown): readonly KeybindingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: KeybindingRule[] = [];
  for (const entry of value.slice(0, MAX_KEYBINDINGS_COUNT)) {
    const rule = parseKeybindingRule(entry);
    if (rule != null) {
      rules.push(rule);
    }
  }
  return rules;
}

function isKeybindingCommand(value: unknown): value is KeybindingCommand {
  return typeof value === "string" && KEYBINDING_COMMANDS.includes(value as KeybindingCommand);
}

export function commandLabel(command: KeybindingCommand): string {
  switch (command) {
    case "sidebar.toggle":
      return "Toggle sidebar";
    case "menu.project":
      return "Open project menu";
    case "menu.worktree":
      return "Open worktree menu";
    case "menu.branch":
      return "Open branch menu";
    case "settings.open":
      return "Open settings";
    case "repo.refresh":
      return "Refresh repository";
  }
}
