# MV3 Replay CLI

MV3 Replay CLI is a local-only Manifest V3 analyzer. It reads a
`manifest.json`, identifies extension surfaces that need regression coverage,
and compares two releases for access or entry-point changes.

The 0.1.0-rc1 release candidate does **not** upload source code, connect to
a browser, install an extension, collect analytics, or claim that an
extension passed its tests. There is no browser automation in this release.

## Install

There is no registry package and there are no published releases. To get the
documented `mv3replay` command, pack a tarball from a checkout of this
repository and install that local file into any project or globally:

```sh
npm pack
npm install --offline --no-audit --no-fund ./mv3replay-cli-0.1.0-rc1.tgz
mv3replay --help
```

Use the tarball filename that `npm pack` prints; add `--global` to place
`mv3replay` on your `PATH`. The package has zero runtime dependencies, so
this install works fully offline. Installing anything else under this name
is not this project.

## Usage

The tool reads one manifest (or a directory containing `manifest.json`) per
operand:

```sh
mv3replay inspect ./my-extension
mv3replay inspect ./my-extension --json > inspect-report.json
mv3replay compare ./previous-release ./candidate-release
mv3replay compare ./previous-release ./candidate-release --json > compare-report.json
mv3replay compare ./previous-release ./candidate-release --json --fail-on high > compare-report.json
```

`inspect` lists detected extension surfaces and a suggested regression plan.
`compare` reports access, update-policy, content-script, network-rule, and
entry-point changes between two versions.
Without `--json`, output is human-readable text; diagnostics always go to
stderr, and exit codes are listed below. From a repository checkout the same
commands run without installation as `node src/cli.mjs inspect ...`.

`--fail-on critical|high|medium|low` is an optional CI gate for both commands.
The selected level includes every more severe level. MV3 Replay always writes
the complete human or JSON report first, then exits with code 7 when the
threshold is met; without this option, findings do not change the exit code.
This is a configurable review gate, not proof that a release is safe.

## Local interface (not published)

A validated local MV3 Replay interface lives in `app/` for `inspect` and
`compare` workflows in a browser tab. It is included in local package builds
but is not published and has no dependency, installer, or auto-opening browser
command. From a repository checkout, start it with:

```sh
npm run start:app
```

This runs `node app/server.mjs`, which binds only to `127.0.0.1` on a
random free port and prints the exact loopback address to open manually in a
browser. For each release, choose either its `manifest.json` file or its
unpacked extension directory. When a directory is selected, relative paths
are checked only to locate the root manifest; only that manifest's contents
are read. The parsed JSON is sent to the loopback server, never to an external
destination.

The interface also provides:

- built-in analysis and comparison examples that are always labeled as sample
  data;
- summaries, severity filters, comparison category and changed-only filters,
  and explicit manual-validation gates;
- an exact structured comparison total with a category-by-category breakdown,
  shown consistently in the interface and Markdown export;
- in-memory regression checklists, including comparison-specific findings,
  that update readiness for manual browser testing without claiming runtime
  success;
- detailed local views of content-script registrations, static DNR rulesets,
  external messaging, and web-accessible resource changes;
- dedicated checks for built-in browser page replacements and homepage,
  startup-page, or search-provider overrides;
- toolbar-action coverage for both popup and direct click-event flows, including
  declared icon and accessible-title changes;
- lifecycle checks for context-menu registration and alarm-driven service-worker
  work, including restart and duplicate-work boundaries;
- explicit coverage-gap reporting for top-level manifest keys the analyzer does
  not yet interpret, including added, removed, and value-changed keys in comparisons;
- presentation-metadata coverage for descriptions, short and display versions,
  extension names, homepages, manifest icons, and default-locale changes without
  reading asset files;
- manifest-icon declaration checks for valid size/path mappings, unsupported
  SVG or WebP formats, and recommended 48px/128px presentation coverage;
- toolbar-action icon validation for both single-path and size-mapping forms,
  plus enforcement of the public extension name's 75-character maximum;
- MIME document-handler validation and critical update coverage for public PDF
  handling, embedded documents, version 151 compatibility, and native fallback;
- strict web-accessible-resource rule validation for resource lists, target
  origins or extension IDs, dynamic URLs, origin-only match paths, and package-wide exposure;
- external-messaging caller validation, including wildcard extension access,
  invalid all-URL web access, TLS channel-ID privacy, and implicit-policy changes;
- static content-script validation for required matches and files, optional
  field types, injection timing, execution world, and origin-fallback paths;
- keyboard-command validation for descriptions, platform-specific shortcuts,
  case-sensitive keys, MV3 action names, and the four-suggestion limit;
- static declarative-network-ruleset validation for unique IDs, enabled flags,
  and safe relative JSON paths without reading referenced rule files;
- MV3 background service-worker validation for one safe relative worker path,
  optional module type, and rejection of legacy scripts or persistence fields;
- extension-origin COEP/COOP and enterprise managed-storage schema coverage,
  including update findings without reading referenced policy schema files;
- privacy-safe extension identity-key continuity checks that report only
  declaration and change booleans, never the manifest key value;
- ChromeOS file-handler coverage for matching types, action pages, launch
  behavior, declaration validation, minimum-version compatibility, updates,
  and zero-retention checks;
- inspect-time critical checks for a missing extension name or an invalid,
  zero, overlong, or otherwise non-installable package version;
