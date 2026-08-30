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
  input, invalid JSON, oversize manifest, and non-MV3 input.
- Local-only privacy boundary: only the manifest selected by the user is
  read; no upload, telemetry, analytics, or network access of any kind.
- An unpublished local interface in `app/` (`npm run start:app`) for
  `inspect` and `compare` on a loopback server, with in-memory regression
  checklists and JSON and Markdown export of reports and checklists to
  local files. It is not published and is covered by the normal `npm
  test` gate together with its privacy boundary.
- Public-safety gate that scans every public working-tree file, including
  untracked release-candidate files, for secrets, email addresses,
  personal Windows paths, and parent-directory traversal; repository
  metadata and generated artifacts are excluded deterministically.
- Hermetic installation verification: locally packed tarballs install into
  temporary directories using private npm caches that never touch a user
  profile.
- Zero runtime dependencies, Node.js 20 or newer, CI matrix across Ubuntu
  and Windows on Node.js 20, 22, and 24.

### Future ideas (not implemented)

- Browser automation: this release contains none. The tool never launches,
  connects to, or controls a browser, never executes extension code, and
  observes no runtime behavior. Any such capability remains a future idea,
  not a shipped feature.
- Reading extension source files beyond `manifest.json`.
- Predicting Chrome Web Store review outcomes or proving update safety.
- Registry publication, GitHub releases, or a formal support channel.
