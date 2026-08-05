# Claude Code Desktop Production Readiness

The current desktop app is a local MVP. This document defines what must be true
before calling it production-ready and records the current release blockers.

## Production Definition

A production-ready Claude Code Desktop build must satisfy all of these gates:

1. **Functional gate**: local sessions, chat, files, editor, diff, terminal,
   preview, permissions, agents, teams, settings, and persistence pass the
   Electron and packaged smoke tests. Native menu entrypoints for page
   navigation, workspace panes, lifecycle creation, first-class Agents, Teams,
   and Tasks lifecycle actions, direct MCP/Skills/Plugins management actions,
   grouped Settings sections, Settings management actions, Help menu support
   actions, diagnostics, refresh, and command palette access must route through
   the same guarded renderer actions as the in-app controls.
2. **Security gate**: renderer isolation, IPC validation, navigation control,
   external URL validation, deep-link input validation, restrictive CSP, and
   Electron sandbox posture are reviewed and enforced by an automated gate.
3. **Release gate**: production builds use a stable app id, production version,
   explicit Electron main-process metadata, signed artifacts, macOS hardened
   runtime, notarization, and a defined update channel or explicit no-update
   policy.
4. **Operational gate**: release builds provide diagnostics for renderer/main
   crashes, runtime exits, failed updates, and user-reportable logs.
5. **UX gate**: the main user workflows have manual screenshot review and at
   least one representative user pass for agent/team/session comprehension.
6. **Support gate**: known limitations, rollback procedure, and release notes
   are documented for every release.

## Automated Gate

Run:

```sh
bun run desktop:prod-check
```

This command checks production release posture and exits non-zero when the
build is not releasable. It is intentionally stricter than the MVP smoke tests:
smoke tests prove core behavior works; `desktop:prod-check` proves the release
configuration is wired. The release workflow check parses
`.github/workflows/desktop-release.yml` and verifies that the signed release job
runs from a required-version `workflow_dispatch` entry or `desktop-v*` tag,
uses macOS with a bounded job timeout and minimal GitHub token permissions,
checks out source before installing dependencies, maps signing and notarization
secrets into the environment, runs `bun run desktop:release-ci`, and uploads
release evidence, screenshots, a tarred macOS `.app` bundle, `.dmg`, and `.zip`
artifacts.
It also requires a separate protected publish job with `contents: write` that
downloads the verified artifacts/evidence/diagnostics and creates a draft
`desktop-v<version>` GitHub Release with the DMG, ZIP, checksum manifest,
release evidence, release notes evidence, and UX validation evidence. The
public Release is only undrafted after the protected production gate passes,
and the final public state is retained as `public-release-evidence.json`.
The production readiness check also verifies desktop resume deep links reject
relative or non-local `cwd` values, control characters, and oversized
session/path inputs before a `claude://resume` URL can create or focus a local
session.

Before approving or publishing a production release, run:

```sh
bun run desktop:production-gate
```

This final gate runs `desktop:prod-check`, the same release preflight records
without cleaning `desktop/release`, `desktop:verify-release`, and
`desktop:verify-published-release` in order. It is the release approval command
that ties static readiness, macOS runner preflight, signed/notarized artifact
verification, and published-release evidence verification into one fail-closed
check. Release CI runs the same command in a protected `production-gate` job
against the draft GitHub Release before assets are made public: it restores the
signed macOS artifacts, release evidence, diagnostics, uploaded
`published-release-evidence.json`, and freshly downloaded draft Release assets
into the default `desktop/release` layout before running the gate on `macos-14`.
The gate writes `desktop/release/production-gate-evidence.json` with the final
ordered gate step results, repository, ref name, ref type, event name, commit,
run id, run attempt, run URL, and pass/fail status. If a gate command cannot
start, the failed step records the startup error so the rejection is still
auditable. Gate evidence validation also rejects contradictory step records:
passing command steps must have exit code `0` and no startup error, failing
command steps cannot report exit code `0`, and passing preflight steps cannot
contain failed preflight records. Passing gate evidence cannot retain a stale
failure string, and failing gate evidence must stop at the first failed step so
reviewers can trust the recorded gate order. Release CI uploads that file even
when the gate rejects a candidate.
The default `bun run desktop:verify-production-gate-evidence` script checks
that retained gate evidence is bound to a valid published-release evidence record at
`desktop/release/publish/downloaded-evidence/published-release-evidence.json`:
the published evidence must pass its own release identity, CI source metadata,
fixed asset set, and asset metadata checks, and the retained gate evidence must
match it for release version, repository, ref, event, commit, run id, run
attempt, and run URL. Only a later `publish-public-release` job revalidates the
downloaded gate evidence artifact, uploads it to the GitHub Release, verifies
the uploaded bytes, flips the verified draft Release to public, writes
`public-release-evidence.json`, and runs `bun run desktop:verify-public-release`,
whose default package script binds final public evidence to the same production
gate source metadata through `public-release-input/production-gate-evidence.json`
and the same Release tag/name/database id/public URL through
`public-release-input/published-evidence/published-release-evidence.json`,
including matching public sizes for assets already verified in the published
evidence.

Session creation also validates workspace paths before starting local runtime
processes: picker results, default-workspace sessions, renderer-provided
`sessions:create` cwd values, and deep-link cwd values must resolve to existing
folders, not missing paths, files, or symlinked directories. Cwd-based
workspace IPC for files, git, terminal, project MCP, project skills, plugins,
agents, and project scheduled tasks uses the same directory validator before
touching local state. Project MCP and project scheduled-task JSON targets also
reject symlinked file targets before read/write so project configuration
updates cannot follow a symlink to outside the selected workspace. Files tree
traversal uses symlink-aware directory inspection and does not follow
symlinked directories, so directory listing cannot leak names from outside the
selected workspace.
Destructive lifecycle handlers for user/project Skills, user/project MCP
servers, user/project Agents, local/project Teams, and global/project
scheduled tasks also reject absent targets with not-found errors, so the UI
cannot report a successful removal, pause, resume, or delete for resources that
are no longer present on disk.
Scheduled task updates that carry an id use the same not-found boundary, so
stale edit drafts or global Pause/Resume actions cannot recreate removed tasks
under old ids.
MCP state-only lifecycle handlers use the same target check: user
Enable/Disable and project Approve/Reject reject absent MCP servers before
writing settings files, preventing stale settings entries from being created by
old rows or concurrent workspace refreshes.
Plugin install IPC validates package identifiers before invoking the CLI and
rejects empty, option-like, whitespace, and control-character values, so a
Settings action cannot turn a package field into a plugin command flag.
External URL validation is enforced for both preview IPC and renderer-triggered
navigation: `preview:openExternal` accepts only HTTP(S), while `will-navigate`
and `window.open` use the shared navigation policy to block non-HTTP(S)
schemes, control characters, and credentialed URLs before passing a normalized
URL to `shell.openExternal`.
The production readiness check also reuses the same release environment
preflight as `desktop:release-ci`, so version, Developer ID signing, and Apple
notarization credential rules cannot drift between the local gate and the
signed CI pipeline.
It also requires `package.json` to pin the Bun toolchain with
`packageManager: bun@x.y.z`; the release workflow resolves `BUN_VERSION` from
that field instead of using `bun-version: latest`. `package.json` also pins
`engines.node` to an exact version, and the release workflow resolves
`NODE_VERSION` from that field instead of using a floating Node major.
Dependency resolution is pinned by the committed `bun.lock`; release CI must
install with `bun install --frozen-lockfile` so package manifest ranges cannot
move during a signed build.
Generated desktop build outputs, release artifacts, local CLI binaries, package
manager installs, OS metadata, and local IDE state are excluded by the root
`.gitignore`. Production release evidence must come from the signed CI
artifacts and uploaded release records, not from committing local
`desktop/dist`, `desktop/release`, or `node_modules` churn into source control.
The production readiness gate also checks the Electron Builder package scope:
the packaged app may include the built `desktop/dist` bundles,
`desktop/release-policy.json`, package metadata, the embedded CLI runtime, and
filtered `node-pty` runtime resources, but it must not package local
`desktop/release` evidence/artifacts, `desktop/tests`, `desktop/scripts`,
source snapshots under `src`, or the full `node_modules` tree.

