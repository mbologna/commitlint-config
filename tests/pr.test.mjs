// bin/commitlint-pr: a stub gh on PATH answers like the API: the pull request's
// commits, a compare of a push range, or one commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/commitlint-pr.mjs", import.meta.url));

const json = (messages) =>
  messages
    .map((message, i) => JSON.stringify({ sha: `${i}`.repeat(40), message }))
    .join("\n");

// answers: {pulls, compare, commit}: the lines each endpoint prints, or null to fail
function run(env, answers) {
  const dir = mkdtempSync(join(tmpdir(), "pr-"));
  const branch = (key, pattern) =>
    answers[key] === null
      ? `  *${pattern}*) echo "HTTP 404" >&2; exit 1 ;;`
      : `  *${pattern}*) cat <<'JSON'\n${answers[key] ?? ""}\nJSON\n  ;;`;
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh\ncase "$*" in\n${branch("pulls", "/pulls/")}\n${branch("compare", "/compare/")}\n${branch("commit", "/commits/")}\nesac\n`
  );
  chmodSync(join(dir, "gh"), 0o755);
  const r = spawnSync(process.execPath, [BIN], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: "o/r",
      NO_COLOR: "1",
      ...env,
    },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("pull request: good commits pass", () => {
  const r = run(
    { PR: "1" },
    { pulls: json(["feat: add x", "fix: y\n\nWhy it was wrong."]) }
  );
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 commits linted, 0 failed/);
});

test("pull request: a co-author and a fixup! fail", () => {
  const r = run(
    { PR: "1" },
    { pulls: json(["feat: x\n\nbody\n\nCo-authored-by: A <a@b.c>", "fixup! feat: x"]) }
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /2 commits linted, 2 failed/);
});

test("pull request: no commits listed is an error", () => {
  assert.equal(run({ PR: "1" }, { pulls: "" }).status, 2);
});

test("push: every commit of the range is linted", () => {
  const r = run(
    { BEFORE: "a".repeat(40), AFTER: "b".repeat(40) },
    { compare: json(["feat: x", "Updated things"]) }
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /2 commits linted, 1 failed/);
});

test("push of a new branch lints the head commit", () => {
  const r = run(
    { BEFORE: "0".repeat(40), AFTER: "b".repeat(40) },
    { compare: null, commit: json(["feat: x"]) }
  );
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 commits linted, 0 failed/);
});

test("push after a force push falls back to the head commit", () => {
  const r = run(
    { BEFORE: "a".repeat(40), AFTER: "b".repeat(40) },
    { compare: null, commit: json(["fixup! feat: x"]) }
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /linting the head commit only/);
});

test("neither a pull request nor a push is a usage error", () => {
  assert.equal(run({}, {}).status, 2);
});
