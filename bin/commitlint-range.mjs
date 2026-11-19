#!/usr/bin/env node
// commitlint-range <from> <to> [commitlint options]: lint every commit in
// from..to with the repository's commitlint config (this package's base when
// it has none), then fail any fixup!, squash! or amend! commit. For CI: infra's
// lint job, the dotfiles check job and the GitLab commits job run it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FIXUP_HINT, commitlint, configArgs, isFixup } from "../lib/check.mjs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  console.log(pkg.version);
  process.exit(0);
}
const [from, to, ...rest] = args;
if (!from || !to || from.startsWith("-")) {
  console.error("usage: commitlint-range <from> <to> [commitlint options]");
  process.exit(2);
}

const log = spawnSync("git", ["log", "--format=%h %s", `${from}..${to}`], {
  encoding: "utf8",
});
if (log.status !== 0) {
  console.error(`commitlint-range: git log ${from}..${to} failed:\n${log.stderr}`);
  process.exit(2);
}
const commits = log.stdout.split("\n").filter(Boolean);

const lint = commitlint([...configArgs(), "--from", from, "--to", to, ...rest]);
const fixups = commits.filter((line) => isFixup(line.slice(line.indexOf(" ") + 1)));
for (const line of fixups) console.error(`✖ ${line}: ${FIXUP_HINT}`);

console.log(`${commits.length} commits in ${from}..${to}, ${fixups.length} fixup`);
process.exit(lint.status === 0 && fixups.length === 0 ? 0 : 1);