After `bun run desktop:build` creates macOS artifacts on the release machine,
run:

```sh
bun run desktop:verify-release
```

This command verifies the produced `.app` and `.dmg` with `codesign`, `spctl`,
and `xcrun stapler validate`, confirms the `.zip` release archive is present,
checks the `.zip` archive structure with `ditto -t -k`, verifies that the
`.zip` contains the packaged app bundle with `unzip -l`, and verifies the
`.dmg` image structure with `hdiutil verify`. It also confirms the packaged
`.app` contains `app.asar` with the Electron main, preload, and renderer
bundles, checks app.asar `package.json` main/version metadata, contains the
embedded Claude CLI runtime and node-pty native prebuild required for local
sessions and the integrated terminal, verifies that `dist/claude-local` and the
node-pty `spawn-helper` retain executable permissions, checks `Info.plist`
bundle id/version metadata with `plutil`, and verifies `desktop/release/SHA256SUMS`
matches the generated DMG and ZIP files. It also verifies
`codesign -dv` reports a leaf `Developer ID Application:` authority for the app
and DMG so development, ad-hoc, or installer identities cannot satisfy release
verification, that the certificate chain includes `Developer ID Certification
Authority` and `Apple Root CA`, that the authority carries a Team ID matching
`TeamIdentifier`, and that the app and DMG report the same `TeamIdentifier` so
a release cannot mix artifacts signed by different Developer ID teams. It also verifies
`desktop/release/release-evidence.json` records the expected schema version,
product name, generation timestamp, same release version, target platform and
architecture, rejects preflight-only evidence during artifact verification, and
records DMG/ZIP digests as the files being checked, plus the path,
size, and SHA-256 of the archived `SHA256SUMS` manifest. It verifies source
repository, ref, ref type, GitHub event name, commit, CI run id, CI run
attempt, and CI run URL metadata, and requires the run URL to be the matching
`https://github.com/<repo>/actions/runs/<id>` URL. Push-triggered release
evidence must come from a `tag` ref named `desktop-v<version>`, while manual
`workflow_dispatch` releases must still record their branch or tag ref, so
signed production artifacts are traceable to the exact release workflow run and
release source that produced them.
It also verifies that the evidence records
the pinned Bun and Node toolchain versions plus `bun.lock` path, size, and
SHA-256, then verifies the recorded lockfile path points to the current checkout
`bun.lock` and rereads that file so stale lockfile metadata fails the release
check. It also verifies `releaseTooling` metadata for
`desktop/scripts/release-ci.mjs`,
`desktop/scripts/verify-release-artifacts.mjs`, and
`.github/workflows/desktop-release.yml` by rereading those files from the
current checkout and comparing their paths, sizes, and SHA-256 hashes. This
prevents a signed artifact from being approved with evidence generated or
verified by a different release script or workflow than the one under review.
It requires `releaseCredentials` to contain only valid redacted signing
and notarization strategy/source combinations, so release approval evidence
cannot omit which credential path produced the signed artifacts, claim an
impossible credential path, or archive raw credential material. It also scans
`release-evidence.json` and `release-notes-evidence.md`
for raw private key material, password material, and signing/notarization
credential environment values, including JSON fields and shell-style
assignments, and JSON secret fields such as password or private-key entries,
plus placeholder Developer ID certificate bundle text before accepting archived
release evidence. It also verifies that
the archived evidence records the required artifact
verification check IDs as passing for packaging, bundle contents, runtime
resources, Info.plist metadata, code signing, Gatekeeper, and notarization, plus
required release preflight, build, test, and smoke pipeline steps as passing
with the expected command arguments and smoke screenshot environment in the
same order `desktop:release-ci` executes them. Each required step must also
record ISO `startedAt` and `endedAt` timestamps with a non-negative duration.
A step recorded as passing must have exit code `0` and no failure records, so
archived evidence cannot claim a passing release gate while preserving
contradictory failure details. It
verifies packaged UX screenshot paths, directory containment, required
screenshot names, metadata, and PNG file signatures in the archived evidence
against the files captured under `desktop/release/ux-screenshots`. It also verifies
`desktop/release/ux-validation-evidence.md` is archived, has matching path,
size, and SHA-256 metadata in `release-evidence.json`, names a non-placeholder
validator with a validation date, contains a representative
user with a validation date and `UX release approval: approved` with approver
and approval date, matches the current release version and commit, has no unresolved checklist
placeholders, rejects placeholder validators and approvers such as `TBD`, `none`,
or `n/a`,
marks screenshot rows `pass` or `n/a`, includes every required
manual task row and marks each one `pass`, records no blocking issues, and
records accepted known limitations with
an approver. The same representative user, known limitations approver, and UX
approval status/approver/date are copied into `release-evidence.json` as
`uxValidationSummary` and into `release-notes-evidence.md` under
`## UX Validation`; `desktop:verify-release` compares that summary against the
archived checklist so the release notes cannot hide stale or weak UX approval.
It also verifies the generated
`desktop/release/release-notes-evidence.md` summary matches the current
release evidence version, commit, generation timestamp, source repository/ref,
event/ref type, redacted signing/notarization credential strategy, artifact
verification summary, including signing and notarization evidence details,
checksum manifest reference, pipeline step summary, pinned toolchain, lockfile
digest, release tooling digest summary, UX validation digest and summary,
screenshot count, and UX screenshot summaries, and that
`release-evidence.json` records the notes summary path, size, and SHA-256 so
release notes cannot rely on stale copied evidence. The `app.asar`
inspection uses the explicit
`@electron/asar` dev dependency through `npx --no-install asar` so release
verification fails rather than downloading inspection tooling during CI.
When `desktop:release-ci` is writing `release-evidence.json`, it records the
artifact verification checks without the release-evidence self-checks and
verifies checksums against the `SHA256SUMS` contents generated from the current
artifact digests, so the new evidence file cannot depend on stale or missing
previous evidence or checksum manifest files. The first `desktop:verify-release`
step is allowed to run before its own pass record exists, then
`desktop:release-ci` writes that pass record into `release-evidence.json` and
runs `final-verify-release` against the final evidence so the archived evidence
also proves `desktop:verify-release` passed. Both verify steps must record the
explicit allow-missing environment variable used for their bootstrap phase, so
archived evidence shows that missing self-proof was deliberately scoped to that
single verification pass.
It is intentionally a post-build artifact check: `desktop:prod-check`
proves the release environment is configured, while `desktop:verify-release`
proves the artifacts are signed, notarized, Gatekeeper-assessable, and complete
enough to archive.

