#!/usr/bin/env node
"use strict";

/**
 * Spotify OAuth setup wizard.
 *
 * Usage from Yoki:
 *     sp setup <CLIENT_ID>
 *
 * Spotify app must have http://127.0.0.1:8888/callback registered as a redirect URI.
 */

const http = require("http");
const url = require("url");
const querystring = require("querystring");
const crypto = require("crypto");

const {
  readInput,
  writeResponse,
  background,
  error,
  saveConfig,
  saveTokens,
  stripKeyword,
  httpRequest,
  getClientId,
  makePkce,
  AUTHORIZE_URL,
  TOKEN_URL,
} = require("./lib");

const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

function openBrowser(targetUrl) {
  const { exec } = require("child_process");
  const platform = process.platform;
  let cmd;
  if (platform === "win32") cmd = "start \"\" \"" + targetUrl + "\"";
  else if (platform === "darwin") cmd = "open \"" + targetUrl + "\"";
  else cmd = "xdg-open \"" + targetUrl + "\"";
  try {
    exec(cmd);
  } catch (_) {}
}

function waitForCode(timeout) {
  timeout = timeout || 90000;
  return new Promise(function (resolve) {
    const result = {};
    const server = http.createServer(function (req, res) {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const params = parsed.query || {};
      if (params.code) {
        result.code = params.code;
        result.state = params.state || "";
        const body = "<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h1>Spotify connected</h1><p>You can close this tab and return to Yoki.</p></body></html>";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
      } else if (params.error) {
        result.error = params.error;
        const body = "<html><body><h1>Authentication failed</h1></body></html>";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
      } else {
        res.writeHead(400);
        res.end();
        return;
      }
      // Close server after receiving callback
      server.close();
    });

    server.listen(8888, "127.0.0.1");

    const timer = setTimeout(function () {
      server.close();
      resolve(result);
    }, timeout);

    server.on("close", function () {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function main() {
  const inp = await readInput();
  const ctx = inp.context || {};
  const override = stripKeyword(inp.query || "", "setup", "auth", "login").trim();

  const clientId = override || getClientId(ctx);

  if (!clientId) {
    writeResponse(
      error(
        "No Spotify Client ID available",
        "Yoki couldn't fetch a Client ID from the credentials service.\n\n" +
        "Make sure you're signed in to Yoki, then try again. " +
        "Power users can supply their own:\n" +
        "  sp setup <CLIENT_ID>\n" +
        "(get one at https://developer.spotify.com/dashboard with " +
        "redirect URI http://127.0.0.1:8888/callback)."
      )
    );
    return;
  }

  if (override) {
    saveConfig(ctx, { client_id: override });
  }

  const pkce = makePkce();
  const state = crypto.randomBytes(16).toString("base64url");

  const authParams = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: pkce.challenge,
    state: state,
    scope: SCOPES,
  };
  const authUrl = AUTHORIZE_URL + "?" + querystring.stringify(authParams);

  openBrowser(authUrl);

  const result = await waitForCode(90000);

  if (result.error) {
    writeResponse(error("Spotify auth declined", result.error));
    return;
  }
  if (!result.code) {
    writeResponse(
      error("Auth timeout", "Did not receive a callback within 90 seconds.")
    );
    return;
  }
  if (result.state !== state) {
    writeResponse(error("State mismatch", "CSRF check failed."));
    return;
  }

  const body = {
    grant_type: "authorization_code",
    code: result.code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: pkce.verifier,
  };

  let res;
  try {
    res = await httpRequest("POST", TOKEN_URL, body);
  } catch (e) {
    writeResponse(error("Token exchange failed", e.message));
    return;
  }

  if (res.status !== 200) {
    writeResponse(
      error(
        "Token exchange failed",
        "HTTP " + res.status + ": " + res.body.toString("utf-8").slice(0, 200)
      )
    );
    return;
  }

  const tok = JSON.parse(res.body.toString("utf-8"));
  const tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (tok.expires_in || 3600) - 30,
    token_type: tok.token_type || "Bearer",
    scope: tok.scope || SCOPES,
  };
  saveTokens(ctx, tokens);

  writeResponse(
    background("Spotify connected", { title: "Spotify", body: "Plugin authenticated successfully" })
  );
}

main().catch(function (e) {
  writeResponse(error("Setup crashed: " + e.message));
  process.exit(1);
});
