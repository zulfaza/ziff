import { appendFileSync, readFileSync } from "node:fs";

function parseArgs(argv) {
  const options = {
    date: undefined,
    runNumber: undefined,
    sha: undefined,
    githubOutput: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--github-output") {
      options.githubOutput = true;
      continue;
    }

    const value = argv[index + 1];
    if (arg === "--date") {
      options.date = value;
      index += 1;
      continue;
    }
    if (arg === "--run-number") {
      options.runNumber = value;
      index += 1;
      continue;
    }
    if (arg === "--sha") {
      options.sha = value;
      index += 1;
    }
  }

  return options;
}

function readBaseVersion() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const stableCore = String(packageJson.version).replace(/[-+].*$/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stableCore);
  if (!match) {
    throw new Error(`Invalid package version '${packageJson.version}'.`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function writeGithubOutput(entries) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }

  appendFileSync(outputPath, entries.map(([key, value]) => `${key}=${value}\n`).join(""));
}

const { date, runNumber, sha, githubOutput } = parseArgs(process.argv.slice(2));
if (!/^\d{8}$/.test(date ?? "")) {
  throw new Error("Expected --date YYYYMMDD.");
}
if (!/^\d+$/.test(runNumber ?? "")) {
  throw new Error("Expected --run-number.");
}
if (!/^[0-9a-f]{7,40}$/i.test(sha ?? "")) {
  throw new Error("Expected --sha.");
}

const baseVersion = readBaseVersion();
const shortSha = sha.slice(0, 12);
const version = `${baseVersion}-nightly.${date}.${runNumber}`;
const tag = `v${version}`;
const name = `Ziff Nightly ${version} (${shortSha})`;

const entries = [
  ["base_version", baseVersion],
  ["version", version],
  ["tag", tag],
  ["name", name],
  ["short_sha", shortSha],
];

if (githubOutput) {
  writeGithubOutput(entries);
} else {
  for (const [key, value] of entries) {
    console.log(`${key}=${value}`);
  }
}