For release CI, run the full signed release pipeline:

```sh
bun run desktop:release-ci
```

To validate release secrets, UX evidence, and the macOS runner before starting
the long build/sign/notarize pipeline, run:

```sh
bun run desktop:release-preflight
```

This runs the same environment, UX validation, and runner preflight records that
`desktop:release-ci` writes into release evidence, then stops before
`source-check`, build, smoke, packaging, signing, or artifact verification.
The package script uses the explicit `preflight:all` release-ci phase; narrower
`preflight:environment`, `preflight:ux-validation`, and `preflight:runner`
phases are reserved for ordered release evidence records and targeted
diagnostics.

This command requires `DESKTOP_RELEASE_VERSION`, Developer ID Application
signing configuration (`CSC_LINK` plus `CSC_KEY_PASSWORD`, or `CSC_NAME`
starting with `Developer ID Application:`), and exactly one Electron Builder
notarization credential strategy per release: App Store Connect API key, Apple
ID app-specific password, or a stored keychain profile. It also requires the
completed UX validation record via either
`DESKTOP_UX_VALIDATION_EVIDENCE_BASE64` or
`DESKTOP_UX_VALIDATION_EVIDENCE_PATH` so approval evidence is available before
the signed release pipeline starts. It also preflights the
runner before starting long build steps: release CI must run on macOS with
Xcode command line tools installed and `xcrun --find notarytool` working. When
`CSC_NAME` is used instead of `CSC_LINK`, release CI also verifies that the
configured Developer ID Application identity is present in the runner keychain.
When `CSC_LINK` or App Store Connect `APPLE_API_KEY` is provided as a local
path, release CI verifies the file exists and can be opened before starting
long build steps.
Inline `CSC_LINK` values must be real certificate bundle bytes encoded as
base64, not base64-encoded example text.
Inline `APPLE_API_KEY` values must contain the `.p8` private key PEM; malformed
inline API key strings, non-10-character API key IDs, and non-UUID issuer IDs
are rejected during release environment preflight.
On the macOS release runner, App Store Connect API key preflight also opens the
private key with `openssl pkey` before long build steps.
It also verifies `bun`, local `electron-builder`, and local `@electron/asar`
are available before the pipeline spends time on signed packaging.
The GitHub Actions workflow installs the Bun version declared by
`package.json` `packageManager`, so release candidates are not built with a
moving `latest` toolchain. It also installs the exact Node version declared by
`package.json` `engines.node`, so Electron packaging and release scripts run on
a fixed Node runtime. Dependency installation uses `bun install
--frozen-lockfile` against the committed `bun.lock`, which keeps release builds
stable even while the source snapshot still contains `latest` dependency
specifiers.
Release CI also rejects tracked source-tree changes and incomplete
`desktop/release/ux-validation-evidence.md` before the first build step, so
signed artifacts are produced from committed source and completed release
approval evidence rather than local edits or placeholder checklists.
The GitHub Actions release workflow passes the completed checklist as
`DESKTOP_UX_VALIDATION_EVIDENCE_BASE64` from the `ux_validation_evidence_base64`
workflow input, or from the same-named secret for tag-triggered releases.
For a manual release runner, `DESKTOP_UX_VALIDATION_EVIDENCE_PATH` may point at
an existing completed markdown checklist instead. `desktop:release-ci` owns
materializing either input into `desktop/release/ux-validation-evidence.md` and
checking the completed record so failures are recorded in
`desktop/release/release-evidence.json`. The release environment preflight
rejects malformed base64, unreadable paths, or non-UTF-8 evidence before any
signed build step starts, so release operators see the credential and
approval-input error before packaging work begins.
That decode and validation step runs before the macOS runner preflight, so a
candidate with valid UX approval evidence still archives
`ux-validation-evidence.md` even if the runner later fails because a signing
identity, notarytool, or local build tool is missing.
Release CI reports environment, UX validation evidence, and runner preflight
failures with separate headings so the release operator can distinguish missing
credentials from an incomplete approval checklist or an unready macOS runner.
It runs the desktop compile check, desktop tests, Electron smoke, production
readiness, signed packaging, packaged smoke, and release artifact verification
in order. The compile check builds the embedded CLI runtime, Electron
main/preload bundle, and renderer bundle that are actually packaged into the
desktop app. It writes
`desktop/release/release-evidence.json` with the release version, commit,
platform, source repository/ref/CI run metadata, redacted signing and
notarization credential strategy metadata, artifact paths, file sizes, SHA-256
checksums, pinned Bun and Node toolchain versions, `bun.lock` path, size,
SHA-256, release tooling paths/sizes/SHA-256 values for the release CI script,
release verifier, and GitHub release workflow, and per-step pass/fail timing.
Environment, runner, and UX
validation preflight failures are also written to this evidence file before
release CI exits, so failed release candidates still leave an auditable artifact.
Before writing preflight or release evidence, `desktop:release-ci` removes stale
generated output from `desktop/release`, including old app bundles, DMGs, ZIPs,
blockmaps, electron-builder metadata, screenshots, release evidence, release notes evidence, and
`SHA256SUMS`, while preserving the completed `ux-validation-evidence.md` input.
Preflight-only evidence is deliberately isolated from any existing files in
`desktop/release`: it records no artifact digests, records no artifact
verification checks, marks `evidencePurpose` as `preflight-only`, and removes
stale `SHA256SUMS` before exiting so a failed preflight cannot archive checksums
from an older build or look like completed artifact release evidence. The
evidence also records the
`desktop:verify-release` artifact check IDs, status, and evidence strings,
including signing, notarization, archive integrity, embedded runtime, and app
metadata checks, and final verification compares those recorded check details
against the current artifact verification run so release notes and rollback
reviews do not depend on stale log scraping. Release CI also captures the final
`desktop:smoke-electron` JSON summary in the `smoke-electron` step record,
archives the required desktop feature flags in `release-evidence.json`, writes
them into `release-notes-evidence.md`, and fails the release candidate when
first-class Settings, Agents, Teams, scheduled tasks, MCP management, skill
installation, command/composer shortcut flags, or `terminalMode: "pty"` evidence are missing or false. When file artifacts exist, release CI also writes
`desktop/release/SHA256SUMS` from the same artifact digest data and records that
manifest's path, size, and SHA-256 in release evidence for publishing and
rollback review. Packaged smoke defaults screenshot capture to
`desktop/release/ux-screenshots`, and release CI passes the same path explicitly
so both local package validation and release runs leave visual review evidence;
the packaged smoke wrapper fails if required screenshots such as chat streaming,
terminal, preview, desktop and narrow settings, MCP management, Skills
management, Command Palette, agents, selected-agent actions, scheduled tasks,
teams management, composer actions, permission review, Files, Editor, Diff, or
unsaved editor guard states are missing or not PNG files.
Release CI also writes
`desktop/release/release-notes-evidence.md` as a human-readable summary for
release notes and approval review, including the same source event/ref type
metadata and release tooling digests required by the JSON release evidence. The JSON evidence records the completed
`desktop/release/ux-validation-evidence.md` path, size, and SHA-256, and records
the notes summary's path, size, and SHA-256 so the final release verifier can
prove the archived markdown came from the same release CI run. The repository also includes
`.github/workflows/desktop-release.yml` as a GitHub Actions release runner
template for macOS artifacts; its tag path normalizes `desktop-v*` refs into
plain semver before invoking `desktop:release-ci`. Release scripts and packaged
artifact file paths keep using that normalized release version, while GitHub
artifact names use a separately validated `artifact-suffix` so malformed manual
version input cannot create unsafe upload names. The normalized raw release
version is written to `$GITHUB_ENV` and `$GITHUB_OUTPUT` with delimiter-safe
environment file syntax rather than single-line `echo`, so malformed manual
input cannot inject additional environment or output keys before release
preflight records the failure. If version preflight fails before a valid
artifact suffix exists, the workflow falls back to
`invalid-${GITHUB_RUN_ID}` for evidence and diagnostics artifact names so the
release runner can still archive the failed candidate. After successful signed
artifact generation, the isolated publish job downloads the artifact, evidence,
and diagnostic uploads by that safe suffix and creates the GitHub Release body
from `release-notes-evidence.md`. Before publishing, it runs
`sha256sum --check` against the downloaded `SHA256SUMS` inside the artifact
directory and asserts that the current-version DMG and ZIP are present, so
uploaded artifacts are rechecked after the Actions artifact transfer. It also
parses the downloaded `release-evidence.json` and rejects publishing when the
evidence version does not match the normalized release version, when the
evidence is marked `preflight-only`, when `verify-release` or
`final-verify-release` did not pass with exit code 0, or when the app/DMG
Gatekeeper and notarization evidence is not passing. It also compares release
evidence source metadata against the current GitHub Actions repository, ref
name, ref type, event name, commit, run id, run attempt, and exact run URL, so
a publish job cannot attach evidence from another run. The publish job also recomputes the
downloaded `SHA256SUMS`, `release-notes-evidence.md`, and
`ux-validation-evidence.md` size/SHA-256 values and compares them with
`release-evidence.json`, then verifies every downloaded packaged smoke
screenshot listed in `uxScreenshots` against its recorded size/SHA-256, so
checksum, evidence attachments, and screenshots cannot drift after artifact download.
After those checks pass, it builds a stable `ux-screenshots.zip` archive from the
verified PNG files so screenshot review evidence is attached to the draft
Release rather than remaining only in the Actions diagnostics artifact.
Publishing uses `fail_on_unmatched_files: true` and attaches the current-version
DMG/ZIP, `SHA256SUMS`, `release-evidence.json`,
`release-notes-evidence.md`, `ux-validation-evidence.md`, and
`ux-screenshots.zip`, so a release cannot publish if a signed distributable or
audit-evidence file is missing. The GitHub Release is created as a draft and
remains non-public until the final production gate passes. After upload, the
publish job queries the draft GitHub Release with `gh release view` and rejects
the run unless the release tag/name, draft/prerelease state, duplicate asset
names, current-version DMG/ZIP assets, checksum manifest, release evidence,
release notes evidence, UX validation evidence, and `ux-screenshots.zip` are
all present on the draft Release. It then downloads the draft Release assets
with `gh release download` and compares the downloaded asset names, sizes, and
SHA-256 hashes
against the already verified local files, so a release cannot pass with a
present-but-corrupt or stale downloadable asset. After that succeeds, it runs
`bun run desktop:write-published-release-evidence` to write
`published-release-evidence.json` with the published release identity, stable
GitHub Release database id, public Release URL, CI run metadata including
ref/event/commit/run URL, draft release state, and downloaded asset hashes,
uploads that file to the GitHub Release, downloads it back, then runs
`bun run desktop:verify-published-release` to compare the
downloaded evidence file against the uploaded local file by size and SHA-256
and validate the schema, release metadata, CI source metadata, generated
timestamp, the fixed published asset set, and each asset hash entry against the
downloaded release asset directory. The final `production-gate` job then writes
and uploads retained `production-gate-evidence.json` while checking those
restored signed artifacts and downloaded draft Release assets. After that gate
passes, the separate `publish-public-release` job verifies the downloaded
`production-gate-evidence.json` Actions artifact against the retained
`published-release-evidence.json`, uploads it to the Release, downloads it back
for size/SHA-256 comparison, undrafts the Release, and verifies the final public
tag/name, non-draft/non-prerelease state, and required asset set, including the
uploaded `production-gate-evidence.json` Release asset. It then downloads the
final public Release assets and compares every expected asset name, size, and
SHA-256 against the retained published-release, production-gate, and published
evidence inputs.
It also runs `desktop:write-public-release-evidence` and
`desktop:verify-public-release` before uploading `public-release-evidence.json`
with the final public Release identity, stable GitHub Release database id,
public Release URL, sorted asset names, public asset metadata including positive
size and GitHub Release asset URLs bound to the same repository with numeric
asset ids, no query/hash data, and no duplicate URLs, repository, ref name, ref
type, event name, commit, run id, run attempt, run URL, and matching production
gate metadata plus matching published Release identity so public publication has
retained audit evidence beyond CI logs. For assets already verified in
`published-release-evidence.json`, final public asset metadata must preserve the
same size.
The workflow uploads
`release-evidence.json` and release notes evidence as a required core evidence
artifact with `if: always()` so failed release candidates still leave auditable
evidence. UX validation evidence, checksum manifests, and packaged smoke
screenshots are uploaded as a separate supplemental diagnostics artifact when
those files exist; early preflight failures may not produce them. The packaged
`.app` bundle is tarred before GitHub artifact upload so macOS bundle
permissions and symlinks survive the final gate artifact round trip. The app
bundle tarball, DMG, and ZIP are uploaded as a separate signed-artifacts
artifact only when `desktop:release-ci` succeeds, so failed candidates do not
archive unverified app bundles as release outputs.