- user-triggered JSON and escaped Markdown report downloads, including the
  detected-surface and manifest-count inventory; and
- user-triggered share-safe Markdown summaries containing structural counts
  and fixed categories while excluding names, versions, URLs, filenames,
  manifest values, finding messages, and checklist text; and
- a private 10-minute tester guide with a local feedback-notes template that
  asks users not to include identifying or sensitive information.

There is no external network call or browser automation. Stop the interface
with `Ctrl+C` in the terminal that ran the command; no shutdown button or
endpoint exists.

Privacy limitations: the local page holds only the selected manifest data in
memory for that browser tab; it does not persist reports, read other files, or
send data anywhere outside `127.0.0.1`. Anyone with local access
to the same machine and port while the server runs could also reach it, so
treat the loopback session as no more private than any other local process.
Share-safe summaries remove manifest-controlled text but still reveal aggregate
structural counts; review the downloaded file before choosing to share it.
The local interface and its privacy boundary are covered by the normal
`npm test` gate via `tests/local-app.test.mjs` and the dependency-free client
runtime harness in `tests/local-app-client-runtime.test.mjs` (both runnable as
`npm run test:app`). These automated checks execute the built-in example,
filter, readiness, and local-download interactions without controlling a real
browser; manual browser testing remains separate and is never implied.

## Development

Requires Node.js 20 or newer.

```sh
npm test
npm run check:public
node src/cli.mjs inspect ./my-extension --json
node src/cli.mjs compare ./previous-release ./candidate-release --json
```

`npm test` runs the analyzer, CLI, public-safety, and local-interface suites from the
repository root on Windows and POSIX shells. Representative manifests live in
`fixtures/` and cover minimal MV3, popup, options, service worker, content
scripts, optional and required permissions, host permissions, declarative
net request rulesets, side panel, risky external messaging, malformed JSON,
omnibox input, sandboxed pages, native messaging, user scripts, and non-MV3
input. Specialized lanes also cover debugger sessions, extension management,
identity flows, downloads, and clipboard boundaries.
Synthetic browser-data fixtures also cover cookies, history, bookmarks,
browsing-data removal, navigation metadata, and web-request observation.
Reversible critical lanes cover per-site content settings, privacy controls,
and proxy configuration in disposable profiles with exact restoration checks.
Zero-retention lanes cover geolocation, desktop and page capture, while
active-tab and scripting lanes verify user gestures, host boundaries, target
frames, execution worlds, and access revocation after navigation.

The public-safety check rejects likely secrets, email addresses, personal
Windows paths, and parent-directory traversal. Unrelated private-project terms
are enforced by a separate private pre-push gate; they are intentionally not
encoded in this public repository because browser names such as Edge are
legitimate MV3 documentation.

## JSON contract

`inspect --json` and `compare --json` print exactly one JSON document with
`schemaVersion: 1` to stdout; diagnostics go to stderr. Machine-verifiable
JSON Schema files live in `schemas/`:

- `schemas/inspect-v1.schema.json` (`urn:mv3replay:schemas:inspect-v1`)
- `schemas/compare-v1.schema.json` (`urn:mv3replay:schemas:compare-v1`)

Report ordering and the 16-hex-character `fingerprint` are deterministic:
they do not depend on key order in the input manifest or on the local
environment. Default (human-readable) output never contains absolute local
paths or environment data.
JSON remains complete and valid when `--fail-on` returns code 7.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success. |
| 1 | Unexpected internal error. |
| 2 | Invocation error (missing or unknown command or arguments). |
| 3 | Input file or directory not found or unreadable. |
| 4 | Input is not valid JSON, not a JSON object, or nests deeper than 128 levels. |
| 5 | Input exceeds the 1 MiB manifest safety limit. |
| 6 | `manifest_version` other than 3. |
| 7 | The configured `--fail-on` finding threshold was met after writing the report. |

## Continuous integration

`.github/workflows/ci.yml` runs `npm run check:public`, `npm test`, and
`npm pack --dry-run` on Node.js 20, 22, and 24 across Ubuntu and Windows
runners. The workflow requests only `contents: read`, uses no secrets, and
never deploys, publishes, or releases.

## Privacy boundary

Only the manifest file selected by the user is read. No extension source file,
browser profile, authenticated session, or account data is accessed. Generated
reports remain local unless the user chooses to share them.

## Limitations

- No browser automation: analysis is static and manifest-only. The tool
  never launches, connects to, or controls a browser, never executes
  extension code, fetches remote resources, or observes runtime behavior.
- Coverage is limited to the MV3 surfaces the analyzer recognizes. Top-level
  keys it does not interpret are listed explicitly as coverage gaps and require
  manual review; their nested behavior is not analyzed.
- A report is a regression-testing plan, not evidence that an extension
  passed any test. A comparison does not predict Chrome Web Store review
  outcomes and does not prove that an update is safe.
- Manifests larger than 1 MiB are rejected, and non-MV3 manifests exit with
  code 6.
- Reports describe the manifests as given; they cannot detect files,
  code paths, or permissions that exist outside `manifest.json`.

## Support status

This is the `0.1.0-rc1` pre-release release candidate: no published package,
no GitHub releases, and no formal support channel or response-time
commitment. Command names, output shape, schemas, and fingerprints may still
change after this candidate. The software is provided as-is under the
Apache-2.0 terms.

## License

Apache-2.0. The complete text ships in [`LICENSE`](LICENSE).

