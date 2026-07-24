# Claude Code Desktop Release Notes Template

Use this template for every Claude Code Desktop release candidate. Replace all
bracketed placeholders before publishing artifacts.

## Release Identity

- Version: `[DESKTOP_RELEASE_VERSION]`
- Commit: `[git commit SHA]`
- Build time: `[DESKTOP_RELEASE_BUILD_TIME or CI build timestamp]`
- Platform artifacts:
  - macOS arm64: `[artifact name and checksum]`
  - macOS x64: `[artifact name and checksum or not shipped]`
  - Windows: `[artifact name and checksum or not shipped]`
  - Linux: `[artifact name and checksum or not shipped]`

## Required Verification Evidence

Paste command output summaries and links to CI logs:

- `bun run desktop:release-ci`: `[pass/fail and log link]`
- `desktop/release/release-evidence.json`: `[artifact link, source repository/ref/run URL, command summary, SHA-256 checksums, artifact verification check summary]`
- `desktop/release/release-notes-evidence.md`: `[artifact link, generated summary, version/commit/checksum/toolchain/lockfile/screenshot evidence, UX validation summary]`
- `desktop/release/ux-validation-evidence.md`: `[artifact link, release version/commit match, completed checklist with validator, representative user, and observed representative user validation YYYY-MM-DD dates, screenshot rows pass/n/a, manual tasks pass including native Help menu support actions, no blocking issues, known limitations accepted by approver, and UX approval by approver/date]`
- `desktop/release/SHA256SUMS`: `[artifact link and checksum lines for published files]`
- `desktop/release/ux-screenshots/**/*.png`: `[artifact link and visual review summary]`
- `published-release-evidence.json`: `[GitHub Release asset link, schema/product/kind, release tag/name/database id/public URL, CI repository/ref/event/commit/run URL, verified fixed asset set, and SHA-256 summary]`
- draft GitHub Release asset verification: `[gh release view result showing draft=true and prerelease=false, one current-version DMG, one current-version mac ZIP, SHA256SUMS, release evidence, release notes evidence, UX validation evidence, UX screenshots archive, downloaded asset size/SHA-256 comparison result, and desktop:verify-published-release result]`
- `desktop/release/production-gate-evidence.json`: `[Actions artifact link, product/kind, generated timestamp, release version, CI repository/run id/run attempt/run URL, commit, overall pass/fail status, ordered gate step summary, and source metadata match against published-release-evidence.json]`
- `public-release-evidence.json`: `[Actions artifact link, product/kind, generated timestamp, final public release tag/name/database id/public URL, draft=false, prerelease=false, sorted asset names including production-gate-evidence.json, public asset sizes/URLs with unique canonical GitHub Release asset URLs bound to the same repository, numeric asset ids, and no query/hash data, CI repository/ref/event/commit/run id/run attempt/run URL, source metadata match against production-gate-evidence.json, release identity match against published-release-evidence.json, and public asset sizes matching published-release-evidence.json for previously verified assets]`
- Final public Release verification: `[publish-public-release log link showing retained published-release-evidence.json artifact download to public-release-input/published-evidence/published-release-evidence.json, production-gate-evidence.json verification with --published-evidence before upload, production-gate-evidence.json upload, gh release edit --draft=false --prerelease=false, final gh release view result showing draft=false and prerelease=false, required asset set including production-gate-evidence.json and published-release-evidence.json, final public asset download size/SHA-256 comparison, verify-public with --production-gate-evidence and --published-evidence, and uploaded public-release-evidence.json artifact]`
- Completed UX validation checklist: `[same content archived as desktop/release/ux-validation-evidence.md; no unresolved placeholders, validator/date, representative user/date, and observed representative user validation present, all manual tasks pass including native Help menu support actions: Help menu Command Palette, Help menu Refresh Settings, and Help menu Export Diagnostics, blocking issues none, known limitations accepted by approver, UX approval by approver/date]`
- `bun run check`: `[pass/fail and log link]`
- `bun run desktop:check`: `[pass/fail and log link]`
- `bun run desktop:test`: `[pass/fail and log link]`
- `DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-electron`: `[pass/fail and log link]`
- `DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-packaged`: `[pass/fail and log link]`
- `bun run desktop:release-preflight`: `[pass/fail and log link]`
- `bun run desktop:prod-check`: `[pass/fail and log link]`
- `bun run desktop:verify-release`: `[pass/fail and log link]`
- `bun run desktop:write-published-release-evidence`: `[pass/fail and generated evidence path]`
- `bun run desktop:verify-published-release`: `[pass/fail and downloaded evidence comparison summary]`
- `bun run desktop:write-public-release-evidence`: `[pass/fail and generated public-release-evidence.json path]`
- `bun run desktop:verify-public-release`: `[pass/fail and final public release evidence validation summary]`
- `bun run desktop:production-gate`: `[pass/fail and final gate log link]`
- `bun run desktop:verify-production-gate-evidence`: `[pass/fail and retained production-gate-evidence.json validation summary]`
- Signed artifact verification: `[codesign/spctl/stapler evidence for .app and .dmg; zip presence, ditto ZIP integrity check, unzip app-bundle check, and hdiutil DMG integrity check]`
- Electron bundle verification: `[app.asar present; inspected with explicit @electron/asar via npx --no-install; contains desktop/dist/main/main.js, desktop/dist/preload/preload.cjs, and desktop/dist/renderer/index.html; package.json main and version verified]`
- Embedded runtime verification: `[dist/claude-local and node-pty native resources present in packaged .app; dist/claude-local and spawn-helper executable permissions verified]`
- App metadata verification: `[CFBundleIdentifier, CFBundleShortVersionString, and CFBundleVersion evidence]`
- Signing environment: `[CSC_LINK + CSC_KEY_PASSWORD configured, or CSC_NAME keychain identity verified]`

## User-Visible Changes

- `[change 1]`
- `[change 2]`
- `[change 3]`

## Known Limitations

- Local sessions are supported; remote/cowork/mobile dispatch remains outside
  the production release scope unless separately approved.
- Team add/remove member mutation must not be advertised unless backed by real
  runtime operations in the release commit.
- Manual update distribution is expected while `desktop/release-policy.json`
  declares `updatePolicy=manual`.
- `[release-specific limitation]`

## Diagnostics And Support

- Users can export a local diagnostic bundle from Settings -> General ->
  Export diagnostics.
- Diagnostic bundles include app/runtime versions, session status summaries,
  renderer/runtime operational events, and redacted error summaries.
- Diagnostic bundles must not be requested publicly if they may contain private
  project paths or organization names; use the approved support channel.
- Support intake channel: `[support channel or issue tracker]`
- Escalation owner: `[team/person]`

## Rollback Procedure

1. Stop publishing the affected artifact or remove it from the release channel.
2. Publish the previous known-good signed artifact and checksum.
3. Update release notes with the rollback reason and affected versions.
4. Tell users to quit Claude Code Desktop and install the previous artifact.
5. Preserve diagnostic bundles and CI logs for postmortem review.
6. File follow-up issues for any production gate that failed to catch the
   regression.

## Release Approval

- Engineering owner: `[name, date]`
- Product owner: `[name, date]`
- UX validation reviewer: `[name, YYYY-MM-DD]`
- Security/release reviewer: `[name, date]`