## Current Status

As of the latest audit, the app is **not production-ready**. It is a functional
local MVP with broad smoke coverage.

Known blockers:

| Gate | Status | Why it blocks production | Next action |
| --- | --- | --- | --- |
| Production version | Blocked without release env | `package.json` intentionally uses `999.0.0-local` for source snapshots; release-aware build scripts inject `DESKTOP_RELEASE_VERSION` into CLI and Electron artifacts. | Set `DESKTOP_RELEASE_VERSION` to a real semver version in release CI. |
| Release toolchain | Configured | `package.json` pins `packageManager` to a Bun version and `engines.node` to an exact Node version, `.github/workflows/desktop-release.yml` resolves `BUN_VERSION` and `NODE_VERSION` from those fields, and `desktop:prod-check` rejects floating Bun/Node versions. | Keep the pinned Bun and Node versions intentional and update them with release validation. |
| Dependency lockfile | Configured | `bun.lock` is committed and `.github/workflows/desktop-release.yml` installs dependencies with `bun install --frozen-lockfile`; `desktop:prod-check` enforces both. | Update dependencies only through reviewed lockfile changes. |
| Desktop compile check | Configured | `desktop:check` builds the embedded CLI runtime, Electron main/preload bundle, and renderer bundle before release packaging. | Keep this immediately after `source-check` so packaged code is proven buildable before signing. |
| Full source type checking | Configured | `bun run check` passes and `desktop:release-ci` records it as the `source-check` step before desktop build, test, smoke, and signing work. `desktop:verify-release` requires that step in release evidence so a signed artifact cannot be verified without the full TypeScript gate. | Keep `source-check` before packaging and keep `bun run check` green before tagging a release. |
| Workspace cwd validation | Configured | Picker, default workspace, renderer `sessions:create`, deep-link session creation, and cwd-based workspace IPC paths all pass through shared workspace directory validation, which uses `lstat(cwd)` and rejects missing paths, files, and symlinked workspace directories before local runtime, file, git, terminal, project MCP, project skills, plugins, agents, or project scheduled-task operations touch local state. Project MCP and project scheduled-task JSON read/write targets reject symlink files before touching project configuration. Files tree traversal uses `lstat` and skips symlinks so it cannot follow symlinked directories outside the workspace. `desktop:prod-check` enforces this wiring. | Keep every future session-creation and cwd-based workspace IPC entrypoint behind the shared directory validator, keep project configuration writes behind file-target validation, and keep Files tree traversal symlink-aware. |
| Production app id | Configured | `electron-builder.json` uses `com.anthropic.claude-code-desktop`. | Keep this stable across releases. |
| Electron main metadata | Configured | `package.json` and `desktop/electron-builder.json` both point to `desktop/dist/main/main.js`, and `desktop:prod-check` enforces that they stay aligned. | Keep both metadata paths aligned with the built Electron main bundle. |
| Packaging scope | Configured | `desktop:prod-check` verifies Electron Builder packages only built desktop bundles, `desktop/release-policy.json`, package metadata, the embedded CLI runtime, and filtered `node-pty` runtime resources while excluding local `desktop/release` artifacts/evidence, tests, scripts, source snapshots, and the full dependency tree. | Keep future packaging changes behind the same allowlist; add explicit runtime resources instead of broad source or dependency globs. |
| macOS hardened runtime | Configured | `mac.hardenedRuntime` and entitlements files are configured. | Verify signed packaged builds on macOS release CI. |
| macOS notarization | Blocked | `mac.notarize=true` enables Electron Builder's notarization integration, but Apple notarization credentials are external and not configured in this repo. `APPLE_API_KEY` values must be a local `.p8` path or inline private key PEM, and path-based keys are checked on the release runner. | Configure CI secrets for App Store Connect API key, Apple ID app-specific password, or a stored keychain profile. |
| Code signing | Blocked | `mac.forceCodeSigning=true` makes packaging fail if signing is skipped, but local packaged smoke does not have a real Developer ID Application signing identity. `desktop:prod-check` verifies that a signing identity is configured, while `desktop:release-preflight` and `desktop:production-gate` prove release-runner availability. Inline `CSC_LINK` values must be valid base64, non-placeholder, and large enough to be a complete PKCS#12 bundle; path-based `CSC_LINK` values are checked for file availability, and `CSC_NAME` identities are checked with `security find-identity -v -p codesigning` on the release runner. | Configure `CSC_LINK` with a Developer ID Application certificate, or set `CSC_NAME` to a `Developer ID Application:` identity with its 10-character Team ID in release CI. |
| Signed artifact verification | Configured, blocked until signed artifacts exist | `desktop:verify-release` checks the produced app and DMG with `codesign`, `spctl`, and `xcrun stapler validate`, confirms `codesign -dv` reports a leaf `Developer ID Application:` authority, a complete Developer ID certificate chain through `Developer ID Certification Authority` and `Apple Root CA`, a Team ID matching `TeamIdentifier`, and confirms the same `TeamIdentifier` for both app and DMG, confirms the zip release archive exists, validates zip structure with `ditto -t -k`, confirms zip contents include the app bundle with `unzip -l`, validates DMG structure with `hdiutil verify`, verifies `desktop/release/SHA256SUMS`, `desktop/release/release-evidence.json`, `desktop/release/release-notes-evidence.md`, and `desktop/release/ux-validation-evidence.md` match DMG/ZIP file hashes, checksum manifest path and metadata, release evidence schema/product/generated timestamp metadata, target platform/architecture metadata, artifact paths for the verified `.app`, `.dmg`, and `.zip`, artifact digest paths and checksums for the verified `.dmg` and `.zip`, internally consistent release evidence CI source repository/ref/commit, desktop-v tag/version, and GitHub HTTPS CI run URL metadata, release evidence `releaseCredentials` redacted signing/notarization strategy/source combinations without raw credential fields, raw private key/password material and raw signing/notarization environment value absence from release evidence and notes, including shell-style assignments, release notes evidence path and metadata including redacted credential strategy, signing/notarization evidence details, release tooling summary, and UX screenshot summaries, completed UX validation evidence path and metadata plus release approval pass gates, release version, pinned toolchain and current-checkout `bun.lock` path and metadata, current-checkout release CI script, verifier script, and release workflow path/size/SHA-256 metadata, required artifact verification checks recorded as passing with stale check detail detection against the current verification run, required release preflight and pipeline steps including `release-ux-validation` and `verify-release` recorded as passing with expected command arguments and smoke screenshot environment in `desktop:release-ci` order, and UX screenshot paths, directory containment, required screenshot names, metadata, and PNG signatures matching archived files, confirms `app.asar` embeds the Electron main/preload/renderer bundles with production package main/version metadata using explicit `@electron/asar` plus `npx --no-install`, confirms the app embeds `dist/claude-local` plus node-pty native resources with required executable permissions, and verifies `Info.plist` app id/version metadata. Unsigned local builds are expected to fail. | Run it after `desktop:build` on the signed macOS release runner. |
| Release CI automation | Configured, blocked until secrets exist | `desktop:release-ci` and `.github/workflows/desktop-release.yml` run the signed release pipeline from `workflow_dispatch` with a required version input or `desktop-v*` tag pushes in the `desktop-release` GitHub Environment with every action ref pinned to a major tag or full SHA, a bounded job timeout, minimal token permissions, source checkout before dependency installation, package metadata version resolution before toolchain setup, toolchain setup before frozen dependency installation, required secret checks, `desktop-v*` tag normalization before release generation, serialized release concurrency by version/tag, clean tracked-source preflight for unstaged and staged changes, fail-fast execution before artifact upload, and macOS/notarytool/build-tool runner preflight. Resolved Bun, Node, and normalized release versions are exposed through step outputs for action inputs and artifact paths; normalized raw release versions use delimiter-safe GitHub environment file writes, while GitHub artifact upload names use `steps.release-version.outputs.artifact-suffix`, which falls back to `invalid-${GITHUB_RUN_ID}` when malformed version input fails preflight, so failed evidence uploads still have safe names. The toolchain resolver steps write only `BUN_VERSION` and `NODE_VERSION` into the runner environment so a generic `version` environment variable cannot shadow the release version. `DESKTOP_RELEASE_VERSION` remains in the runner environment for release scripts. `desktop:prod-check` reuses the release environment preflight so local readiness and release CI enforce the same credential rules, and checks that after `desktop:release-ci` the workflow always uploads retained artifact-safe core release evidence, uploads retained artifact-safe supplemental diagnostics when they exist, tars the signed `.app` bundle before GitHub artifact upload, uploads retained artifact-safe signed app bundle tarball, current-version `.dmg`, and current-version `.zip` artifacts only after release generation succeeds, rechecks downloaded DMG/ZIP checksums and downloaded release evidence including current CI source metadata, archives verified UX screenshots, creates a draft `desktop-v<version>` GitHub Release with verified DMG/ZIP, checksum, release evidence, release notes evidence, UX validation evidence, and UX screenshot archive from a separate protected `contents: write` job that checks out source and sets up the pinned Bun version before running desktop evidence scripts, verifies the draft Release identity and asset list, downloads every draft asset and compares it with the verified local files, then uses `desktop:write-published-release-evidence` and `desktop:verify-published-release` to upload and verify `published-release-evidence.json` including size/SHA-256 comparison and schema/content validation, uploads that evidence for final gating, runs a protected macOS final production gate that restores the app bundle tarball before verifying signed artifacts and draft Release evidence, uploads retained `production-gate-evidence.json`, and only then verifies the downloaded `production-gate-evidence.json` Actions artifact against retained `published-release-evidence.json`, uploads it to the Release, downloads that uploaded Release asset back, compares its size and SHA-256 with the local gate evidence file, and undrafts the verified Release publicly from a separate protected `contents: write` job that checks out source, sets up the pinned Bun version, runs `desktop:write-public-release-evidence`, runs `desktop:verify-public-release` with production gate evidence and published Release identity binding by default, and uploads retained `public-release-evidence.json` with sorted asset names plus public asset size/URL metadata. | Add the signing and Apple notarization secrets to the protected `desktop-release` environment, and run on a macOS runner with Xcode command line tools. |
| Release evidence | Configured, blocked until release CI runs | `desktop:release-ci` writes `desktop/release/release-evidence.json` with source repository/ref/CI run metadata, redacted signing/notarization credential strategy metadata, artifact paths, artifact SHA-256 checksums, sizes, pinned Bun/Node toolchain metadata, `bun.lock` path/size/SHA-256 metadata, release CI script, verifier script, and release workflow path/size/SHA-256 metadata, checksum manifest metadata, release notes evidence metadata, completed UX validation evidence metadata and approval summary, UX screenshot metadata, preflight and pipeline step status, failure reasons, and artifact verification check evidence generated without stale release-evidence or checksum-manifest self-checks. It fails before long build steps when UX validation evidence is missing, still has placeholders, lacks a validator/date, lacks a representative user/date, lacks `UX release approval: approved` with approver/date, omits required manual task rows, records failed screenshot/manual task results, records blocking issues, or does not accept known limitations with an approver; it also writes `desktop/release/SHA256SUMS` for file artifacts and `desktop/release/release-notes-evidence.md` with release tooling and UX validation summaries for review. The release workflow always uploads `release-evidence.json` and release notes evidence using `retention-days: 90`; UX validation evidence, checksum manifests, and screenshots are supplemental diagnostics uploaded when present; `final-verify-release` checks the archived evidence after it records the first `verify-release` pass, including that recorded artifact paths still point to the verified `.app`, `.dmg`, and `.zip`, that recorded release tooling metadata matches the current checkout, that UX release approval pass gates and summary metadata still match the archived checklist, and that recorded required check details still match the current artifact verification run. | Archive the evidence JSON, release notes evidence, UX validation evidence, checksum manifest, and screenshots for every release candidate when available. |
| Release UX screenshots | Configured, blocked until release CI runs | Packaged smoke captures `desktop/release/ux-screenshots/**/*.png`; the release workflow uploads them with the supplemental diagnostics artifact when present, verifies their size/SHA-256 metadata before publishing, then attaches a stable `ux-screenshots.zip` archive to the GitHub Release. | Review the screenshots before release approval and retain the published screenshot archive with the release evidence. |
| UX validation checklist | Configured, blocked until completed per release | `docs/desktop-ux-validation-checklist.md` defines screenshot review, validator, representative user, and observed representative user validation with `YYYY-MM-DD` dates, required manual task script including Command Palette and native View menu navigation, native Help menu Command Palette/Refresh Settings/Export Diagnostics actions, lifecycle create commands, Settings management commands, MCP/Skill inspection, composer resources/actions, and composer lifecycle/Settings shortcuts, no blocking issues, accepted known limitations, and UX approval; `desktop:release-preflight` rejects completed UX evidence whose Version or Commit does not match the release candidate before long build steps run; `desktop:verify-release` requires a completed copy at `desktop/release/ux-validation-evidence.md` with no template placeholders, explicit Screenshot Review table Evidence cells for the required packaged smoke screenshots, screenshot rows marked `pass` or `n/a`, every required manual task present and marked `pass`, observed representative user validation, no blocking issues, known limitations accepted, and `UX release approval: approved`. | Complete and archive the checklist for every release candidate before final verification. |
| Update policy | Configured as manual | `desktop/release-policy.json` declares manual updates until an update service exists. | Add auto-update only after a supported update service is available. |
| Electron sandbox | Configured | `BrowserWindow.webPreferences.sandbox=true` is enabled. The preload is bundled as `desktop/dist/preload/preload.cjs`, which works with Electron's sandboxed preload restrictions, and Electron smoke verifies preload IPC availability under sandbox. | Keep preload sandbox-compatible and keep `desktop:prod-check` enforcing `sandbox=true`. |
| External URL validation | Configured | `preview:openExternal`, top-level navigation, and `window.open` all pass through allowlisted URL validation; navigation blocks control characters and credentialed HTTP(S) URLs and returns normalized hrefs for external open. `desktop:prod-check` enforces this wiring. | Keep all future `shell.openExternal` inputs behind the shared URL policy or explicit hardcoded trusted URLs. |
| IPC security review | Configured | `docs/desktop-ipc-security-review.md` defines the review checklist for privileged filesystem, process, terminal, git, plugin, MCP, skill, agent, team, and scheduled-task IPC channels, and `desktop:prod-check` enforces the checklist. | Keep the checklist updated whenever an IPC channel or privileged handler changes. |
| Deep link validation | Configured | `claude://resume` and `claude-dev://resume` parsing accepts only safe session ids and absolute local `cwd` paths, rejects control characters and oversized inputs, and `desktop:prod-check` enforces the parser guardrails. | Keep the desktop parser aligned with the CLI deep-link input boundary. |
| Crash diagnostics | Local export configured | Settings can export a redacted local diagnostic bundle with app/runtime versions, session summaries, manual update policy, failed update event counts, and renderer/runtime operational events. | Add remote crash collection only after privacy and support policy review. |
| Release support docs | Template configured | `docs/desktop-release-notes-template.md` covers verification evidence, known limitations, diagnostics support, rollback, and release approval. | Fill the template for every release candidate. |
| Team member mutation | Configured for MVP | Teams can show members, spawn a teammate through the Agent tool runtime path, message one member or all members, request graceful shutdown, remove stale local membership records from `.kode/teams/<name>/config.json`, and delete teams through TeamDelete. Runtime force-kill is intentionally not exposed because the runtime provides graceful shutdown, not arbitrary member deletion. | Keep Remove scoped to local membership cleanup unless the runtime later exposes a safe `TeamMemberRemove` or equivalent operation. |
| UX validation | Configured, blocked until completed per release | Agent/team comprehension has smoke coverage and release evidence now requires observed representative user validation before approval. | Capture screenshots and run the manual task script with a target user for each release candidate. |

