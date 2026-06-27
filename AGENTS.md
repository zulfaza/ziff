# AGENTS.md

## Coding guidelines
* Prioritize code correctness and clarity. Speed and efficiency are secondary priorities unless otherwise specified.
* Do not write organizational or comments that summarize the code. Comments should only be written in order to explain "why" the code is written in some way in the case there is a reason that is tricky / non-obvious.
* Prefer implementing functionality in existing files unless it is a new logical component. Avoid creating many small files.
* do not run dev server, user already run it, if user haven't run it just tell him to run it
* if there are function that adds no value besides calling another function, then inline
* Avoid creative additions unless explicitly requested
* Use full words for variable names (no abbreviations like "q" for "queue")

## Project Snapshot

Ziff is a local Git diff viewer. This doc tracks what we want to build and what's already in the app.
This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Rules Hygiene

These `.rules` files are read by every agent session. Keep them high-signal.

### After any agentic session
If you discover a non-obvious pattern that would help future sessions, include a **"Suggested .rules additions"** heading in your PR description with the proposed text. Do **not** edit `.rules` inline during normal feature/fix work. Reviewers decide what gets merged.

### High bar for new rules
Editing or clarifying existing rules is always welcome. New rules must meet **all three** criteria:
1. **Non-obvious** — someone familiar with the codebase would still get it wrong without the rule.
2. **Repeatedly encountered** — it came up more than once (multiple hits in one session counts).
3. **Specific enough to act on** — a concrete instruction, not a vague principle.

Rules that apply to a single crate belong in that crate's own `.rules` file, not the repo root.

### What NOT to put in `.rules`
Avoid architectural descriptions of a crate (module layout, data flow, key types). These go stale fast and the agent can gather them by reading the code. Rules should be **traps to avoid**, not **maps to follow**.

### No drive-by additions
Rules emerge from validated patterns, not one-off observations. The workflow is:
1. Agent notes a pattern during a session.
2. Team validates the pattern in code review.
3. A dedicated commit adds the rule with context on *why* it exists.
