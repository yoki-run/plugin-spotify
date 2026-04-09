"""
Spotify search — list mode.
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
    strip_keyword,
    fmt_artists,
    fmt_duration_ms,
)


def main():
    inp = read_input()
    ctx = inp.get("context", {})
    query = strip_keyword(inp.get("query", ""), "search", "find", "s")

    if not query:
        write_response(
            list_response(
                [
                    {
                        "id": "hint",
                        "title": "Type something to search Spotify",
                        "subtitle": "e.g.  sp search dua lipa",
                        "icon": "?",
                    }
                ]
            )
        )
        return

    if not is_authed(ctx):
        write_response(need_setup_response())
        return

    try:
        res = api(ctx, "GET", "/search", params={"q": query, "type": "track", "limit": 15})
    except RuntimeError as e:
        if str(e) == "not_authenticated":
            write_response(need_setup_response())
            return
        write_response(error("Search failed", details=str(e)))
        return

    items = ((res or {}).get("tracks") or {}).get("items") or []
    if not items:
        write_response(
            list_response(
                [
                    {
                        "id": "empty",
                        "title": f"No results for: {query}",
                        "subtitle": "Try a different query",
                        "icon": "?",
                    }
                ]
            )
        )
        return

    out = []
    for t in items:
        artists = fmt_artists(t.get("artists"))
        album = (t.get("album") or {}).get("name", "")
        dur = fmt_duration_ms(t.get("duration_ms"))
        subtitle_parts = [artists]
        if album:
            subtitle_parts.append(album)
        if dur:
            subtitle_parts.append(dur)
        out.append(
            {
                "id": t.get("uri", t.get("id", "")),
                "title": t.get("name", "Unknown"),
                "subtitle": "  ·  ".join(p for p in subtitle_parts if p),
                "icon": "M",
                "actions": [
                    {
                        "title": "Play",
                        "shortcut": "enter",
                        "type": "exec",
                        "exec": "playback.py",
                        "args": ["play", t.get("uri", "")],
                    },
                    {
                        "title": "Open in Spotify",
                        "shortcut": "cmd+o",
                        "type": "open_url",
                        "url": (t.get("external_urls") or {}).get("spotify", ""),
                    },
                ],
            }
        )

    write_response(list_response(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("search crashed: " + str(e)))
        sys.exit(1)
