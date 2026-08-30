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
```

`inspect` lists detected extension surfaces and a suggested regression plan.
`compare` reports access or entry-point changes between two versions.
Without `--json`, output is human-readable text; diagnostics always go to
stderr, and exit codes are listed below. From a repository checkout the same
commands run without installation as `node src/cli.mjs inspect ...`.

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
browser. To inspect a manifest, select its JSON file in the page and submit;
to compare two releases, select both manifest files and submit. The browser
reads only the selected files and sends their parsed JSON to the loopback
server. Every request stays local: there is no external network call or browser
automation. Stop the
interface with `Ctrl+C` in the terminal that ran the command; no shutdown
button or endpoint exists.

Privacy limitations: the local page holds only the selected manifest data in
memory for that browser tab; it does not persist reports, read other files, or
send data anywhere outside `127.0.0.1`. Anyone with local access
to the same machine and port while the server runs could also reach it, so
treat the loopback session as no more private than any other local process.

## Development

Requires Node.js 20 or newer.

```sh
npm test
npm run check:public
node src/cli.mjs inspect ./my-extension --json
node src/cli.mjs compare ./previous-release ./candidate-release --json
```

`npm test` runs the analyzer, CLI, and public-safety suites from the
repository root on Windows and POSIX shells. Representative manifests live in
`fixtures/` and cover minimal MV3, popup, options, service worker, content
scripts, optional and required permissions, host permissions, declarative
net request rulesets, side panel, risky external messaging, malformed JSON,
and non-MV3 input.

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
- Coverage is limited to the MV3 surfaces the analyzer recognizes;
  unrecognized keys are ignored, not interpreted.
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

