"""
Spotify "Now Playing" — detail mode.

Triggered by:  sp
"""

import sys

from lib import (
    read_input,
    write_response,
    detail_response,
    error,
    need_setup_response,
    is_authed,
    api,
    fmt_artists,
    fmt_duration_ms,
)


SPOTIFY_GREEN = "#1ed760"
MUTED = "#9b9b9b"
DIM = "#6e6e6e"
BG_TRACK = "rgba(255,255,255,0.08)"


# Inline SVG icons (lucide.dev). Plugin-owned — host knows nothing about media
# domain. Each is 24x24 stroke=currentColor so it inherits the button color.
ICON_SKIP_BACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>'
ICON_SKIP_FORWARD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'
ICON_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
ICON_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
ICON_SHUFFLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>'
ICON_VOL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'
ICON_HEART_OUTLINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
ICON_HEART_FILLED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'


def html_escape(s):
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_card(item, data):
    """Build the now-playing HTML card. All inline styles so DOMPurify
    keeps everything; no class names needed."""
    track_name = html_escape(item.get("name", "Unknown"))
    artists = html_escape(fmt_artists(item.get("artists")))
    album = html_escape((item.get("album") or {}).get("name", ""))
    is_playing = data.get("is_playing", False)
    progress_ms = data.get("progress_ms", 0) or 0
    duration_ms = item.get("duration_ms", 0) or 0
    device = html_escape((data.get("device") or {}).get("name", ""))
    volume = (data.get("device") or {}).get("volume_percent")

    images = (item.get("album") or {}).get("images") or []
    cover_url = html_escape(images[0]["url"]) if images else ""

    pct = 0
    if duration_ms:
        pct = max(0, min(100, int((progress_ms / duration_ms) * 100)))

    state_glyph = "▶" if is_playing else "⏸"
    state_color = SPOTIFY_GREEN if is_playing else MUTED

    cover_html = (
        f'<img src="{cover_url}" alt="" style="width:140px;height:140px;border-radius:8px;'
        f'object-fit:cover;box-shadow:0 6px 20px rgba(0,0,0,0.5);flex-shrink:0" />'
        if cover_url
        else '<div style="width:140px;height:140px;border-radius:8px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>'
    )

    device_line = ""
    if device:
        vol_str = f" · {volume}%" if volume is not None else ""
        device_line = (
            f'<div style="font-size:11px;color:{DIM};margin-top:10px;display:flex;align-items:center;gap:6px">'
            f'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:{SPOTIFY_GREEN};'
            f'box-shadow:0 0 6px {SPOTIFY_GREEN}"></span>'
            f'{device}{vol_str}'
            f'</div>'
        )

    progress_html = (
        f'<div style="margin-top:14px">'
        f'<div style="height:4px;background:{BG_TRACK};border-radius:2px;overflow:hidden">'
        f'<div style="height:100%;width:{pct}%;background:{SPOTIFY_GREEN};border-radius:2px;transition:width 0.3s"></div>'
        f'</div>'
        f'<div style="display:flex;justify-content:space-between;font-size:11px;color:{DIM};margin-top:6px;font-variant-numeric:tabular-nums">'
        f'<span>{fmt_duration_ms(progress_ms)}</span>'
        f'<span>{fmt_duration_ms(duration_ms)}</span>'
        f'</div>'
        f'</div>'
    )

    album_html = (
        f'<div style="font-size:12px;color:{DIM};font-style:italic;margin-top:2px;'
        f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{album}</div>'
        if album
        else ""
    )

    info_html = (
        f'<div style="flex:1;min-width:0;padding-top:4px">'
        f'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        f'<span style="font-size:14px;color:{state_color}">{state_glyph}</span>'
        f'<div style="font-size:18px;font-weight:600;color:#fff;'
        f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{track_name}</div>'
        f'</div>'
        f'<div style="font-size:13px;color:#d4d4d4;'
        f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{artists}</div>'
        f'{album_html}'
        f'{progress_html}'
        f'{device_line}'
        f'</div>'
    )

    card_html = (
        f'<div style="display:flex;gap:16px;align-items:stretch;padding:6px 4px">'
        f'{cover_html}{info_html}'
        f'</div>'
    )
    return card_html


