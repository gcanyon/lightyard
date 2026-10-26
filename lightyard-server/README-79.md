# Lightyard 79: Online Puzzles

This is an update for the existing Lightyard 77 server, with the Lightyard 78 undo/redo work retained. Merge this folder into your existing `lightyard-server` folder; it is not a standalone server installation.

The update contains only changed application source and tests. Your `wrangler.toml`, secrets, installed dependencies, `package.json`, `package-lock.json`, audit overrides, migrations, and local backups are not included and remain in your existing folder.

## Deploy

1. Unzip `lightyard-server-79-update.zip`. Merge the contents of its `lightyard-server-79-update` folder into your existing server folder. Copy the contents, not the outer directory itself. In Terminal, from your existing server directory, if the download was extracted in Downloads:

   ```sh
   rsync -av ~/Downloads/lightyard-server-79-update/ ./
   ```

2. Deploy the Worker before publishing the new HTML:

   ```sh
   npx wrangler deploy
   ```

There are no new database migrations, dependencies, bindings, or paid services. Do not rerun the 77 upgrade script for this update. The existing built-in puzzle definitions are used as they are; this update does not upload benchmark layouts or local solutions.

3. Open `client/lightyard-79.html` in your normal editing browser and check your puzzles and solutions. Use **Save as Web App**, keeping **Include unsolved puzzles** checked, to produce your public catalog. Publish that export at your existing website URL to keep browser progress attached to the same origin.

## What changed

- Online Puzzles appears alongside Solve Puzzles and Create Puzzles, with a full-page muted steel-blue background.
- Search across online puzzle names, set names, and creators. Filter All / Built-in / Community and sort by newest, name, solution count, unsolved first, or recently solved. Search and sorting apply on the server before pagination.
- Catalog and detail previews show fixed puzzle pieces only. The detail page shows verified solution count and fewest-element / fewest-tick records; no layout data is fetched until Show Solutions is selected.
- Try It reuses a matching built-in or local puzzle, or imports a new community puzzle, and opens a fresh blank attempt. It never overwrites a local solution.
- Show Solutions reveals layouts, player search, sorting, and combined record cards. An Open button imports an editable in-progress attempt with attribution. A successful local replay marks it solved and locks it, following the normal game rule.
- Repeated opens reuse an unchanged in-progress import. Edited or solved local copies are preserved; opening the source again creates a separate editable attempt when needed.
- The board's Online Puzzles button returns to the detail page. Returning to the list restores search, filters, sorting, and scrolling while the page stays open.
- Puzzle share links open spoiler-safe details. Solution share links explicitly open the referenced editable attempt.
- Attribution is retained in local storage and solution backups. Public app exports contain puzzle definitions and numeric goals, not saved benchmark layouts.
- Query parameters are bound, literal SQL wildcard characters are escaped, searches are limited to 80 characters, and existing request and pagination limits remain in force. Verified record queries use the existing indexes.

## Validation

Requires Node 22.16 or newer for the SQLite test adapter. The following commands use a temporary current Node 22 without changing your installed Node:

```sh
npx --yes --package=node@22 node test/replay.mjs
npx --yes --package=node@22 node test/reliability.mjs
npx --yes --package=node@22 node test/online-79.mjs
npx --yes --package=node@22 node test/undo-redo.mjs
```

Validation performed for the release: 27 existing reliability checks, 15 online browser/API checks, 15 undo/redo checks, and 303 recorded layouts replayed through the current browser game and server checker (299 matched, four invalid uploads rejected, 180/180 recorded solves reproduced). UI behavior was exercised in a simulated DOM, not a visual browser session.

`client/build-client.mjs` refreshes the online code and CSS in a 79 base or exported 79 app, preserving its navigation, history integration, and embedded catalog. Earlier bases are rejected with a clear error to avoid producing an incompatible page. The older native `test:client` script predates the full-page online UI; use the tests above for this release.
