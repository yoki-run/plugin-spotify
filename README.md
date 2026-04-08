# Yoki Spotify Plugin

> The reference plugin for the [Yoki Plugin SDK v2](https://yoki.run/sdk).
> Control Spotify from your launcher — Now Playing, search, playback, devices, playlists, like.

![sdk: v2](https://img.shields.io/badge/Yoki%20SDK-v2-blue) ![python: stdlib only](https://img.shields.io/badge/python-stdlib%20only-green) ![license: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

```
sp                Now Playing card with cover, progress, controls
sp play despacito Search & play in one shot
sp pause          Pause
sp next           Next track
sp prev           Previous track
sp vol 50         Set volume 0-100
sp shuffle        Toggle shuffle
sp like           Toggle like for current track
sp s dua lipa     Search tracks (list mode)
sp d              Devices
sp pl             Playlists
```

## Install

1. Make sure you have **Yoki ≥ 1.0.4.5** ([download](https://yoki.run/download)) and **Python 3** in PATH.
2. Clone (or download zip) into your Yoki plugins folder:

   ```
   git clone https://github.com/xssmusashi/yoki-plugin-spotify.git ~/yoki/plugins/spotify
   ```

3. Restart Yoki. Open the launcher and type `sp setup` — your browser opens, you log in to Spotify, done.
4. Try `sp` to see what's playing.

That's the whole install. **No Spotify Developer account required, no Client ID to copy-paste** — Yoki's credentials service hands the plugin a working Client ID for any signed-in Yoki user.

## Features

- **Now Playing detail card** — cover art (140×140), Spotify-green progress bar, current device + volume, auto-refresh every 5 seconds
- **Native React click buttons** for Like / Prev / Play-Pause / Next / Shuffle / Vol — not just preview text
- **Search Spotify** with `sp s <query>` — list mode with track / artist / album / duration
- **Search & play in one shot** with `sp play <query>` — finds the first match and starts it on the active device
- **Device picker** — list all Spotify devices, see active + volume
- **Playlists** — browse your saved playlists, owner, track count
- **Like/Unlike toggle** — heart button on the now-playing card reflects current state
- **OAuth 2.0 with PKCE** — token storage in the plugin's sandboxed `data/` folder, automatic refresh, never leaves your machine
- **Permission-scoped** — Yoki shows you exactly what the plugin will access at install time

## How it works (architecture)

This plugin is the **reference implementation** for [Yoki Plugin SDK v2](https://yoki.run/sdk). It demonstrates:

| SDK feature | Where to look |
|---|---|
| `protocol: "v2"` manifest with `commands[]` | [`plugin.json`](./plugin.json) |
| `permissions` declaration (network whitelist + filesystem + notifications) | [`plugin.json`](./plugin.json) |
| `credentials` block (zero embedded secrets) | [`plugin.json`](./plugin.json) → [`lib.py: get_client_id`](./lib.py) |
| stdin/stdout JSON protocol | [`lib.py: read_input / write_response`](./lib.py) |
| `detail` mode with rich HTML markdown + auto-refresh | [`now_playing.py`](./now_playing.py) |
| `list` mode with per-item actions | [`search.py`](./search.py), [`devices.py`](./devices.py), [`playlists.py`](./playlists.py) |
| `background` mode (Enter-gated, side-effect) | [`playback.py`](./playback.py) |
| `error` mode with `details` and retry hints | [`lib.py: error()`](./lib.py) |
| Inline SVG icons in `V2Action.icon` (host-agnostic) | [`now_playing.py`](./now_playing.py) (look for `ICON_PLAY` etc) |
| OAuth 2.0 PKCE with stdlib only (no `requests`) | [`setup.py`](./setup.py), [`lib.py: refresh_access_token`](./lib.py) |
| `yoki_run` action type — buttons that trigger Yoki queries | [`now_playing.py: build_actions`](./now_playing.py) |
| `refresh_ms` auto-refresh from manifest | [`plugin.json`](./plugin.json) (`commands[0].refresh: 5000`) |

Total: **~600 lines of pure-stdlib Python**. No `pip install`, no third-party dependencies.

## File layout

```
yoki-plugin-spotify/
├── plugin.json      — manifest (commands, permissions, credentials)
├── lib.py           — shared OAuth + API helpers, response builders
├── setup.py         — OAuth wizard (PKCE flow, local callback server on :8888)
├── now_playing.py   — detail mode card with auto-refresh
├── search.py        — list mode track search
├── playback.py      — background mode controls (play/pause/next/prev/vol/shuffle/like)
├── devices.py       — list mode device picker
├── playlists.py     — list mode playlist browser
├── README.md
├── LICENSE
└── .gitignore
```

When installed under `~/yoki/plugins/spotify/`, Yoki creates a sandboxed `data/` subdirectory for OAuth tokens (gitignored).

## Permissions requested

| Permission | Why |
|---|---|
| `network`: `api.spotify.com`, `accounts.spotify.com` | API calls to Spotify only — no telemetry, no third parties |
| `filesystem`: read/write `data/` | Token storage, sandboxed by Yoki |
| `notifications` | Optional toast on track changes |

Yoki shows this list in the consent dialog at install time. Tokens never leave your machine.

## Requirements

- **Yoki ≥ 1.0.4.5** with the v3 credentials service ([download](https://yoki.run/download))
- **Python 3.8+** in PATH
- **Spotify Premium** is required for playback control endpoints (play / pause / next / vol / shuffle / play+query). This is a Spotify API restriction, not a plugin limitation. Free accounts can still use Now Playing, search, devices, and playlists in read-only mode.

## Troubleshooting

### `sp` shows "Sign in to Yoki to use this plugin"

Yoki couldn't fetch a Client ID from the credentials service. Either you're not signed in, or you're offline. Sign in via Yoki Settings and try again.

### Power user: I want to use my own Spotify dev app

If you'd rather hit your own Spotify app's quota (or you're contributing to the plugin and need to test isolation):

1. Register an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Set the redirect URI to **exactly** `http://127.0.0.1:8888/callback`.
3. In Yoki, run `sp setup <YOUR_CLIENT_ID>`. The override is saved to `~/yoki/plugins/spotify/data/config.json` and takes precedence over the credentials service.

### Authentication callback never returns

The redirect URI on your Spotify app must be exactly `http://127.0.0.1:8888/callback` (case-sensitive, no trailing slash, port 8888 — that's hardcoded in `setup.py`).

### Spotify API error 403 / "Restriction violated"

Playback control requires **Spotify Premium**. The plugin will surface a clear error message in this case.

### "No active device"

Open Spotify on your phone, computer, or speaker first, then run `sp d` to confirm Yoki sees it. You can transfer playback to a different device from there.

## Contributing

PRs welcome. The plugin is intentionally small (~600 lines) and uses only the Python standard library — please keep it that way. If you add a new command:

1. Update `plugin.json` with the new entry under `commands`
2. Add the dispatch logic to the relevant `*.py` (or create a new one)
3. Test with `sp <your-trigger>` in a fresh Yoki window
4. Update the trigger table in this README

For larger changes (new modes, new SDK features), open an issue first.

## License

[MIT](./LICENSE) — do whatever you want, no warranty.

## Links

- 🚀 [Yoki](https://yoki.run) — the launcher
- 📘 [Plugin SDK docs](https://yoki.run/sdk) — write your own plugin
- 🐛 [Yoki issues](https://github.com/xssmusashi/yoki/issues) — bug reports for the host
- 🐦 [@yokirun](https://yoki.run) — updates