The signed artifact verification and release evidence gates also require the
`smoke-electron` step to archive a `smokeSummary` object with required desktop
feature flags. Missing or false flags for first-class Settings, Agents, Teams,
scheduled tasks, MCP management, skill installation, or command/composer
shortcuts, or missing/non-PTY terminal mode evidence, block
`desktop:verify-release` and prevent the archived evidence from passing final
release review.

## Required Release Command Set

Before a release candidate can be tagged, run:

```sh
export DESKTOP_RELEASE_VERSION=x.y.z
bun run desktop:prepare-ux-validation
bun run desktop:release-preflight
bun run check
bun run desktop:check
bun run desktop:test
DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-electron
bun run desktop:prod-check
DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-packaged
bun run desktop:verify-release
bun run desktop:production-gate
```

`desktop:prepare-ux-validation` writes
`desktop/release/ux-validation-evidence.md`; complete every placeholder and run
`bun run desktop:prepare-ux-validation -- --check` before final verification.
The preflight, source check, desktop build checks, tests, and smoke commands
must exit 0 for MVP quality. `desktop:prod-check` must exit 0 before signed
packaging, `desktop:verify-release` must exit 0 after the release artifacts
are built, and `desktop:production-gate` must exit 0 before release approval.
On the release runner, `bun run desktop:release-ci` is the canonical
single-command equivalent for the full ordered pipeline; use
`bun run desktop:release-preflight` first when validating newly configured
signing, notarization, or UX evidence inputs.
The publish job then uses `bun run desktop:write-published-release-evidence`
after downloading the draft GitHub Release assets and
`bun run desktop:verify-published-release` after downloading the uploaded
`published-release-evidence.json` back from GitHub.

