"""
Spotify playlists — list mode.
"""

import sys

from lib import (
    read_input,
    write_response,
    list_response,
    error,
    need_setup_response,
    is_authed,
    api,
)


def main():
    inp = read_input()
    ctx = inp.get("context", {})

    if not is_authed(ctx):
        write_response(need_setup_response())
        return

    try:
        data = api(ctx, "GET", "/me/playlists", params={"limit": 50})
    except RuntimeError as e:
        if str(e) == "not_authenticated":
            write_response(need_setup_response())
            return
        write_response(error("Playlists failed", details=str(e)))
        return

    items = (data or {}).get("items") or []
    if not items:
        write_response(
            list_response(
                [
                    {
                        "id": "empty",
                        "title": "No playlists",
                        "subtitle": "Create one in Spotify and reload.",
                        "icon": "L",
                    }
                ]
            )
        )
        return

    out = []
    for p in items:
        owner = (p.get("owner") or {}).get("display_name", "")
        tracks = (p.get("tracks") or {}).get("total", 0)
        subtitle_parts = []
        if owner:
            subtitle_parts.append(f"by {owner}")
        subtitle_parts.append(f"{tracks} tracks")
        if p.get("public") is False:
            subtitle_parts.append("private")
        out.append(
            {
                "id": p.get("uri", p.get("id", "")),
                "title": p.get("name", "Untitled"),
                "subtitle": "  ·  ".join(subtitle_parts),
                "icon": "L",
                "actions": [
                    {
                        "title": "Play",
                        "shortcut": "enter",
                        "type": "exec",
                        "exec": "playlists.py",
                        "args": ["play", p.get("uri", "")],
                    },
                    {
                        "title": "Open in Spotify",
                        "shortcut": "cmd+o",
                        "type": "open_url",
                        "url": (p.get("external_urls") or {}).get("spotify", ""),
                    },
                ],
            }
        )

    write_response(list_response(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("playlists crashed: " + str(e)))
        sys.exit(1)