def build_actions(is_playing, is_liked):
    """Return V2Action[] for the now-playing controls. The host renders these
    as native React buttons with click handlers — we don't try to put them
    inside the markdown HTML where DOMPurify would strip the click events.
    Each action is a 'yoki_run' which the host parses into a PluginsExecuteV2
    call (same as if the user typed the value into the search box)."""
    primary_type = "yoki_run"
    return [
        {
            "title": "Unlike" if is_liked else "Like",
            "type": primary_type,
            "value": "sp unlike" if is_liked else "sp like",
            "icon": ICON_HEART_FILLED if is_liked else ICON_HEART_OUTLINE,
        },
        {"title": "Prev", "type": primary_type, "value": "sp prev", "icon": ICON_SKIP_BACK},
        {
            "title": "Pause" if is_playing else "Play",
            "type": primary_type,
            "value": "sp pause" if is_playing else "sp play",
            "icon": ICON_PAUSE if is_playing else ICON_PLAY,
            "variant": "primary",
        },
        {"title": "Next", "type": primary_type, "value": "sp next", "icon": ICON_SKIP_FORWARD},
        {"title": "Shuffle", "type": primary_type, "value": "sp shuffle", "icon": ICON_SHUFFLE},
        {"title": "Vol 50", "type": primary_type, "value": "sp vol 50", "icon": ICON_VOL},
    ]


def main():
    inp = read_input()
    ctx = inp.get("context", {})

    if not is_authed(ctx):
        write_response(need_setup_response())
        return

    try:
        data = api(ctx, "GET", "/me/player")
    except RuntimeError as e:
        if str(e) == "not_authenticated":
            write_response(need_setup_response())
            return
        write_response(error("Spotify API error", details=str(e)))
        return

    if not data or not data.get("item"):
        empty_html = (
            '<div style="padding:24px;text-align:center;color:#9b9b9b">'
            '<div style="font-size:42px;margin-bottom:8px">⏸</div>'
            '<div style="font-size:14px;color:#d4d4d4;margin-bottom:4px">Nothing playing</div>'
            '<div style="font-size:12px">Open Spotify and start a track, then run <code>sp</code> again.</div>'
            '<div style="font-size:11px;margin-top:10px;color:#6e6e6e">'
            'Tip: <code>sp play &lt;query&gt;</code> searches & plays in one shot.'
            '</div>'
            '</div>'
        )
        write_response(detail_response(empty_html))
        return

    item = data["item"]
    duration_ms = item.get("duration_ms", 0)
    device = (data.get("device") or {}).get("name", "")

    metadata = []
    if duration_ms:
        metadata.append({"label": "Duration", "value": fmt_duration_ms(duration_ms)})
    if device:
        metadata.append({"label": "Device", "value": device})
    if item.get("popularity") is not None:
        metadata.append({"label": "Popularity", "value": str(item["popularity"]) + "/100"})
    ext_url = (item.get("external_urls") or {}).get("spotify")
    if ext_url:
        metadata.append({"label": "Open in Spotify", "value": ext_url})

    is_playing = data.get("is_playing", False)

    # Detect like state for the heart button. Failure here is non-fatal —
    # if the user hasn't re-authenticated with user-library-read scope yet,
    # we just default to "not liked" (hollow heart) and the like command
    # itself will surface the scope error if needed.
    is_liked = False
    track_id = item.get("id")
    if track_id:
        try:
            contains = api(ctx, "GET", "/me/tracks/contains", params={"ids": track_id})
            is_liked = bool(contains and contains[0])
        except Exception:
            pass

    write_response(
        detail_response(
            render_card(item, data),
            metadata=metadata,
            actions=build_actions(is_playing, is_liked),
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("now_playing crashed: " + str(e)))
        sys.exit(1)
