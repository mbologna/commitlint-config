// What the CI entry points share: the commitlint CLI to run, the config to
// pass it, and the fixup gate.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = fileURLToPath(new URL("../index.mjs", import.meta.url));

// fixup!, squash! and amend! commits are meant to be folded into the commit
// they fix before a pull request merges. commitlint's default ignores let them
// through, and the local commit-msg hook must too (git commit --fixup), so CI
// rejects them: every commit of a pull request lands on main as it is.
const FIXUP = /^(fixup|squash|amend)! /;
export const isFixup = (subject) => FIXUP.test(subject);
export const FIXUP_HINT =
  "fold it into the commit it fixes: git rebase -i --autosquash <base>";

// The commitlint CLI: the repository's own install first, so its pinned
// version runs, then the one this package depends on.
export function cliPath(cwd = process.cwd()) {
  for (const base of [join(cwd, "package.json"), fileURLToPath(import.meta.url)]) {
    try {
      return createRequire(base).resolve("@commitlint/cli/cli.js");
    } catch {
      // try the next base
    }
  }
  throw new Error("cannot find @commitlint/cli");
}

// The file names commitlint itself looks for in a repository.
const CONFIG =
  /^(commitlint\.config\.[cm]?[jt]s|\.commitlintrc(\.(json|ya?ml|[cm]?[jt]s))?)$/;

// A repository with its own config (scopes) uses it; any other gets the base.
export function configArgs(cwd = process.cwd()) {
  return readdirSync(cwd).some((f) => CONFIG.test(f)) ? [] : ["-g", BASE];
}

export function commitlint(args, options = {}) {
  return spawnSync(process.execPath, [cliPath(options.cwd), ...args], {
    stdio: "inherit",
    ...options,
  });
}
