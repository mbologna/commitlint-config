// The stale-tree gate: a commit that puts files back to versions they had
// before their latest change, without saying it reverts anything.
//
// That is what committing a stale index looks like. `git reset --soft
// origin/main` after another session fetched a newer main moves the branch
// onto it but keeps the index from the old one, and the next commit records
// the old files: relative to its parent it silently undoes every change main
// gained in between (infra's 40ff55d6 reverted a whole pull request this way).
// The commit's own diff looks normal; only the history shows that its new
// blobs are old ones.
//
// Restoring an older version on purpose is common for one or two files (a
// setting set back, a feature retired), so a few files only warn. From
// minFiles on, the commit fails. A subject that says "revert" is exempt, and
// so is a commit that re-applies an earlier one (same patch-id): putting back
// what a stale commit removed is the cure, not the disease.
//
// A merge commit has the same failure of its own: a conflict resolved by
// taking one side wholesale puts back the older version of every file only
// the other side changed. Its diff against the first parent mixes that with
// everything the branch brought in, so a merge is judged on what it did
// beyond the clean merge of its parents.
import { spawnSync } from "node:child_process";

export const MIN_FILES = 4;
// How far back each path's history is searched for the restored version.
const DEPTH = 200;
const REVERT = /revert/i;

export const STALE_HINT =
  "a stale index? (git reset --soft onto a ref that moved since you last" +
  " looked keeps the old files staged). Rewrite your commits on" +
  " $(git merge-base HEAD origin/main) and read git diff --cached --stat" +
  " before committing; if restoring these versions is the point, say" +
  " revert in the subject";

export const MERGE_HINT =
  "a conflict resolved with one side's files? (git checkout --ours or" +
  " --theirs over paths only the other side changed puts back their older" +
  " versions). Redo the merge and resolve only the conflicted hunks; if" +
  " restoring these versions is the point, say revert in the subject";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

function patchId(cwd, sha) {
  const show = spawnSync("git", ["show", "--no-color", sha], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const id = spawnSync("git", ["patch-id", "--stable"], {
    cwd,
    input: show.stdout,
    encoding: "utf8",
  });
  return id.stdout.split(" ")[0] || null;
}

// Every blob a path had in the DEPTH changes before `rev`, mapped to the
// commit that introduced it ("new") or the commit that replaced it ("old").
function history(cwd, rev, path) {
  const out = git(
    cwd,
    "log",
    `-n${DEPTH}`,
    // %H, shortened below: --no-abbrev, which the blob ids need, makes %h
    // print all 40 characters too.
    "--format=@%H %s",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    rev,
    "--",
    path
  );
  const blobs = new Map();
  let commit = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@")) commit = line.slice(1, 13) + line.slice(41);
    else if (line.startsWith(":") && commit) {
      const [, , oldBlob, newBlob] = line.slice(1).split("\t")[0].split(" ");
      if (!blobs.has(newBlob)) blobs.set(newBlob, { commit, when: "from" });
      if (!blobs.has(oldBlob)) blobs.set(oldBlob, { commit, when: "before" });
    }
  }
  return blobs;
}

// One commit: the paths it modifies whose new content is an older version.
export function restoredPaths(cwd, sha) {
  const raw = git(cwd, "diff-tree", "-r", "--no-renames", "--no-commit-id", "--raw", sha);
  const restored = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith(":")) continue;
    const [meta, path] = line.slice(1).split("\t");
    const [, , oldBlob, newBlob, status] = meta.split(" ");
    if (status !== "M" || oldBlob === newBlob) continue;
    const match = history(cwd, `${sha}^`, path).get(newBlob);
    if (match) restored.push({ path, ...match });
  }
  return restored;
}

