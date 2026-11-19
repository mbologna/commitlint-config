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
  assert.match(r.out, /a\.txt: the version before [0-9a-f]+ feat: the change/);
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

test("a bad range is a usage error", () => {
  const { dir, commit } = repo();
  commit("chore: base", { "a.txt": "x\n" });
  assert.equal(run(CHECK, dir, "nonexistent").status, 2);
});
