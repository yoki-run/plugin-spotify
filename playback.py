"""
Spotify playback controls — background mode.
"""

import sys

from lib import (
    read_input,
    write_response,
    background,
    error,
    need_setup_response,
    is_authed,
    api,
    strip_keyword,
    fmt_artists,
)


def ensure_device_id(ctx):
    """
    Resolve an active Spotify device id, falling back to the first
    available one if no device is currently active.

    Spotify's /me/player/play endpoint returns 404 NO_ACTIVE_DEVICE
    when nothing is playing — even if the user has Spotify open. This
    helper sidesteps that by picking a device explicitly.
    """
    try:
        cur = api(ctx, "GET", "/me/player")
        if cur and (cur.get("device") or {}).get("id"):
            return cur["device"]["id"]
    except RuntimeError:
        pass
    try:
        data = api(ctx, "GET", "/me/player/devices") or {}
    except RuntimeError:
        return None
    items = data.get("devices") or []
    if not items:
        return None
    for d in items:
        if d.get("is_active"):
            return d.get("id")
    for d in items:
        if not d.get("is_restricted"):
            return d.get("id")
    return items[0].get("id")


def _no_device_error():
    return error(
        "No active Spotify device",
        details="Open Spotify on a phone, computer, or speaker first. `sp d` shows what Yoki sees.",
    )


def _is_no_device_error(e):
    s = str(e).lower()
    return "no active" in s or "no_active_device" in s or "404" in s


def detect_command(input_command, query):
    if input_command in {"play", "pause", "next", "prev", "vol", "shuffle", "like", "unlike"}:
        return input_command
    low = (query or "").strip().lower()
    for kw, name in [
        ("pause", "pause"), ("stop", "pause"),
        ("next", "next"), ("skip", "next"), ("n", "next"),
        ("prev", "prev"), ("previous", "prev"), ("back", "prev"), ("p", "prev"),
        ("vol", "vol"), ("volume", "vol"), ("v", "vol"),
        ("shuffle", "shuffle"), ("sh", "shuffle"),
        ("unlike", "unlike"), ("unfav", "unlike"),
        ("like", "like"), ("love", "like"), ("fav", "like"),
        ("play", "play"),
    ]:
        if low == kw or low.startswith(kw + " "):
            return name
    return "play"


def _is_spotify_uri(s):
    """Check if a string is a Spotify URI (spotify:track:xxx) or URL
    (https://open.spotify.com/...). These should be played directly via
    the context_uris / uris endpoint, not searched."""
    return s.startswith("spotify:") or s.startswith("https://open.spotify.com/")


def cmd_play(ctx, query):
    arg = strip_keyword(query, "play")

    device_id = ensure_device_id(ctx)
    if device_id is None:
        return _no_device_error()

    if not arg:
        try:
            api(ctx, "PUT", "/me/player/play", params={"device_id": device_id})
            return background("Resumed")
        except RuntimeError as e:
            if _is_no_device_error(e):
                return _no_device_error()
            return error("Play failed", details=str(e))

    # Direct Spotify URI/URL — play without searching. Supports all
    # resource types: track, album, playlist, artist, show, episode.
    # Track URIs go into "uris" (single-track queue), everything else
    # goes into "context_uris" (play the whole collection).
    if _is_spotify_uri(arg):
        is_track = ":track:" in arg or "/track/" in arg
        body = {"uris": [arg]} if is_track else {"context_uris": [arg]}
        try:
            api(ctx, "PUT", "/me/player/play", body=body, params={"device_id": device_id})
        except RuntimeError as e:
            if _is_no_device_error(e):
                return _no_device_error()
            return error("Play failed", details=str(e))
        return background(f"Playing {arg.split(':')[-1][:20]}...")

    # Text query — search for a track and play the first result.
    try:
        res = api(ctx, "GET", "/search", params={"q": arg, "type": "track", "limit": 1})
    except RuntimeError as e:
        return error("Search failed", details=str(e))
    items = ((res or {}).get("tracks") or {}).get("items") or []
    if not items:
        return background(f"No tracks found for: {arg}")
    track = items[0]
    uri = track["uri"]
    try:
        api(ctx, "PUT", "/me/player/play", body={"uris": [uri]}, params={"device_id": device_id})
    except RuntimeError as e:
        if _is_no_device_error(e):
            return _no_device_error()
        return error("Play failed", details=str(e))
    return background(
        f"{track['name']} - {fmt_artists(track.get('artists'))}",
        notif={
            "title": "Now playing",
            "body": f"{track['name']} - {fmt_artists(track.get('artists'))}",
        },
    )


def cmd_pause(ctx):
    device_id = ensure_device_id(ctx)
    if device_id is None:
        return _no_device_error()
    try:
        api(ctx, "PUT", "/me/player/pause", params={"device_id": device_id})
    except RuntimeError as e:
        if _is_no_device_error(e):
            return _no_device_error()
        return error("Pause failed", details=str(e))
    return background("Paused")