The release runner must be macOS. Before invoking the full pipeline, confirm:

```sh
xcode-select -p
xcrun --find notarytool
```

If Xcode or command line tools were installed recently, accept the Xcode
license before running release CI. `desktop:release-ci` fails before long build
steps when these runner prerequisites are missing.

Local non-release desktop builds intentionally override Electron Builder with
`mac.forceCodeSigning=false` and `mac.notarize=false` so developers can run
`bun run desktop:smoke-packaged` without Apple credentials. Release builds are
selected by `DESKTOP_RELEASE_VERSION`; they keep the production
`mac.forceCodeSigning=true` and `mac.notarize=true` settings and must run on
the signed release runner.

## Implementation Plan To Reach Production

### Task 1: Release Identity And Signing

- Replace `local.claude-code.desktop` with the owned production app id.
- Use `DESKTOP_RELEASE_VERSION` in release CI so production artifacts never use
  `999.0.0-local`. `desktop/scripts/build-cli.mjs` injects it into
  `MACRO.VERSION`; `desktop/scripts/build-desktop.mjs` temporarily injects it
  into package metadata while Electron Builder runs, then restores the source
  `package.json`.
- Keep macOS hardened runtime and entitlements wired through
  `desktop/electron-builder.json`.
- Keep `mac.forceCodeSigning=true` so Electron Builder fails the release build
  instead of producing an unsigned macOS artifact when signing configuration is
  wrong.
