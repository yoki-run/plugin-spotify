# Spotify for Yoki

Control Spotify from [Yoki](https://yoki.run) — Now Playing, search, playback, devices, playlists.

![sdk: v2](https://img.shields.io/badge/Yoki%20SDK-v2-blue) ![license: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

## Commands

| Command | Description |
|---------|-------------|
| `sp` | Now Playing — live card with cover art and playback controls |
| `sp play <song>` | Search and play a track |
| `sp pause` | Pause playback |
| `sp next` | Next track |
| `sp prev` | Previous track |
| `sp vol <0-100>` | Set volume |
| `sp shuffle` | Toggle shuffle |
| `sp like` | Like / unlike current track |
| `sp search <query>` | Search tracks |
| `sp devices` | Switch playback device |
| `sp playlists` | Browse your playlists |
| `sp setup` | Authenticate with Spotify |

## Install

**From Yoki:** Plugins → Browse → **Spotify** → Install

**Manual:** Clone into your Yoki plugins folder:
```
git clone https://github.com/yoki-run/plugin-spotify.git ~/yoki/plugins/spotify
```

**Requires:** Yoki ≥ 1.0.4.0

## License

MIT
