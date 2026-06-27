import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const options = {
    platform: undefined,
    inputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") {
      options.platform = argv[index + 1];
      index += 1;
      continue;
    }

    options.inputs.push(arg);
  }

  return options;
}

function parseManifest(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const entries = new Map();

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    entries.set(key, value);
  }

  return entries;
}

function serializeManifest(entries) {
  const order = ["version", "files", "path", "sha512", "releaseDate"];
  const lines = [];

  for (const key of order) {
    if (entries.has(key)) {
      lines.push(`${key}: ${entries.get(key)}`);
    }
  }

  for (const [key, value] of entries) {
    if (order.includes(key)) {
      continue;
    }
    lines.push(`${key}: ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

function mergeMacManifests(arm64Path, x64Path) {
  const arm64 = parseManifest(arm64Path);
  const x64 = parseManifest(x64Path);
  const mergedFiles = [];

  for (const fileEntry of JSON.parse(arm64.get("files") ?? "[]")) {
    mergedFiles.push(fileEntry);
  }

  for (const fileEntry of JSON.parse(x64.get("files") ?? "[]")) {
    mergedFiles.push(fileEntry);
  }

  arm64.set("files", JSON.stringify(mergedFiles));
  writeFileSync(arm64Path, serializeManifest(arm64));
}

const { platform, inputs } = parseArgs(process.argv.slice(2));
if (platform !== "mac") {
  throw new Error(`Unsupported platform '${platform}'.`);
}
if (inputs.length !== 2) {
  throw new Error("Expected two manifest paths.");
}

mergeMacManifests(inputs[0], inputs[1]);
