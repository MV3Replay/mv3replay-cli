# Changelog

MV3 Replay CLI is local-only pre-release software. Its source repository is
public, but no package has been published to a registry and no release has
been tagged or created.

## 0.1.0-rc1

Release candidate prepared from accepted work for review. The source is
public for testing, but no package, tag, or GitHub Release exists.

### Implemented in 0.1.0-rc1

- Static, manifest-only analysis through `mv3replay inspect` and
  `mv3replay compare`, with deterministic human-readable output and
  `--json` reports (`schemaVersion: 1`) carrying stable fingerprints.
- Machine-verifiable JSON Schema contracts in `schemas/` for both report
  types.
- Documented exit codes: success, internal error, usage error, missing
  input, invalid JSON, oversize manifest, non-MV3 input, and configured
  finding-threshold failure.
- Local-only privacy boundary: only the manifest selected by the user is
  read; no upload, telemetry, analytics, or network access of any kind.
- An unpublished local interface in `app/` (`npm run start:app`) for
  `inspect` and `compare` on a loopback server, with in-memory regression
  checklists and JSON and Markdown export of reports and checklists to
  local files. It also includes clearly labeled built-in examples, severity
  filters, manual-test readiness gates, unpacked-directory selection, and a
  private tester-notes template. It is not published and is covered by the
  normal `npm test` gate together with its privacy boundary and a
  dependency-free client runtime harness.
- Public-safety gate that scans every public working-tree file, including
  untracked release-candidate files, for secrets, email addresses,
  personal Windows paths, and parent-directory traversal; repository
  metadata and generated artifacts are excluded deterministically.
- Hermetic installation verification: locally packed tarballs install into
  temporary directories using private npm caches that never touch a user
  profile.
- Zero runtime dependencies, Node.js 20 or newer, CI matrix across Ubuntu
  and Windows on Node.js 20, 22, and 24.
- Regression lanes for omnibox input, sandboxed pages, native messaging, and
  dynamically registered user scripts, including required-access risk flags.
- Specialized permission lanes for debugger sessions, extension management,
  identity flows, downloads, and clipboard boundaries, with stronger flags
  only when sensitive access is required rather than optional.
- Precise comparison of minimum browser versions, extension and sandbox CSP
  declarations, and OAuth scope expansion, with dedicated update findings.
- Explicit analysis and comparison warnings for unmodeled top-level manifest
  keys, including deterministic added, removed, and value-changed key details.
- Manifest presentation and localization checks for descriptions, short names,
  display versions, homepages, icons, and default locales, including documented
  length-limit warnings and precise comparison findings.
- Extension display-name changes now count as structured declaration changes and
  produce the existing presentation-change finding.
- ChromeOS file-handler surfaces, declaration comparisons, ChromeOS 120
  compatibility warnings, and privacy-preserving manual regression checks.
- Critical validation for empty or malformed file-handler declarations,
  including required action, name, MIME mappings, extensions, and launch type.
- Manifest-icon validation for size/path mappings, unsupported SVG/WebP files,
  and missing recommended 48px/128px presentation sizes without reading assets.
- Toolbar-action icon validation for string and size-map declarations, plus a
  critical check for extension names beyond the documented 75-character limit.
- MIME document-handler surfaces, strict public-PDF declaration validation,
  version 151 compatibility, critical comparisons, and native-viewer fallback.
- Strict web-accessible-resource rule validation plus critical invalid-path
  findings and a high-risk warning for exposing the entire extension package.
- External-connectability validation for caller IDs, web matches, wildcard
  callers, TLS channel-ID privacy, and the undeclared-versus-empty update trap.
- Static content-script validation for required matches and files, optional
  fields, injection timing, execution worlds, and origin-fallback paths.
- Keyboard-command validation for required descriptions, platform-specific
  shortcut syntax, MV3 action names, and the four-suggestion limit.
- Static declarative-network-ruleset validation for unique IDs, boolean state,
  and safe relative paths without reading referenced rule files.
- Manifest V3 background service-worker validation for safe relative paths,
  optional module type, and rejected Manifest V2 fields.
- Popup, options-page, and side-panel entry-point validation for safe relative
  paths and correctly typed declarations without reading referenced HTML.
- Named and host-permission field validation for malformed arrays, misplaced
  host patterns, and invalid required or optional match scopes.
- Built-in page override, sandbox page, DevTools page, and omnibox declaration validation.
- Locale and message-placeholder validation without reading locale catalogs.
- Privacy-safe OAuth2 structure validation without reporting client identifiers.
- Strict cross-origin isolation policy and managed-storage path validation without
  reading referenced schema files or exposing declaration values.
- Hardware-requirement and text-to-speech engine validation with fixed,
  privacy-safe findings and permission checks.
- Shared-module export/import validation with identifier non-disclosure and
  distribution compatibility warnings.
- ChromeOS file-browser handler, file-system provider, and input-component
  validation with permission gates and fixed-value test lanes.
- Installation metadata validation for homepage/update URLs and incognito mode.
- Strict typing for descriptions, short/version names, and minimum browser versions.
- Content-security-policy structure and isolation validation for extension and sandbox pages.
- Browser settings override validation for homepage, startup, and search-provider declarations.
- Safe relative-path enforcement for manifest icons, action icons, and MIME handler pages.
- Web-accessible-resource and external-connectability validation for paths,
  origins, identifiers, uniqueness, and supported fields.
- File/MIME handler, action, and options object hardening for duplicates,
  unknown fields, and conflicting options declarations.
- An accessible comparison change-category filter for isolating access, scripts,
  commands, network rules, external boundaries, surfaces, declarations, or
  coverage gaps without changing reports or exports.
- Extension-origin COEP/COOP and enterprise managed-storage schema surfaces,
  declarations, findings, and privacy-preserving manual regression lanes.
- Packaged extension identity-key continuity checks, with a critical update
  finding and boolean-only reports that never reproduce the key value.
- Critical inspect-time validation for missing extension names and invalid
  package versions before a clean-install or update plan is trusted.
- A changed-sections-only option that combines with every comparison category,
  including an explicit zero-section state for identical manifests.
- Explicitly user-triggered share-safe analysis and comparison summaries that
  retain structural counts while excluding all tested manifest-controlled text.
- Optional `--fail-on critical|high|medium|low` CI gating for both commands;
  complete human or JSON reports are written before exit code 7 is applied.

### Future ideas (not implemented)

- Browser automation: this release contains none. The tool never launches,
  connects to, or controls a browser, never executes extension code, and
  observes no runtime behavior. Any such capability remains a future idea,
  not a shipped feature.
- Reading extension source files beyond `manifest.json`.
- Predicting Chrome Web Store review outcomes or proving update safety.
- Registry publication, GitHub releases, or a formal support channel.
