"""
Spotify OAuth setup wizard.

Usage from Yoki:
    sp setup <CLIENT_ID>

Spotify app must have http://127.0.0.1:8888/callback registered as a redirect URI.
"""

import sys
import time
import secrets
import hashlib
import base64
import webbrowser
import urllib.parse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from lib import (
    read_input,
    write_response,
    background,
    error,
    save_config,
    save_tokens,
    strip_keyword,
    http_request,
    get_client_id,
    AUTHORIZE_URL,
    TOKEN_URL,
)

REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPES = " ".join(
    [
        "user-read-playback-state",
        "user-modify-playback-state",
        "user-read-currently-playing",
        "user-library-read",
        "user-library-modify",
        "playlist-read-private",
        "playlist-read-collaborative",
    ]
)


def make_pkce():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


class CallbackHandler(BaseHTTPRequestHandler):
    code_holder = {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            CallbackHandler.code_holder["code"] = params["code"][0]
            CallbackHandler.code_holder["state"] = params.get("state", [""])[0]
            body = b"<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h1>Spotify connected</h1><p>You can close this tab and return to Yoki.</p></body></html>"
        elif "error" in params:
            CallbackHandler.code_holder["error"] = params["error"][0]
            body = b"<html><body><h1>Authentication failed</h1></body></html>"
        else:
            self.send_response(400)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


def wait_for_code(timeout=90):
    server = HTTPServer(("127.0.0.1", 8888), CallbackHandler)
    server.timeout = 1
    deadline = time.time() + timeout
    while time.time() < deadline:
        server.handle_request()
        if "code" in CallbackHandler.code_holder or "error" in CallbackHandler.code_holder:
            break
    server.server_close()
    return CallbackHandler.code_holder


def main():
    inp = read_input()
    ctx = inp.get("context", {})
    override = strip_keyword(inp.get("query", ""), "setup", "auth", "login").strip()

    # Resolution order:
    #   1. Explicit override from `sp setup <id>` (power users with their
    #      own Spotify dev app — saved to data/config.json).
    #   2. Yoki credentials service: ctx.credentials.client_id (default,
    #      fetched before invocation when the user is signed in to Yoki).
    client_id = override or get_client_id(ctx)

    if not client_id:
        write_response(
            error(
                "No Spotify Client ID available",
                details=(
                    "Yoki couldn't fetch a Client ID from the credentials service.\n\n"
                    "Make sure you're signed in to Yoki, then try again. "
                    "Power users can supply their own:\n"
                    "  sp setup <CLIENT_ID>\n"
                    "(get one at https://developer.spotify.com/dashboard with "
                    "redirect URI http://127.0.0.1:8888/callback)."
                ),
            )
        )
        return

    # Persist override only — never write the credential-service value to
    # disk. That would defeat rotation: the next refresh would still use
    # the stale value from data/config.json instead of the fresh one from
    # the server.
    if override:
        save_config(ctx, {"client_id": override})
    verifier, challenge = make_pkce()
    state = secrets.token_urlsafe(16)

    auth_params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
        "scope": SCOPES,
    }
    auth_url = AUTHORIZE_URL + "?" + urllib.parse.urlencode(auth_params)

    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    result = wait_for_code(timeout=90)

    if "error" in result:
        write_response(error("Spotify auth declined", details=result["error"]))
        return
    if "code" not in result:
        write_response(
            error(
                "Auth timeout",
                details="Did not receive a callback within 90 seconds.",
            )
        )
        return
    if result.get("state") != state:
        write_response(error("State mismatch", details="CSRF check failed."))
        return

    body = {
        "grant_type": "authorization_code",
        "code": result["code"],
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
        "code_verifier": verifier,
    }
    status, raw, _ = http_request("POST", TOKEN_URL, body=body)
    if status != 200:
        write_response(
            error(
                "Token exchange failed",
                details=f"HTTP {status}: {raw[:200].decode('utf-8', 'replace')}",
            )
        )
        return

    tok = json.loads(raw)
    tokens = {
        "access_token": tok["access_token"],
        "refresh_token": tok["refresh_token"],
        "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)) - 30,
        "token_type": tok.get("token_type", "Bearer"),
        "scope": tok.get("scope", SCOPES),
    }
    save_tokens(ctx, tokens)

    write_response(
        background(
            "Spotify connected",
            notif={"title": "Spotify", "body": "Plugin authenticated successfully"},
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        write_response(error("Setup crashed: " + str(e)))
        sys.exit(1)