- Keep local non-release build overrides in `desktop/scripts/build-desktop.mjs`
  so unsigned packaged smoke remains available without weakening release builds.
- Keep `mac.notarize=true` in `desktop/electron-builder.json`; with complete
  Apple credentials, Electron Builder invokes `@electron/notarize` before the
  release artifact verification step.
- Ensure `bun --version`, `npx --no-install electron-builder --version`, and
  `npx --no-install asar --version` work from the repository checkout on the
  release runner.
- Configure release CI with signing and notarization secrets.
- Use a Developer ID Application certificate for signing. `CSC_LINK` may point
  at a local certificate bundle or provide the bundle as inline base64, and must
  be paired with `CSC_KEY_PASSWORD`; if using `CSC_NAME`, it must match a
  `Developer ID Application:` identity installed in the release runner
  keychain with its 10-character Team ID suffix, for example
  `Developer ID Application: Example Corp (ABCDE12345)`, not a Developer ID
  Installer or development certificate. When `CSC_LINK` is a local path,
  `desktop:release-ci` verifies the file exists before running the build; when
  it is inline, release preflight rejects malformed base64 and base64-encoded
  placeholder text before packaging. On the macOS release runner, preflight
  also opens the certificate bundle with `openssl pkcs12` and passes
  `CSC_KEY_PASSWORD` through the process environment rather than command-line
  arguments.
