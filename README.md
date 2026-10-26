# Lightyard

A puzzle game about guiding packets of colored light. Place mirrors, half-mirrors, and prisms so every receiver gets the colors it expects, in order.

**[Play Lightyard](https://www.geoffcanyon.com/lightyard.html)** · **[Contribute](CONTRIBUTING.md)**

Created by Geoff Canyon.

## The game

- Route and combine seven colors of light.
- Work around fixed emitters, receivers, crystals, and transformers.
- Program changing orientations and use colored mirrors when a puzzle allows them.
- Play, design, organize, and share puzzles and solutions.
- Inspect a run with playback, pause, step, reset, and speed controls.
- Browse community puzzles and shared solutions through the optional online service.

The in-game **?** button explains the rules, elements, and puzzle settings.

## Run locally

The game is a single HTML file containing its interface, styles, and simulation. It needs no compilation or npm installation to play or edit puzzles.

Save the current game build as `lightyard.html` at the repository root. Open it in a modern browser, or serve the repository locally for a consistent browser-storage origin:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/lightyard.html>.

Puzzles, solutions, and preferences are saved in browser storage. Localhost, downloaded files, and the public website have separate storage contexts. Use Lightyard's import/export controls to transfer your work. Google Fonts supplies the interface fonts when available; system fonts provide a fallback.

The development HTML may contain only a starter puzzle. The public website's puzzle collection is embedded in a separately exported web app. Import public puzzle sets if they are included in `puzzles/`.

## Repository layout

This documentation uses the following layout:

| Path | Contents |
| --- | --- |
| `lightyard.html` | Current editable game source |
| `server/` | Cloudflare Worker, D1 migrations, scripts, and tests |
| `puzzles/` | Optional public puzzle-set exports |
| `README.md` | Project overview and setup |
| `CONTRIBUTING.md` | Contribution and verification guidance |
| `LICENSE` | MIT license |

## Optional online service

Local play and design work without the online service. Shared puzzles, uploads, and records use a Cloudflare Worker backed by D1. The Worker replays submitted layouts to determine their results.

For a fork or a local development copy, set `ONLINE_API_BASE` in `lightyard.html` to `''` to hide online features, or set it to your own Worker URL. If you previously set the `lightyard_onlineApi` browser-storage override, remove or update it too. Set `ONLINE_SITE_URL` to your own published game URL when hosting a fork.

For server development, use Node.js 22.16 or newer. From the repository root:

```sh
cd server
npm ci
npm test
```

See the server's included README files for its schema, verification limits, and deployment procedures. Configure your own Cloudflare database binding and secrets before deploying a fork.

Some bundled server scripts and tests still reference historical client builds, including `client/lightyard-79.html`. The extracted rules currently come from `rules/lightyard-75.html`. Those paths are relative to `server/`; see [CONTRIBUTING.md](CONTRIBUTING.md) before changing them or interpreting their test coverage.

## Publishing

Use **Save as Web App** to generate a playable HTML file with embedded puzzle definitions and numeric goals. Saved solution layouts are excluded. Publishing that export to the existing website is a separate step from committing source changes here.

## Contributing

Bug reports, puzzle ideas, and pull requests are welcome. Include reproduction steps or an exported puzzle when reporting a gameplay problem. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Lightyard's project code is available under the [MIT License](LICENSE). Third-party dependencies and externally supplied fonts retain their own licenses.
