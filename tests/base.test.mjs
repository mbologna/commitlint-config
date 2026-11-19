// The base config (index.mjs): each case pipes a message through the
// package's own commitlint CLI from a scratch cwd, so config-conventional has
// to resolve next to the CLI, as it does from $HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, cliPath } from "../lib/check.mjs";

const CWD = mkdtempSync(join(tmpdir(), "commitlint-"));
const skip = false;

function lint(message, config = BASE, ...args) {
  const r = spawnSync(process.execPath, [cliPath(), "-g", config, ...args], {
    cwd: CWD,
    input: message,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const header = (len) => `feat: ${"a".repeat(len - "feat: ".length)}`;

test("the base extends config-conventional and its parser", { skip }, () => {
  const { status, out } = lint("", BASE, "--print-config", "json");
  assert.equal(status, 0, out);
  const config = JSON.parse(out);
  assert.equal(config.parserPreset.name, "conventional-changelog-conventionalcommits");
  assert.deepEqual(config.rules["header-trim"], [2, "always"]);
});

test("headers fit 72 characters", { skip }, () => {
  assert.equal(lint(header(72)).status, 0);
  assert.match(lint(header(73)).out, /\[human-header-max-length\]/);
});

// The shared Renovate preset's wording, which image-cve-alert parses
const renovate = (topic) =>
  `fix(security): update ${topic} from 5.2.4-r0-ls421 to 5.2.5-r0-ls422 (patch)`;

test("Renovate's update headers may run to 100 characters", { skip }, () => {
  const h = renovate("docker/qbittorrent-plus-x");
  assert.equal(h.length, 93);
  assert.equal(lint(`${h}\n`).status, 0);
  // image-cve-alert's squash of an expedited fix
  assert.equal(lint(`${h} (#637)\n`).status, 0);
  assert.match(
    lint(`${renovate("docker/" + "q".repeat(35))}\n`).out,
    /\[header-max-length\]/
  );
  assert.match(
    lint(`chore(deps): update ${"x".repeat(60)}\n`).out,
    /\[human-header-max-length\]/
  );
});

test("body lines fit 72 characters", { skip }, () => {
  assert.equal(lint(`fix: x\n\n${"b".repeat(72)}\n`).status, 0);
  assert.match(lint(`fix: x\n\n${"b".repeat(73)}\n`).out, /\[body-max-line-length\]/);
});

test("a body line shaped like a trailer is no footer warning", { skip }, () => {
  const { status, out } = lint("fix: x\n\nThe proxy caps\negress: 35 MiB a day.\n");
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /footer-leading-blank/);
});

test("a trailer longer than 72 characters passes", { skip }, () => {
  const trailer =
    "Signed-off-by: renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>";
  assert.equal(lint(`fix: x\n\nbody\n\n${trailer}\n`).status, 0);
});

for (const line of [
  "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
  "Co-authored-by: Claude <noreply@anthropic.com>",
  "Co-authored-by: Ada Lovelace <ada@example.com>",
  "Co-authored-by: renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>",
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
]) {
  test(`attribution fails: ${line.slice(0, 30)}`, { skip }, () => {
    assert.match(lint(`fix: x\n\nbody\n\n${line}\n`).out, /\[no-attribution-trailers\]/);
  });
}

test("a body that only mentions a tool passes", { skip }, () => {
  assert.equal(
    lint("fix: x\n\nGenerated with the palette script, not by hand.\n").status,
    0
  );
});

test("a forge's squash message fails: unwrapped description, co-author", { skip }, () => {
  const squash = [
    "fix(renovate): keep the update wording image-cve-alert parses (#647)",
    "",
    `Follow-up to #646, which ${"shortened Renovate's commit headers ".repeat(3)}to fit.`,
    "Co-authored-by: Someone <someone@example.com>",
    "Reviewed-on: https://codeberg.org/mbologna/infra/pulls/647",
  ].join("\n");
  const { out } = lint(`${squash}\n`);
  assert.match(out, /\[body-max-line-length\]/);
  assert.match(out, /\[no-attribution-trailers\]/);
});

test("a header with trailing whitespace fails", { skip }, () => {
  assert.match(lint("fix: x  \n").out, /\[header-trim\]/);
});

test("feat! and a BREAKING-CHANGE footer are valid", { skip }, () => {
  assert.equal(
    lint("feat!: drop the flag\n\nBREAKING-CHANGE: the flag is gone\n").status,
    0
  );
});

for (const merge of [
  "Merge pull request #241 from mbologna/ci/commit-check",
  "Merge pull request 'hotel: notes' (#644) from hotel-rebuild into main",
  "Merge branch 'feat/x' into 'main'",
]) {
  test(`a forge's merge commit is ignored: ${merge.slice(0, 30)}`, { skip }, () => {
    const body = "ci: lint every commit\n\nSee merge request mbologna/x!3";
    assert.equal(lint(`${merge}\n\n${body}\n`).status, 0);
  });
}

test("image-cve-alert's fix(security) merge title passes", { skip }, () => {
  const h =
    "fix(security): update docker/k8s-device-plugin from v0.20.1 to v0.20.2 (patch) (#633)";
  assert.equal(lint(`${h}\n\nExpedited by image-cve-alert on yankee.\n`).status, 0);
});

test("the base lets a fixup! commit through (the local hook must)", { skip }, () => {
  assert.equal(lint("fixup! fix: x\n").status, 0);
});
