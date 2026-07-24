# Claude Code Desktop Release Runbook

Use this runbook for every production Claude Code Desktop macOS release. Do not
publish artifacts unless each required evidence item is present for the same
commit, release version, GitHub Actions run id, and run attempt.

## Required Inputs

- A semver `DESKTOP_RELEASE_VERSION` value, normally triggered through
  `workflow_dispatch` input `version` or a `desktop-v<version>` tag.
- A completed `desktop/release/ux-validation-evidence.md` with no placeholders,
  release version/commit match, a validator and representative user with
  `YYYY-MM-DD` dates, observed representative user validation with a facilitator
  and `YYYY-MM-DD` date, required screenshot rows, required manual task rows, no
  blocking issues, accepted known limitations, native Help menu support actions
  covering Help menu Command Palette, Help menu Refresh Settings, and
  Help menu Export Diagnostics, and
  `UX release approval: approved`.
- Developer ID Application signing material in the protected
  `desktop-release` environment:
  - `DESKTOP_MAC_CSC_LINK` plus `DESKTOP_MAC_CSC_KEY_PASSWORD`, or
  - `DESKTOP_MAC_CSC_NAME` naming an installed
    `Developer ID Application: ... (TEAMID)` keychain identity.
- Apple notarization credentials in the protected `desktop-release`
  environment:
  - `DESKTOP_APPLE_API_KEY`, `DESKTOP_APPLE_API_KEY_ID`, and
    `DESKTOP_APPLE_API_ISSUER`, or
  - `DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`,
    and `DESKTOP_APPLE_TEAM_ID`, or
  - `DESKTOP_APPLE_KEYCHAIN_PROFILE` with optional `DESKTOP_APPLE_KEYCHAIN`.

## Preflight

Run these checks before tagging or manually dispatching a release:

```sh
export DESKTOP_RELEASE_VERSION=x.y.z
bun run desktop:prepare-ux-validation
bun run desktop:prepare-ux-validation -- --check
bun run desktop:release-preflight
bun run desktop:prod-check
bun run desktop:production-gate
```

The release runner must be macOS with Xcode command line tools and
`notarytool` available:

```sh
xcode-select -p
xcrun --find notarytool
```

## Release Workflow

Start the release with one of these paths:

- Manual: run `.github/workflows/desktop-release.yml` with
  `workflow_dispatch` input `version=x.y.z` and optional
  `ux_validation_evidence_base64`.
- Tag: push `desktop-vx.y.z`.

The `macos-release` job must run `bun run desktop:release-ci` and upload:

- `claude-code-desktop-macos-evidence-<version>`
- `claude-code-desktop-macos-diagnostics-<version>`
- `claude-code-desktop-macos-artifacts-<version>`, containing the versioned
  app bundle tarball plus the versioned DMG and mac ZIP

The `publish-release` job must create a draft, non-prerelease GitHub Release
named `Claude Code Desktop x.y.z` with tag `desktop-vx.y.z`. Before that job
runs any desktop evidence script, it must check out source, resolve the Bun
version from `packageManager`, and run `oven-sh/setup-bun@v2` with that pinned
version. Before the Release is made public, the workflow must run the protected
`production-gate` job on `macos-14`. That job downloads the signed artifacts, release evidence,
diagnostics, post-publish evidence artifact, and the draft GitHub Release
assets, restores the signed `.app` bundle from the tarball, then runs
`bun run desktop:production-gate` against the restored `desktop/release` layout.
The job must upload `desktop/release/production-gate-evidence.json` with
`if: always()` so accepted and rejected final gate attempts both retain the
ordered gate step results.
Only the later `publish-public-release` job may undraft the verified Release,
and it must upload `public-release-evidence.json` as a retained Actions
artifact after verifying the final public Release state. That public job must
also check out source and setup the pinned Bun version before running the
desktop public release evidence scripts.

## Required Evidence

Retain these files from the Actions artifacts and GitHub Release:

- `desktop/release/release-evidence.json`
- `desktop/release/release-notes-evidence.md`
- `desktop/release/ux-validation-evidence.md`
- `desktop/release/SHA256SUMS`
- `desktop/release/ux-screenshots/**/*.png`
- `ux-screenshots.zip`
- versioned DMG and mac ZIP assets
- `published-release-evidence.json`
- `desktop/release/production-gate-evidence.json`
- `public-release-evidence.json`