- Verify with `bun run desktop:prod-check`, a signed packaged smoke run, and
  `bun run desktop:verify-release`.
- Keep `.github/workflows/desktop-release.yml` current with the required
  signing and notarization secrets. Prefer App Store Connect API key secrets:
  `DESKTOP_APPLE_API_KEY`, `DESKTOP_APPLE_API_KEY_ID`, and
  `DESKTOP_APPLE_API_ISSUER`. When `DESKTOP_APPLE_API_KEY` is a local path,
  `desktop:release-ci` verifies the file exists and opens it with
  `openssl pkey` before running the build; when it is inline, it must contain
  the `.p8` private key PEM and is also opened with `openssl pkey` before long
  build steps. The key ID must be the 10-character App Store Connect key ID and
  the issuer must be the App Store Connect issuer UUID. Apple ID fallback
  notarization requires an email-shaped `APPLE_ID`, an app-specific password,
  and a 10-character Apple Team ID.
  Keychain profile fallback requires a simple stored profile name; when
  `DESKTOP_APPLE_KEYCHAIN` is set, it must be a local keychain path. The
  fallback secrets are wired for compatibility, but
  `desktop:release-ci` rejects release environments that configure more than
  one active notarization strategy:
  `DESKTOP_MAC_CSC_LINK`, `DESKTOP_MAC_CSC_KEY_PASSWORD`,
  `DESKTOP_MAC_CSC_NAME`, `DESKTOP_APPLE_ID`,
  `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`, `DESKTOP_APPLE_TEAM_ID`,
  `DESKTOP_APPLE_KEYCHAIN`, and `DESKTOP_APPLE_KEYCHAIN_PROFILE`.

### Task 2: Security Hardening

- Review every `shell.openExternal` call and ensure URL allowlisting happens
  before the call.
- Keep `BrowserWindow.webPreferences.sandbox=true` enabled and keep the preload
  bundle sandbox-compatible as `desktop/dist/preload/preload.cjs`. Re-run
  Electron smoke after preload, packaging, or IPC bridge changes.
- Keep `docs/desktop-ipc-security-review.md` current for IPC channels that
  touch filesystem, process, terminal, git, plugins, MCP, skills, agents,
  teams, and scheduled tasks; `desktop:prod-check` enforces the checklist.
- Keep `nodeIntegration: false`, `contextIsolation: true`, and restrictive CSP
  as non-negotiable gates.

### Task 3: Operations And Diagnostics

- Keep the user-triggered diagnostic export current. It must include app
  version, platform, Electron version, renderer crash/unresponsive history,
  session status summaries, redacted runtime errors, update policy, and failed
  update event counts.
- Keep main-process handlers for renderer process gone/unresponsive events.
- Use `docs/desktop-release-notes-template.md` for every release candidate.
  It records known limitations, diagnostic support, verification evidence,
  rollback procedure, and approval owners.

### Task 4: Product Gaps

- Keep team member Remove scoped to local membership cleanup unless the runtime
  exposes a real `TeamMemberRemove` or equivalent operation; current teammate
  spawn uses the existing Agent tool path and shutdown uses a SendMessage
  shutdown request.
- Expand composer `@` resources beyond files/teams/agents only after the
  backing sources are reliable.
- Improve Todo rendering if the runtime exposes a stronger Todo state model than
  current tool-event/message-derived state.

### Task 5: Production Validation

- Run the full release command set on a clean machine.
- Prefer `bun run desktop:release-ci` on the release runner so command ordering
  and required secret checks stay consistent.
- Archive `desktop/release/release-evidence.json` with the signed artifacts and
  paste its source metadata, command summary, toolchain and `bun.lock`
  metadata, artifact SHA-256 checksums, and artifact verification summary with
  signing/notarization evidence details into the release notes.
- Archive `desktop/release/SHA256SUMS` with the signed artifacts and publish the
  checksum lines alongside the downloadable files.
- Archive and inspect `desktop/release/ux-screenshots/**/*.png` from packaged
  smoke before release approval; for GitHub Actions releases, verify the
  published `ux-screenshots.zip` attachment is present with the Release.
- Complete `docs/desktop-ux-validation-checklist.md`, save the completed copy as
  `desktop/release/ux-validation-evidence.md`, and archive it with the signed
  artifacts.
- For GitHub Actions release runs, base64-encode the completed file and provide
  it as the `ux_validation_evidence_base64` workflow input, or configure
  `DESKTOP_UX_VALIDATION_EVIDENCE_BASE64` for tag-triggered releases. The value
  must decode as UTF-8 markdown.
- For manual release runs, set `DESKTOP_UX_VALIDATION_EVIDENCE_PATH` to the
  completed markdown checklist path instead of base64-encoding the file.
- Run packaged smoke on every target OS that will be distributed.
- Run `bun run desktop:verify-release` on the macOS release runner after
  artifacts are built and before publishing them.
- Run a manual user script covering new session, edit/save/diff, terminal,
  preview, permission, agent task, team message, Command Palette, native View
  menu navigation, `@`, `/`, tool activity, and Todo visibility.
- Capture screenshots for Chat, Settings, MCP management, Skills management,
  Command Palette, Agents, scheduled tasks, Teams, composer actions, Files,
  Editor, Diff, Terminal, Preview, and permission modal.
- Complete `docs/desktop-ux-validation-checklist.md` and attach it to the
  release notes for approval.

## Release Decision Rule

Do not call Claude Code Desktop production-ready until:

- `bun run desktop:prod-check` exits 0 in the release environment.
- `bun run desktop:verify-release` exits 0 against the signed release
  artifacts.
- All MVP behavior tests exit 0 in the same release commit.
- Signing/notarization artifacts are produced by CI, not by an ad hoc local
  command.
- The UX validation checklist is completed for the release candidate.
- The remaining known limitations are documented in release notes and accepted
  by the product owner.
