import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const options = {
    channel: "stable",
    currentTag: undefined,
    githubOutput: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--github-output") {
      options.githubOutput = true;
      continue;
    }

    const value = argv[index + 1];
    if (arg === "--channel") {
      options.channel = value;
      index += 1;
      continue;
    }
    if (arg === "--current-tag") {
      options.currentTag = value;
      index += 1;
    }
  }

  return options;
}

function listTags() {
  const result = spawnSync("git", ["tag", "--list"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to list git tags.");
  }

  return result.stdout
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parseStableTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!match) {
    return undefined;
  }

  const [, major, minor, patch, prerelease] = match;
  const prereleaseIdentifiers = prerelease ? prerelease.split(".") : [];
  if (prereleaseIdentifiers[0] === "nightly") {
    return undefined;
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseIdentifiers,
  };
}

function parseNightlyTag(tag) {
  const match = /^(?:nightly-)?v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/.exec(tag);
  if (!match) {
    return undefined;
  }

  const [, major, minor, patch, date, runNumber] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    date: Number(date),
    runNumber: Number(runNumber),
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumeric = /^\d+$/.test(right) ? Number(right) : undefined;

  if (leftNumeric !== undefined && rightNumeric !== undefined) {
    return leftNumeric - rightNumeric;
  }
  if (leftNumeric !== undefined) {
    return -1;
  }
  if (rightNumeric !== undefined) {
    return 1;
  }
  return left.localeCompare(right);
}

function compareStableVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;
  if (!leftHasPrerelease && !rightHasPrerelease) return 0;
  if (!leftHasPrerelease) return 1;
  if (!rightHasPrerelease) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function compareNightlyVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.date !== right.date) return left.date - right.date;
  return left.runNumber - right.runNumber;
}

function resolvePreviousReleaseTag(channel, currentTag, tags) {
  if (channel === "stable") {
    const current = parseStableTag(currentTag);
    if (!current) {
      throw new Error(`Invalid stable release tag '${currentTag}'.`);
    }

    const candidates = tags
      .map((tag) => ({ tag, version: parseStableTag(tag) }))
      .filter((entry) => entry.version != null)
      .filter((entry) => compareStableVersions(entry.version, current) < 0)
      .sort((left, right) => compareStableVersions(right.version, left.version));

    return candidates[0]?.tag ?? "";
  }

  const current = parseNightlyTag(currentTag);
  if (!current) {
    throw new Error(`Invalid nightly release tag '${currentTag}'.`);
  }

  const candidates = tags
    .map((tag) => ({ tag, version: parseNightlyTag(tag) }))
    .filter((entry) => entry.version != null)
    .filter((entry) => compareNightlyVersions(entry.version, current) < 0)
    .sort((left, right) => compareNightlyVersions(right.version, left.version));

  return candidates[0]?.tag ?? "";
}

function writeGithubOutput(previousTag) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }

  appendFileSync(outputPath, `previous_tag=${previousTag}\n`);
}

const { channel, currentTag, githubOutput } = parseArgs(process.argv.slice(2));
if (!currentTag) {
  throw new Error("Expected --current-tag.");
}
if (channel !== "stable" && channel !== "nightly") {
  throw new Error(`Unsupported channel '${channel}'.`);
}

const previousTag = resolvePreviousReleaseTag(channel, currentTag, listTags());

if (githubOutput) {
  writeGithubOutput(previousTag);
} else {
  console.log(`previous_tag=${previousTag}`);
}
