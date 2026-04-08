"""
Spotify devices — list mode.
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
        data = api(ctx, "GET", "/me/player/devices")
    except RuntimeError as e:
        if str(e) == "not_authenticated":
            write_response(need_setup_response())
            return
        write_response(error("Devices failed", details=str(e)))
        return

    devices = (data or {}).get("devices") or []
    if not devices:
        write_response(
            list_response(
                [
                    {
                        "id": "none",
                        "title": "No devices available",
                        "subtitle": "Open Spotify on a phone, computer, or speaker first.",
                        "icon": "X",
                    }
                ]
            )
        )
        return

    out = []
    for d in devices:
        active = "  ·  active" if d.get("is_active") else ""
        vol = d.get("volume_percent")
        vol_str = f"  ·  vol {vol}%" if vol is not None else ""
        out.append(
            {
                "id": d.get("id", ""),
                "title": d.get("name", "Unknown"),
                "subtitle": (d.get("type", "") + active + vol_str).strip(),
                "icon": "D",
                "actions": [
                    {
                        "title": "Transfer playback here",
                        "shortcut": "enter",
                        "type": "exec",
                        "exec": "devices.py",
                        "args": ["transfer", d.get("id", "")],
                    }
                ],
            }
        )

    write_response(list_response(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("devices crashed: " + str(e)))
        sys.exit(1)
