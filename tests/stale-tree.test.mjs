// lib/stale-tree.mjs through bin/commit-tree-check and bin/commitlint-range:
// scratch repositories where a commit puts files back to older versions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../bin/commit-tree-check.mjs", import.meta.url));
const RANGE = fileURLToPath(new URL("../bin/commitlint-range.mjs", import.meta.url));
const FILES = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "stale-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  // Write files, stage everything, commit; returns the new commit.
  const commit = (message, files) => {
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(dir, name), text);
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const all = (text) => Object.fromEntries(FILES.map((f) => [f, `${f} ${text}\n`]));
  return { dir, git, commit, all };
}

function run(bin, dir, from, to = "HEAD", env = {}) {
  const r = spawnSync(process.execPath, [bin, from, to], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("a stale index that undoes a merged change fails", () => {
  // The 40ff55d6 sequence: a branch starts on main, main gains a change, the
  // branch is moved onto the new main with reset --soft, and its next commit
  // records the old files.
  const { dir, git, commit, all } = repo();
  const base = commit("chore: base", all("v1"));
  git("switch", "-q", "-c", "feature");
  commit("feat: start the feature", { "f.txt": "feature\n" });
  git("switch", "-q", "main");
  const main = commit("feat: the change another session merged", all("v2"));
  git("switch", "-q", "feature");
  git("reset", "-q", "--soft", main);
  writeFileSync(join(dir, "f.txt"), "feature, rewritten\n");
  git("add", "f.txt");
  git("commit", "-q", "--no-verify", "-m", "feat: the feature");
  const r = run(CHECK, dir, main);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /puts 5 files back to an older version/);
  assert.match(r.out, /a\.txt: the version before [0-9a-f]{12} feat: the change/);
  assert.match(r.out, /merge-base/);
  assert.notEqual(base, main);
});

test("one or two restored files only warn", () => {
  const { dir, commit } = repo();
  commit("chore: base", { "a.txt": "12:00\n", "b.txt": "x\n" });
  const moved = commit("feat: run at 07:00", { "a.txt": "07:00\n" });
  commit("feat: run at 12:00 again", { "a.txt": "12:00\n" });
  const r = run(CHECK, dir, moved);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /⚠ .* puts 1 file back/);
  assert.match(r.out, /1 restore older file versions/);
});

test("a subject that says revert is exempt", () => {
  const { dir, commit, all } = repo();
  commit("chore: base", all("v1"));
  const changed = commit("feat: v2", all("v2"));
  commit("revert(x): go back to v1", all("v1"));
  const r = run(CHECK, dir, changed);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 restore/);
});

test("re-applying an earlier commit is exempt", () => {
  // The cure for a stale commit: cherry-pick what it undid.
  const { dir, git, commit, all } = repo();
  commit("chore: base", all("v1"));
  const change = commit("feat: v2", all("v2"));
  const stale = commit("feat: something else", { ...all("v1"), "f.txt": "x\n" });
  git("-c", "core.hooksPath=/dev/null", "cherry-pick", change);
  const r = run(CHECK, dir, stale);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 commits .* 0 restore/);
});

test("ordinary edits pass", () => {
  const { dir, commit, all } = repo();
  const base = commit("chore: base", all("v1"));
  commit("feat: v2", all("v2"));
  commit("feat: v3", all("v3"));
  const r = run(CHECK, dir, base);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 commits .* 0 restore/);
});

test("STALE_TREE_MIN_FILES moves the threshold", () => {
  const { dir, commit, all } = repo();
  commit("chore: base", all("v1"));
  const changed = commit("feat: v2", all("v2"));
  commit("feat: back", all("v1"));
  assert.equal(run(CHECK, dir, changed, "HEAD", { STALE_TREE_MIN_FILES: "6" }).status, 0);
  assert.equal(run(CHECK, dir, changed).status, 1);
});

test("commitlint-range fails a stale commit too", () => {
  const { dir, commit, all } = repo();
  commit("chore: base", all("v1"));
  const changed = commit("feat: v2", all("v2"));
  commit("feat: back", all("v1"));
  const r = run(RANGE, dir, changed);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /0 fixup, 1 restore older file versions/);
});

// A branch that changes f.txt while main changes every file in FILES; the merge
// is left uncommitted for the test to resolve.
function divergedMerge(mainText = "v2") {
  const t = repo();
  const base = t.commit("chore: base", t.all("v1"));
  t.git("switch", "-q", "-c", "feature");
  t.commit("feat: the feature", { "f.txt": "feature\n" });
  t.git("switch", "-q", "main");
  t.commit("feat: the change main gained", t.all(mainText));
  t.git(
    "-c",
    "core.hooksPath=/dev/null",
    "merge",
    "-q",
    "--no-ff",
    "--no-commit",
    "feature"
  );
  const commitMerge = () =>
    t.git("-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-edit", "--no-verify");
  return { ...t, base, commitMerge };
}

test("a merge that takes one side's files over main's changes fails", () => {
  // `git checkout --theirs .` on a conflicted merge, or any resolution that
  // copies the branch's tree: the files only main changed go back to v1.
  const { dir, git, base, commitMerge } = divergedMerge();
  git("checkout", "feature", "--", ".");
  commitMerge();
  const r = run(CHECK, dir, base);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the merge itself puts 5 files back to an older version/);
  assert.match(
    r.out,
    /a\.txt: the version before [0-9a-f]{12} feat: the change main gained \(merged into side\)/
  );
  assert.match(r.out, /checkout --ours/);
});

test("a merge that drops the branch's changes fails", () => {
  const { dir, git, commit, all } = repo();
  const base = commit("chore: base", all("v1"));
  git("switch", "-q", "-c", "feature");
  commit("feat: the feature", all("v2"));
  git("switch", "-q", "main");
  commit("feat: something on main", { "g.txt": "main\n" });
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "merge",
    "-q",
    "--no-ff",
    "-s",
    "ours",
    "--no-edit",
    "feature"
  );
  const r = run(CHECK, dir, base);
  assert.equal(r.status, 1, r.out);
  assert.match(
    r.out,
    /a\.txt: the version before [0-9a-f]{12} feat: the feature \(merged side\)/
  );
});

test("clean and properly resolved merges pass", () => {
  const { dir, git, base, commitMerge } = divergedMerge();
  commitMerge();
  // A conflict resolved by hand, keeping both sides.
  git("switch", "-q", "-c", "other", base);
  writeFileSync(join(dir, "a.txt"), "a.txt other\n");
  git("commit", "-q", "--no-verify", "-am", "feat: other");
  git("switch", "-q", "main");
  const conflict = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "merge", "-q", "--no-ff", "--no-commit", "other"],
    { cwd: dir }
  );
  assert.equal(conflict.status, 1);
  writeFileSync(join(dir, "a.txt"), "a.txt v2 and other\n");
  git("add", "a.txt");
  git("-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-edit", "--no-verify");
  const r = run(CHECK, dir, base);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /5 commits .* 0 restore/);
});

test("a merge whose subject says revert is exempt", () => {
  const { dir, git, base } = divergedMerge();
  git("checkout", "feature", "--", ".");
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-q",
    "--no-verify",
    "-m",
    "revert: back to v1"
  );
  assert.equal(run(CHECK, dir, base).status, 0);
});

test("a bad range is a usage error", () => {
  const { dir, commit } = repo();
  commit("chore: base", { "a.txt": "x\n" });
  assert.equal(run(CHECK, dir, "nonexistent").status, 2);
});
