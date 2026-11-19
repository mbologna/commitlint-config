#!/usr/bin/env node
// commit-tree-check <from> <to>: fail a commit in from..to that puts files
// back to older versions without saying it reverts anything, the mark of a
// stale index (lib/stale-tree.mjs). The action runs it on a checkout with full
// history; commitlint-range runs the same check itself.
import { minFilesFromEnv, report, staleTree } from "../lib/stale-tree.mjs";

const [from, to] = process.argv.slice(2);
if (!from || !to || from.startsWith("-")) {
  console.error("usage: commit-tree-check <from> <to>");
  process.exit(2);
}
let result;
try {
  result = staleTree(from, to, { minFiles: minFilesFromEnv() });
} catch (e) {
  console.error(`commit-tree-check: ${e.message}`);
  process.exit(2);
}
report(result.findings);
const errors = result.findings.filter((f) => f.level === "error").length;
console.log(
  `${result.checked} commits in ${from}..${to}, ${result.findings.length} restore older file versions`
);
process.exit(errors === 0 ? 0 : 1);
