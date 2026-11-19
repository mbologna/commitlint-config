// bin/commitlint-range: a scratch repository with a base commit, then the
// commits under test; each case lints base..HEAD.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/commitlint-range.mjs", import.meta.url));

function repo(...messages) {
  const dir = mkdtempSync(join(tmpdir(), "range-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("commit", "-q", "--allow-empty", "-m", "chore: base");
  const base = git("rev-parse", "HEAD");
  for (const m of messages) git("commit", "-q", "--allow-empty", "--no-verify", "-m", m);
  return { dir, base, git };
}

function range(dir, from, to = "HEAD") {
  const r = spawnSync(process.execPath, [BIN, from, to], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("good commits pass", () => {
  const { dir, base } = repo("feat: add x", "fix(y): handle z");
  const r = range(dir, base);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 commits/);
});

test("a bad header fails", () => {
  const { dir, base } = repo("feat: add x", "Updated stuff");
  assert.equal(range(dir, base).status, 1);
});

for (const prefix of ["fixup!", "squash!", "amend!"]) {
  test(`a ${prefix} commit fails the gate`, () => {
    const { dir, base } = repo("feat: add x", `${prefix} feat: add x`);
    const r = range(dir, base);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /autosquash/);
  });
}

test("a merge commit in the range is ignored", () => {
  const { dir, base, git } = repo("feat: add x");
  git("checkout", "-q", "-b", "side", base);
  git("commit", "-q", "--allow-empty", "-m", "fix: on the side");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "--no-edit", "side");
  const r = range(dir, base);
  assert.equal(r.status, 0, r.out);
});

test("a repository config is used instead of the base", () => {
  const { dir, base } = repo("feat(nope): add x");
  writeFileSync(
    join(dir, "commitlint.config.mjs"),
    `export default { extends: [${JSON.stringify(fileURLToPath(new URL("../index.mjs", import.meta.url)))}], rules: { "scope-enum": [2, "always", ["ok"]] } };\n`
  );
  assert.equal(range(dir, base).status, 1);
});

test("a bad range is a usage error, not a pass", () => {
  const { dir } = repo("feat: add x");
  assert.equal(range(dir, "nonexistent").status, 2);
});
