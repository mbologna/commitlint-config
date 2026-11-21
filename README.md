# commitlint-config-mbologna

The commit rules of every repository under `mbologna`, on GitHub, Codeberg
and GitLab, and the CI tools that enforce them.

## The rules

[`index.mjs`](index.mjs) extends
[`@commitlint/config-conventional`](https://www.npmjs.com/package/@commitlint/config-conventional)
and deviates only where its comments say why:

- **Headers of at most 72 characters.** Renovate's
  `update <topic> from <old> to <new> (<type>)` headers may run to 100:
  [image-cve-alert](https://github.com/mbologna/image-cve-alert) parses that
  wording to fast-track CVE fixes, so it is never shortened.
- **Body lines of at most 72 columns**, so `git log` fits 80.
- **No attribution trailers**: no `Co-authored-by` line at all, and no
  "Generated with" line naming an AI tool.
- **Lowercase scopes.** The scope list belongs to each repository.

## Merging

Every repository merges pull requests with a **merge commit**: squash and
rebase are disabled. The commits CI linted land on the default branch
unchanged (signatures included), and the merge commit (`Merge pull request
#N …`, `Merge branch '…' into 'main'`) is skipped by commitlint and by
auto-release. `git log --first-parent` shows one line per pull request, and
`git revert -m 1 <merge>` undoes one.

The default branch accepts changes only through a pull request whose checks
pass: no direct pushes, no force pushes, no bypass. When CI itself is broken,
lift the protection through the forge's API, merge, restore it, and record
why.

## Using it

**A repository config** extends the base and adds its scopes:

```js
// commitlint.config.mjs
export default {
  extends: ["mbologna"],
  rules: { "scope-enum": [2, "always", ["api", "ci", "deps", "docs"]] },
};
```

**Locally**, the dotfiles install `index.mjs` as `~/.commitlintrc.mjs`, which
the global commit-msg hook falls back to in a repository without a config.

**In CI**, every commit of a pull request is linted, and `fixup!`, `squash!`
and `amend!` commits fail (fold them in with `git rebase -i --autosquash`
first; the local hook lets them through so `git commit --fixup` works).

A commit that puts files back to versions they had before their latest
change fails too ([`lib/stale-tree.mjs`](lib/stale-tree.mjs)): that is a
stale index, typically `git reset --soft` onto a ref that moved since the
branch last looked, and its commit silently undoes what the branch gained in
between. One to three such files only warn (setting a value back is
legitimate); four or more fail (`STALE_TREE_MIN_FILES` moves the line). A
subject that says `revert` is exempt, and so is a commit that re-applies an
earlier one. A merge commit is judged on what it did beyond the clean merge of
its parents (`git merge-tree`, git 2.38 or later): a conflict resolved by
taking one side's files puts back the older version of every file only the
other side changed, and so does a merge that drops the branch's changes. The
same thresholds and `revert` exemption apply. The check needs full history:
`commitlint-range` and `commit-tree-check <from> <to>` run it on a full
clone, and the action makes a partial clone of its own (anonymous for a
public repository, with the token for a private one) when the caller has no
full checkout.

| Where         | How                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub        | `mbologna/.github`'s reusable `commits.yml` runs this repository's [action](action.yml) (`bin/commitlint-pr.mjs`) on pull requests, and on pushes where a caller adds a `push` trigger (the private repositories, which GitHub Free gives no rulesets: a push check reports what it can't block). The messages come from the API, so the job needs no checkout; the stale-tree check clones the history it reads |
| GitLab        | ci-templates' `commits` component runs `commitlint-range "$CI_MERGE_REQUEST_DIFF_BASE_SHA" "$CI_COMMIT_SHA"` in `ghcr.io/mbologna/commitlint-config`                                                                                                                                                                                                                                                             |
| Anywhere else | `npm install commitlint-config-mbologna`, then `npx commitlint-range <from> <to>`: the repository's own config if it has one, the base otherwise                                                                                                                                                                                                                                                                 |

## Versioning

Releases follow SemVer: [auto-release](https://github.com/mbologna/auto-release)
tags `vX.Y.Z` on Monday when a releasable commit landed, from the Conventional
Commit types (`feat` minor; `fix`, `perf`, `revert` patch; a breaking change
major). The tag publishes the npm package as `X.Y.Z` (trusted publishing) and
the image `ghcr.io/mbologna/commitlint-config` as `X.Y.Z`, `X.Y` and `latest`,
signed with cosign. Renovate moves the pins in every consumer. An urgent rule
change can be released by running the CI workflow by hand on `main`. See the
[versioning standard](https://github.com/mbologna/.github/blob/main/VERSIONING.md).
