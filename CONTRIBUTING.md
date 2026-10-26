# Contributing to Lightyard

Thanks for helping improve Lightyard. Small, focused changes are easiest to review.

## Report a bug or suggest an improvement

Open a GitHub issue describing what happened, what you expected, and how to reproduce it. For gameplay problems, include:

- Your browser and operating system, plus the game build if known.
- A puzzle export and the relevant solution export, when possible.
- The tick or interaction where the behavior becomes incorrect.
- A screenshot or short recording if the problem is visual.

For a feature suggestion, explain the situation it would improve and give an example. Discuss changes to the game rules, save format, or project structure before starting substantial work.

## Set up a development copy

1. Fork the repository and clone your fork.
2. Create a branch for your change.
3. Open the root `lightyard.html` file in a browser, or run `python3 -m http.server 8000` from the repository root and visit <http://localhost:8000/lightyard.html>.
4. For server work, install Node.js 22.16 or newer and run `npm ci` inside `server/`.

In a development copy, set `ONLINE_API_BASE` to `''` for local-only work, or use your own Worker URL for online development. Remove or update any `lightyard_onlineApi` browser-storage override. Use a separate local D1 database or your own Cloudflare account for integration work.

## Make the change

- Keep a pull request focused on one problem or feature.
- Follow the surrounding JavaScript, CSS, and HTML style.
- Preserve the single-file browser app unless a different structure has been agreed upon.
- Keep fixed puzzle elements separate from solver-placed elements.
- Keep display and animation changes separate from simulation outcomes.
- Preserve existing puzzle IDs, share links, and saved data when changing storage or imports. Add a migration when a compatible read is insufficient.
- Keep configurable URLs and deployment credentials out of game logic.

The current HTML file is the source of truth for the browser app. Archived `server/client/online.js`, `online.css`, and the client build script may predate changes in the current HTML. Reconcile those sources before using the script to regenerate the app; replacing its marked sections can overwrite newer behavior.

## Verify your work

Match verification to the change. For a visual adjustment, inspect the affected screen. For a bug in behavior, exercise the reported case and nearby cases; add a regression test when it protects meaningful behavior.

For browser changes, check the relevant parts of this list:

- Play and Design modes, plus Online when affected.
- Desktop and narrow phone layouts; use keyboard and touch where relevant.
- Editing, undo/redo, save/reload, and returning from a board to its list.
- Import/export and **Save as Web App** when document structure or persistence changes.
- Current Safari and a Chromium-based browser when possible. State which browsers you actually checked.

### Server tests

From the repository root:

```sh
cd server
npm ci
npm test
```

The additional online and undo/redo suites accept a browser HTML path. From `server/`, run:

```sh
node test/online-79.mjs ../lightyard.html
node test/undo-redo.mjs ../lightyard.html
```

Historical filenames do not necessarily identify the current game rules. In the bundled server tooling, the replay and reliability suites load `client/lightyard-79.html` by default or directly. Passing those suites alone does not establish coverage of the current root `lightyard.html`. Keep the historical inputs while the tests depend on them, and update the test harness when its target changes.

The older `test/api.mjs` and `test/client.mjs` suites require a private fixture and a published puzzle catalog. They are not self-contained public checks as supplied. Replace private dependencies with redistributable fixtures before making those suites required for contributors.

### Simulation changes

`server/src/core.js` is generated from browser rule functions by `server/scripts/extract-core.mjs`; do not independently edit the generated rules.

When changing simulation behavior:

1. Update the authoritative browser implementation.
2. Select the matching rules input and update the extraction command as needed.
3. Regenerate the server core and compare browser and server outcomes with public puzzle/solution fixtures.
4. Check both successful and failing runs, including timing and packet counts.
5. Explain any change to rules identity, verification results, or existing saved solutions in the pull request.

The current `RULES_VERSION` identifies the extracted physics, not the latest interface build. Avoid changing it solely for a cosmetic update.

## Submit a pull request

Explain the problem, the resulting behavior, and how you verified it. Include before/after screenshots for visual changes and a small exported example for simulation or import problems. Mention checks you could not run and any effect on existing data.

Commit dependency lockfile changes when dependencies change. Include reusable public fixtures where needed. Keep personal backups, player data, database dumps, credentials, installed dependencies, and local build caches out of the pull request. The root `.gitignore` covers common local files; review the actual staged files as well.

Contributions are reviewed before merging. A merged change is published to the live game at the maintainer's discretion.

## License

By submitting a contribution, you agree that your contribution may be distributed under the repository's MIT License. Only submit material you have permission to contribute, and retain applicable third-party notices.