`release-evidence.json` must prove passing `verify-release` and
`final-verify-release`, passing app/DMG Gatekeeper and notarization checks, and
matching CI source metadata for repository, ref name, ref type, event, commit,
run id, run attempt, and run URL. `published-release-evidence.json` must be
generated with `bun run desktop:write-published-release-evidence`, uploaded to
the GitHub Release, downloaded back, and verified with
`bun run desktop:verify-published-release`. That verification must confirm the
stable GitHub Release database id and public URL plus the fixed published asset
set: one current-version DMG, one current-version mac ZIP,
`SHA256SUMS`, `release-evidence.json`, `release-notes-evidence.md`,
`ux-validation-evidence.md`, and `ux-screenshots.zip`; it must also compare the
evidence asset summary with the downloaded asset directory by name, size, and
SHA-256. For local audits outside GitHub Actions, run
`node desktop/scripts/published-release-evidence.mjs verify` with the same
`--local`, `--evidence`, and `--downloaded-dir` paths plus explicit
`--expected-release-version`, `--expected-repository`, `--expected-ref-name`,
`--expected-ref-type`, `--expected-event-name`, `--expected-commit`,
`--expected-run-id`, `--expected-run-attempt`, and `--expected-run-url` values.
`public-release-evidence.json` must come from the post-gate
`publish-public-release` job through `bun run desktop:write-public-release-evidence`
and `bun run desktop:verify-public-release`. That job must upload
`production-gate-evidence.json` to the GitHub Release before undrafting it,
download the retained `published-release-evidence.json` artifact into
`public-release-input/published-evidence/published-release-evidence.json`,
verify the downloaded Actions artifact with
`node desktop/scripts/production-gate.mjs verify --evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json`,
download the uploaded Release asset back, compare its size and SHA-256 with the
local gate evidence file, and record the final public Release tag/name,
stable GitHub Release database id, public Release URL, `draft=false`,
`prerelease=false`, sorted asset names including `production-gate-evidence.json`,
public asset metadata with positive sizes and unique same-repository GitHub
Release asset URLs with numeric asset ids and no query/hash data, repository,
ref name, ref type, event name, commit, run id, run attempt, and run URL.
After undrafting, the public release job must download the final public Release
assets again and compare every expected asset name, size, and SHA-256 against
the retained `published-release-evidence.json`, the retained
`production-gate-evidence.json`, and the retained published evidence file.
`desktop:verify-public-release` must also bind the final public release tag,
name, stable GitHub Release database id, and public URL back to
`public-release-input/published-evidence/published-release-evidence.json` so
the final retained evidence cannot describe a different Release identity or
different public sizes for assets already verified in the published evidence.
Before public release approval, `bun run desktop:production-gate` must pass on
the release runner so `desktop:prod-check`, non-destructive release preflight
records, `desktop:verify-release`, and `desktop:verify-published-release` are
proven in one ordered gate without deleting `desktop/release`. The generated
`production-gate-evidence.json` must record schema/product/kind, generated
timestamp, release version, repository, ref name, ref type, event name, run id,
run attempt, run URL, commit, overall pass/fail status, and every gate step
result. If a gate command cannot start, the failed step must retain the startup
error in that same evidence file. Release CI must validate retained gate evidence with
`node desktop/scripts/production-gate.mjs verify --evidence desktop/release/production-gate-evidence.json --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json`
so gate evidence and `published-release-evidence.json` prove the same release
version, repository, ref, event, commit, run id, run attempt, and run URL. The
schema-only package script `bun run desktop:verify-production-gate-evidence`
remains useful for local inspection, but it is not a substitute for the CI
cross-binding check above when approving a release. The
public release job must then run
`node desktop/scripts/published-release-evidence.mjs verify-public --evidence public-release-evidence.json --production-gate-evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json`
after writing `public-release-evidence.json`, binding the final public evidence
to the same production gate source metadata and published Release identity. In release CI, the final
`production-gate` job is the approval record for the draft GitHub Release
assets; if it fails, retain the gate evidence, treat the draft Release as
rejected, and delete the draft before retrying from a clean workflow run.

## Failure Handling

- If preflight fails, do not publish. Fix signing, notarization, UX evidence,
  toolchain, or workspace issues and rerun the same preflight command.
- If `desktop:verify-release` fails, treat the signed artifacts as rejected and
  rebuild after fixing the failing check.
- If GitHub Release upload, post-publish verification, or the final production
  gate fails, delete the draft Release before retrying from a clean workflow
  run.
- If a published artifact is later found bad, follow the rollback section in
  `docs/desktop-release-notes-template.md` and preserve all CI artifacts,
  diagnostics, and downloaded Release assets for postmortem review.
