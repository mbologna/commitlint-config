// bin/commitlint-pr: a stub gh on PATH prints the commits the API would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/commitlint-pr.mjs", import.meta.url));

function pr(...messages) {
  const dir = mkdtempSync(join(tmpdir(), "pr-"));
  const lines = messages.map((message, i) =>
    JSON.stringify({ sha: `${i}`.repeat(40), message })
  );
  writeFileSync(join(dir, "gh"), `#!/bin/sh\ncat <<'JSON'\n${lines.join("\n")}\nJSON\n`);
  chmodSync(join(dir, "gh"), 0o755);
  const r = spawnSync(process.execPath, [BIN], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: "o/r",
      PR: "1",
      NO_COLOR: "1",
    },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("good commits pass", () => {
  const r = pr("feat: add x", "fix: y\n\nWhy it was wrong.");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 commits linted, 0 failed/);
});

test("a co-author and a fixup! fail", () => {
  const r = pr("feat: x\n\nbody\n\nCo-authored-by: A <a@b.c>", "fixup! feat: x");
  assert.equal(r.status, 1);
  assert.match(r.out, /2 commits linted, 2 failed/);
});

test("no commits listed is an error", () => {
  assert.equal(pr().status, 2);
});
