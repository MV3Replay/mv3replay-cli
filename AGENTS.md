# MV3 Replay CLI agent boundary

Sensitivity: **PUBLIC**.

Work only inside this repository. Never request, search, read, summarize, or
write any path outside the repository. Never inspect user profiles, account
settings, credentials, browser data, environment variables, home directories,
private repositories, or git configuration.

The repository may be sent to a third-party model. Therefore:

- do not add secrets, personal data, usernames, email addresses, absolute local
  paths, telemetry, network calls, payment code, advertising code, or browser
  profile access;
- do not add dependencies unless the active task explicitly allows them;
- keep the CLI deterministic, local-only, and honest about what it verifies;
- do not commit, push, publish packages, create releases, or change remotes;
- do not use a model other than `stealth/ox-alpha`;
- stop after three failed implementation attempts and write a concise blocker;
- run only the test commands named in the active task contract.

Each task is limited to the files, acceptance criteria, tests, and stop
conditions in its task contract. A passing test suite is necessary but never
authorizes a merge.