function blobAt(cwd, rev, path) {
  const r = spawnSync("git", ["rev-parse", "-q", "--verify", `${rev}:${path}`], {
    cwd,
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

// One merge commit: the paths its own resolution put back to an older version.
// Only what the merge did itself counts, the paths where it differs from the
// clean merge of its parents (git merge-tree, git 2.38+): what a branch brought
// in was checked with the branch's commits. Each such path is compared with
// every parent's history, so both mistakes show: main's older version restored
// (`git checkout --theirs .` over files only main changed), and the merged
// branch's change dropped for the version it replaced.
export function mergeRestoredPaths(cwd, sha) {
  const parents = git(cwd, "rev-list", "--parents", "-n1", sha)
    .trim()
    .split(" ")
    .slice(1);
  let paths;
  if (parents.length === 2) {
    const r = spawnSync(
      "git",
      ["merge-tree", "--write-tree", "--no-messages", parents[0], parents[1]],
      { cwd, encoding: "utf8", maxBuffer: 1 << 28 }
    );
    // 1 is a conflicted merge: its tree, markers included, is still printed.
    if (r.status !== 0 && r.status !== 1)
      throw new Error(`git merge-tree (git 2.38+) on ${sha}: ${r.stderr.trim()}`);
    const clean = r.stdout.split("\n")[0];
    paths = git(cwd, "diff-tree", "-r", "--no-renames", "--name-only", clean, sha);
  } else {
    // An octopus merge: merge-tree takes two heads, so take every path the
    // merge leaves different from all its parents.
    paths = git(cwd, "diff-tree", "-r", "--no-renames", "--name-only", parents[0], sha);
  }
  const restored = [];
  for (const path of paths.split("\n").filter(Boolean)) {
    const blob = blobAt(cwd, sha, path);
    if (!blob) continue;
    const own = parents.map((p) => blobAt(cwd, p, path));
    if (parents.length > 2 && own.includes(blob)) continue;
    for (const [i, parent] of parents.entries()) {
      if (own[i] === null || own[i] === blob) continue;
      const match = history(cwd, parent, path).get(blob);
      if (match) {
        restored.push({ path, ...match, side: i === 0 ? "target" : "merged" });
        break;
      }
    }
  }
  return restored;
}

// Every commit in from..to: each non-merge commit against its parent, each
// merge for what its resolution did. Returns the commits that restore files,
// each marked "error" (minFiles or more) or "warning".
export function staleTree(from, to, { cwd = process.cwd(), minFiles = MIN_FILES } = {}) {
  const commits = git(cwd, "rev-list", "--parents", "--reverse", `${from}..${to}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "));
  const findings = [];
  for (const [sha, ...parents] of commits) {
    const subject = git(cwd, "log", "-1", "--format=%s", sha).trim();
    if (REVERT.test(subject)) continue;
    if (parents.length > 1) {
      const restored = mergeRestoredPaths(cwd, sha);
      if (restored.length === 0) continue;
      findings.push({
        sha: sha.slice(0, 12),
        subject,
        restored,
        merge: true,
        level: restored.length >= minFiles ? "error" : "warning",
      });
      continue;
    }
    const restored = restoredPaths(cwd, sha);
    if (restored.length === 0) continue;
    // A re-application of an earlier commit (a cherry-pick that restores what
    // a stale commit undid) carries that commit's patch-id.
    const own = patchId(cwd, sha);
    const earlier = new Set(restored.map((r) => r.commit.split(" ")[0]));
    for (const path of new Set(restored.map((r) => r.path))) {
      const log = git(cwd, "log", "-n50", "--format=%h", `${sha}^`, "--", path);
      for (const h of log.split("\n").filter(Boolean)) earlier.add(h);
    }
    if (own && [...earlier].some((h) => patchId(cwd, h) === own)) continue;
    findings.push({
      sha: sha.slice(0, 12),
      subject,
      restored,
      level: restored.length >= minFiles ? "error" : "warning",
    });
  }
  return { checked: commits.length, findings };
}

export function minFilesFromEnv(env = process.env) {
  const n = Number.parseInt(env.STALE_TREE_MIN_FILES ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : MIN_FILES;
}

// The report both CLIs print, one finding per commit.
export function report(findings, print = console.error) {
  for (const f of findings) {
    const mark = f.level === "error" ? "✖" : "⚠";
    const n = f.restored.length;
    const files = `${n} file${n === 1 ? "" : "s"}`;
    print(
      f.merge
        ? `${mark} ${f.sha} ${f.subject}: the merge itself puts ${files} back to an older version`
        : `${mark} ${f.sha} ${f.subject}: puts ${files} back to an older version`
    );
    for (const r of f.restored) {
      const side = r.side
        ? ` (${r.side === "target" ? "merged into" : "merged"} side)`
        : "";
      print(`    ${r.path}: the version ${r.when} ${r.commit}${side}`);
    }
    if (f.level === "error") print(`  ${f.merge ? MERGE_HINT : STALE_HINT}`);
  }
}
