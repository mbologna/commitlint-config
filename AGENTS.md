# AGENTS.md

Notes for coding agents working in this repository. [README.md](README.md) covers what it does and how to use it.

## Versioning

Plain SemVer: `vX.Y.Z` tags, each publishing the npm package
`commitlint-config-mbologna` as `X.Y.Z` and the image
`ghcr.io/mbologna/commitlint-config` as `X.Y.Z`, `X.Y` and `latest`, per the
[versioning standard](https://github.com/mbologna/.github/blob/main/VERSIONING.md).

- Never create, move or delete tags, and never edit a version number to cut a
  release: auto-release tags from the commit types (`feat` minor; `fix`, `perf`,
  `revert` patch; `!` or a `BREAKING CHANGE:` footer major).
- Write Conventional Commit subjects; they decide the next version.
- `version` in `package.json` stays `0.0.0`: the shared `npm-publish` workflow
  sets it from the tag before publishing.