def cmd_next(ctx):
    device_id = ensure_device_id(ctx)
    if device_id is None:
        return _no_device_error()
    try:
        api(ctx, "POST", "/me/player/next", params={"device_id": device_id})
    except RuntimeError as e:
        if _is_no_device_error(e):
            return _no_device_error()
        return error("Next failed", details=str(e))
    return background("Next track")


def cmd_prev(ctx):
    device_id = ensure_device_id(ctx)
    if device_id is None:
        return _no_device_error()
    try:
        api(ctx, "POST", "/me/player/previous", params={"device_id": device_id})
    except RuntimeError as e:
        if _is_no_device_error(e):
            return _no_device_error()
        return error("Prev failed", details=str(e))
    return background("Previous track")


def cmd_vol(ctx, query):
    arg = strip_keyword(query, "vol", "volume", "v")
    try:
        level = int(arg)
    except (TypeError, ValueError):
        return error("Volume must be 0-100", details=f"Got: {arg!r}")
    level = max(0, min(100, level))
    device_id = ensure_device_id(ctx)
    if device_id is None:
        return _no_device_error()
    try:
        api(ctx, "PUT", "/me/player/volume", params={"volume_percent": level, "device_id": device_id})
    except RuntimeError as e:
        if _is_no_device_error(e):
            return _no_device_error()
        return error("Volume failed", details=str(e))
    bars = "#" * (level // 5) + "-" * (20 - level // 5)
    return background(f"vol {bars} {level}%")


def _current_track_id(ctx):
    """Return the currently-playing track id, or None."""
    cur = api(ctx, "GET", "/me/player/currently-playing")
    if not cur:
        return None
    item = cur.get("item") or {}
    return item.get("id")


def cmd_like(ctx, force_state=None):
    """Toggle like for the current track. force_state=True/False forces add/remove."""
    try:
        track_id = _current_track_id(ctx)
    except RuntimeError as e:
        return error("Like failed", details=str(e))
    if not track_id:
        return background("Nothing playing")

    try:
        contains = api(ctx, "GET", "/me/tracks/contains", params={"ids": track_id})
    except RuntimeError as e:
        # Most likely missing user-library-read scope.
        return error("Like check failed", details=str(e) + " — try `sp setup` to refresh scopes")
    is_liked = bool(contains and contains[0])

    target_liked = (not is_liked) if force_state is None else force_state
    try:
        if target_liked:
            api(ctx, "PUT", "/me/tracks", params={"ids": track_id})
            return background(
                "Added to Liked",
                notif={"title": "Spotify", "body": "Saved to Liked Songs"},
            )
        else:
            api(ctx, "DELETE", "/me/tracks", params={"ids": track_id})
            return background("Removed from Liked")
    except RuntimeError as e:
        msg = str(e)
        if "403" in msg or "scope" in msg.lower() or "insufficient" in msg.lower():
            return error(
                "Missing user-library-modify scope",
                details="Run `sp setup` to re-authenticate with the new permission.",
            )
        return error("Like failed", details=msg)


def cmd_shuffle(ctx):
    try:
        cur = api(ctx, "GET", "/me/player")
    except RuntimeError as e:
        return error("Shuffle failed", details=str(e))
    if not cur:
        return background("Nothing playing")
    new_state = not bool(cur.get("shuffle_state"))
    try:
        api(ctx, "PUT", "/me/player/shuffle", params={"state": "true" if new_state else "false"})
    except RuntimeError as e:
        return error("Shuffle failed", details=str(e))
    return background("Shuffle ON" if new_state else "Shuffle OFF")


def main():
    inp = read_input()
    ctx = inp.get("context", {})
    query = inp.get("query", "") or ""
    command_name = inp.get("command", "")

    if not is_authed(ctx):
        write_response(need_setup_response())
        return

    cmd = detect_command(command_name, query)
    try:
        if cmd == "play":
            resp = cmd_play(ctx, query)
        elif cmd == "pause":
            resp = cmd_pause(ctx)
        elif cmd == "next":
            resp = cmd_next(ctx)
        elif cmd == "prev":
            resp = cmd_prev(ctx)
        elif cmd == "vol":
            resp = cmd_vol(ctx, query)
        elif cmd == "shuffle":
            resp = cmd_shuffle(ctx)
        elif cmd == "like":
            resp = cmd_like(ctx, force_state=None)
        elif cmd == "unlike":
            resp = cmd_like(ctx, force_state=False)
        else:
            resp = error(f"Unknown command: {cmd}")
    except RuntimeError as e:
        if str(e) == "not_authenticated":
            resp = need_setup_response()
        else:
            resp = error("Spotify error", details=str(e))

    write_response(resp)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("playback crashed: " + str(e)))
        sys.exit(1)
