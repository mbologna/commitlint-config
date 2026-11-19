#!/usr/bin/env node
// commitlint-pr: lint the commits of the current GitHub event with the base,
// plus the fixup gate. The action runs it; the messages come from the API (gh,
// GH_TOKEN), so the job needs no checkout.
//
// - A pull request (PR set): every commit of the pull request.
// - A push (BEFORE and AFTER set): every commit in BEFORE..AFTER. A push with
//   no usable BEFORE (a new branch, or a force push whose old head the API no
//   longer compares) lints AFTER alone. A push check can't block anything, but
//   it reports a commit that reached a branch without a pull request, as on
//   the private repositories, which GitHub Free gives no rulesets.
//
// Repositories with a config of their own (dotfiles, infra) lint in their own
// CI with commitlint-range.
import { spawnSync } from "node:child_process";
import { BASE, FIXUP_HINT, commitlint, isFixup } from "../lib/check.mjs";

const { REPO, PR, BEFORE, AFTER } = process.env;
// The pulls and compare APIs list at most 250 commits; a bigger range fails
// here rather than passing on a partial list.
const MAX = 250;
const NO_COMMIT = /^0+$/;

function gh(args) {
  return spawnSync("gh", ["api", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parse(stdout) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fail(message) {
  console.error(`commitlint-pr: ${message}`);
  process.exit(2);
}

function listCommits() {
  if (PR) {
    const api = gh([
      "--paginate",
      `repos/${REPO}/pulls/${PR}/commits`,
      "--jq",
      ".[] | {sha, message: .commit.message}",
    ]);
    if (api.status !== 0)
      fail(`listing the commits of ${REPO}#${PR} failed:\n${api.stderr}`);
    return { what: `${REPO}#${PR}`, commits: parse(api.stdout) };
  }
  if (!AFTER)
    fail("set REPO and PR (a pull request), or REPO, BEFORE and AFTER (a push)");
  if (BEFORE && !NO_COMMIT.test(BEFORE)) {
    const api = gh([
      `repos/${REPO}/compare/${BEFORE}...${AFTER}`,
      "--jq",
      ".commits[] | {sha, message: .commit.message}",
    ]);
    if (api.status === 0) {
      return {
        what: `${BEFORE.slice(0, 12)}..${AFTER.slice(0, 12)}`,
        commits: parse(api.stdout),
      };
    }
    console.log(
      `Comparing ${BEFORE.slice(0, 12)}..${AFTER.slice(0, 12)} failed; linting the head commit only`
    );
  }
  const api = gh([
    `repos/${REPO}/commits/${AFTER}`,
    "--jq",
    "{sha, message: .commit.message}",
  ]);
  if (api.status !== 0) fail(`reading ${REPO}@${AFTER} failed:\n${api.stderr}`);
  return { what: AFTER.slice(0, 12), commits: parse(api.stdout) };
}

if (!REPO) fail("set REPO (owner/name)");
const { what, commits } = listCommits();
if (commits.length === 0 || commits.length >= MAX) {
  fail(`${commits.length} commits listed for ${what}; expected 1 to ${MAX - 1}`);
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
