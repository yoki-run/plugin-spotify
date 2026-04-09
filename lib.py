"""
Shared helpers for the Yoki Spotify plugin.

SDK I/O and response builders are imported from yoki_plugin_sdk.
This file contains Spotify-specific code: OAuth, API client, convenience functions.

OAuth: Authorization Code with PKCE (no client secret needed for desktop apps).
Tokens are persisted in <plugin_dir>/data/tokens.json.
Client ID is persisted in <plugin_dir>/data/config.json.
"""

import os
import json
import time
import urllib.request
import urllib.parse
import urllib.error

from yoki_plugin_sdk import (
    read_input,
    write_response,
    strip_keyword,
    esc_html,
)
from yoki_plugin_sdk import background  # noqa: F401
from yoki_plugin_sdk import list_response  # noqa: F401
from yoki_plugin_sdk import detail as detail_response  # noqa: F401
from yoki_plugin_sdk import error as _sdk_error


def error(msg, details=None, retry=None):
    """Extended error response with optional retry_action (Spotify-specific)."""
    out = _sdk_error(msg, details)
    if retry:
        out["retry_action"] = retry
    return out


# ---------- Paths / config / tokens ----------

def data_dir(ctx):
    d = (ctx or {}).get("data_dir")
    if not d:
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(d, exist_ok=True)
    return d


def load_config(ctx):
    p = os.path.join(data_dir(ctx), "config.json")
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(ctx, cfg):
    p = os.path.join(data_dir(ctx), "config.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def load_tokens(ctx):
    p = os.path.join(data_dir(ctx), "tokens.json")
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_tokens(ctx, tokens):
    p = os.path.join(data_dir(ctx), "tokens.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(tokens, f, ensure_ascii=False, indent=2)


# ---------- HTTP ----------

USER_AGENT = "Yoki-Spotify-Plugin/1.0"


def http_request(method, url, body=None, headers=None, timeout=8):
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        if isinstance(body, dict):
            data = urllib.parse.urlencode(body).encode("utf-8")
            h.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = body.encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})


# ---------- Spotify API ----------

API_BASE = "https://api.spotify.com/v1"
TOKEN_URL = "https://accounts.spotify.com/api/token"
AUTHORIZE_URL = "https://accounts.spotify.com/authorize"


def get_client_id(ctx):
    """
    Resolve Client ID. Resolution order:

      1. Per-install override in data/config.json (power users running
         their own Spotify dev app — set via `sp setup <CLIENT_ID>`).
      2. Yoki credentials service: ctx['credentials']['client_id']
         (Plugin SDK v3 — fetched by the host before invocation).

    The plugin source ships with NO embedded credentials, which is what
    makes it safe to publish open source. Yoki's credentials service
    (slug `spotify`) holds the Client ID and rotates without re-releases.
    """
    cfg = load_config(ctx)
    if cfg.get("client_id"):
        return cfg["client_id"]
    creds = (ctx or {}).get("credentials") or {}
    return creds.get("client_id", "")


def is_authed(ctx):
    return load_tokens(ctx) is not None


def refresh_access_token(ctx):
    client_id = get_client_id(ctx)
    tokens = load_tokens(ctx)
    if not client_id or not tokens or not tokens.get("refresh_token"):
        return None
    body = {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": client_id,
    }
    status, raw, _ = http_request("POST", TOKEN_URL, body=body)
    if status != 200:
        return None
    new = json.loads(raw)
    merged = {
        "access_token": new["access_token"],
        "refresh_token": new.get("refresh_token", tokens["refresh_token"]),
        "expires_at": int(time.time()) + int(new.get("expires_in", 3600)) - 30,
        "token_type": new.get("token_type", "Bearer"),
        "scope": new.get("scope", tokens.get("scope", "")),
    }
    save_tokens(ctx, merged)
    return merged


def get_access_token(ctx):
    tokens = load_tokens(ctx)
    if not tokens:
        return None
    if int(time.time()) >= int(tokens.get("expires_at", 0)):
        tokens = refresh_access_token(ctx)
        if not tokens:
            return None
    return tokens["access_token"]


def api(ctx, method, path, body=None, params=None, retry_on_401=True):
    token = get_access_token(ctx)
    if not token:
        raise RuntimeError("not_authenticated")
    url = API_BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"Authorization": "Bearer " + token}
    if isinstance(body, dict):
        headers["Content-Type"] = "application/json"
        body_bytes = json.dumps(body).encode("utf-8")
    else:
        body_bytes = body
    status, raw, _ = http_request(method, url, body=body_bytes, headers=headers, timeout=10)
    if status == 401 and retry_on_401:
        if refresh_access_token(ctx):
            return api(ctx, method, path, body=body, params=params, retry_on_401=False)
        raise RuntimeError("not_authenticated")
    if status == 204 or not raw:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = None
    if status >= 400:
        msg = "spotify_api_error"
        if isinstance(parsed, dict) and "error" in parsed:
            err = parsed["error"]
            if isinstance(err, dict):
                msg = err.get("message", msg)
            else:
                msg = str(err)
        raise RuntimeError(msg + " (status " + str(status) + ")")
    return parsed


# ---------- Convenience ----------

def fmt_artists(artists):
    return ", ".join(a.get("name", "") for a in (artists or []))


def fmt_duration_ms(ms):
    if ms is None:
        return ""
    s = int(ms) // 1000
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def need_setup_response():
    return error(
        "Spotify plugin not authenticated",
        details="Run  `sp setup <CLIENT_ID>`  with a Client ID from https://developer.spotify.com/dashboard. "
        "Set the redirect URI to http://127.0.0.1:8888/callback when registering your app.",
    )
