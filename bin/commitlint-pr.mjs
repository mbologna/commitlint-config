#!/usr/bin/env node
// commitlint-pr: lint every commit of the current GitHub pull request with the
// base, plus the fixup gate. The action runs it; the messages come from the
// API (gh, GH_TOKEN), so the job needs only pull-requests: read and no
// checkout. Repositories with a config of their own (dotfiles, infra) lint in
// their own CI with commitlint-range.
import { spawnSync } from "node:child_process";
import { BASE, FIXUP_HINT, commitlint, isFixup } from "../lib/check.mjs";

const { REPO, PR } = process.env;
if (!REPO || !PR) {
  console.error("commitlint-pr: set REPO (owner/name) and PR (number)");
  process.exit(2);
}

// The pulls API lists at most 250 commits; a bigger pull request fails here
// rather than passing on a partial list.
const MAX = 250;
const api = spawnSync(
  "gh",
  [
    "api",
    "--paginate",
    `repos/${REPO}/pulls/${PR}/commits`,
    "--jq",
    ".[] | {sha, message: .commit.message}",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
if (api.status !== 0) {
  console.error(
    `commitlint-pr: listing the commits of ${REPO}#${PR} failed:\n${api.stderr}`
  );
  process.exit(2);
}
const commits = api.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
if (commits.length === 0 || commits.length >= MAX) {
  console.error(
    `commitlint-pr: ${commits.length} commits listed; expected 1 to ${MAX - 1}`
  );
  process.exit(2);
}

let failed = 0;
for (const { sha, message } of commits) {
  const short = sha.slice(0, 12);
  console.log(`::group::${short} ${message.split("\n", 1)[0]}`);
  const lint = commitlint(["-g", BASE], {
    input: message,
    stdio: ["pipe", "inherit", "inherit"],
  });
  const fixup = isFixup(message);
  if (fixup) console.error(`✖ ${FIXUP_HINT}`);
  console.log("::endgroup::");
  if (lint.status !== 0 || fixup) {
    failed += 1;
    console.log(`::error title=commitlint::${short} does not follow the commit rules`);
  }
}
console.log(`${commits.length} commits linted, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
