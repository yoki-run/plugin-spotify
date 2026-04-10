#!/usr/bin/env node
"use strict";

/**
 * Shared helpers for the Yoki Spotify plugin.
 *
 * SDK I/O and response builders are imported from @yoki/plugin-sdk.
 * This file contains Spotify-specific code: OAuth, API client, convenience functions.
 *
 * OAuth: Authorization Code with PKCE (no client secret needed for desktop apps).
 * Tokens are persisted in <data_dir>/tokens.json.
 * Client ID is persisted in <data_dir>/config.json.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const url = require("url");
const querystring = require("querystring");
const crypto = require("crypto");

const {
  readInput,
  writeResponse,
  detail,
  list,
  background,
  error: sdkError,
  stripKeyword,
  escHtml,
} = require("@yoki/plugin-sdk");

// ---------- Error helper ----------

function error(msg, details) {
  return sdkError(msg, details);
}

// ---------- Paths / config / tokens ----------

function dataDir(ctx) {
  let d = (ctx || {}).data_dir;
  if (!d) {
    d = path.join(__dirname, "data");
  }
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
  return d;
}

function loadConfig(ctx) {
  const p = path.join(dataDir(ctx), "config.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (_) {
    return {};
  }
}

function saveConfig(ctx, cfg) {
  const p = path.join(dataDir(ctx), "config.json");
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), "utf-8");
}

function loadTokens(ctx) {
  const p = path.join(dataDir(ctx), "tokens.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (_) {
    return null;
  }
}

function saveTokens(ctx, tokens) {
  const p = path.join(dataDir(ctx), "tokens.json");
  fs.writeFileSync(p, JSON.stringify(tokens, null, 2), "utf-8");
}

// ---------- HTTP ----------

const USER_AGENT = "Yoki-Spotify-Plugin/1.0";

/**
 * Simple HTTP(S) request using Node.js built-in modules.
 * Returns a Promise resolving to { status, body, headers }.
 */
function httpRequest(method, reqUrl, body, headers, timeout) {
  timeout = timeout || 8000;
  return new Promise(function (resolve, reject) {
    const parsed = new url.URL(reqUrl);
    const mod = parsed.protocol === "https:" ? https : http;
    const h = { "User-Agent": USER_AGENT };
    if (headers) {
      Object.assign(h, headers);
    }

    let data = null;
    if (body != null) {
      if (typeof body === "object" && !Buffer.isBuffer(body)) {
        data = querystring.stringify(body);
        if (!h["Content-Type"]) {
          h["Content-Type"] = "application/x-www-form-urlencoded";
        }
      } else if (Buffer.isBuffer(body)) {
        data = body;
      } else {
        data = String(body);
      }
      if (data != null) {
        h["Content-Length"] = Buffer.byteLength(data);
      }
    }

    const opts = {
      method: method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: h,
      timeout: timeout,
    };

    const req = mod.request(opts, function (res) {
      const chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks),
          headers: res.headers,
        });
      });
    });

    req.on("error", function (err) { reject(err); });
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });

    if (data != null) {
      req.write(data);
    }
    req.end();
  });
}

// ---------- Spotify API ----------

const API_BASE = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";

function getClientId(ctx) {
  const cfg = loadConfig(ctx);
  if (cfg.client_id) return cfg.client_id;
  const creds = (ctx || {}).credentials || {};
  return creds.client_id || "";
}

function isAuthed(ctx) {
  return loadTokens(ctx) !== null;
}

async function refreshAccessToken(ctx) {
  const clientId = getClientId(ctx);
  const tokens = loadTokens(ctx);
  if (!clientId || !tokens || !tokens.refresh_token) return null;

  const body = {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  };

  let res;
  try {
    res = await httpRequest("POST", TOKEN_URL, body);
  } catch (_) {
    return null;
  }

  if (res.status !== 200) return null;

  const data = JSON.parse(res.body.toString("utf-8"));
  const merged = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) - 30,
    token_type: data.token_type || "Bearer",
    scope: data.scope || tokens.scope || "",
  };
  saveTokens(ctx, merged);
  return merged;
}

async function getAccessToken(ctx) {
  let tokens = loadTokens(ctx);
  if (!tokens) return null;
  if (Math.floor(Date.now() / 1000) >= (tokens.expires_at || 0)) {
    tokens = await refreshAccessToken(ctx);
    if (!tokens) return null;
  }
  return tokens.access_token;
}

async function api(ctx, method, apiPath, body, params, retryOn401) {
  if (retryOn401 === undefined) retryOn401 = true;

  const token = await getAccessToken(ctx);
  if (!token) throw new Error("not_authenticated");

  let reqUrl = API_BASE + apiPath;
  if (params) {
    reqUrl += "?" + querystring.stringify(params);
  }

  const headers = { Authorization: "Bearer " + token };
  let bodyData = null;
  if (body != null) {
    if (typeof body === "object" && !Buffer.isBuffer(body)) {
      headers["Content-Type"] = "application/json";
      bodyData = JSON.stringify(body);
    } else {
      bodyData = body;
    }
  }

  const res = await httpRequest(method, reqUrl, bodyData, headers, 10000);

  if (res.status === 401 && retryOn401) {
    const refreshed = await refreshAccessToken(ctx);
    if (refreshed) {
      return api(ctx, method, apiPath, body, params, false);
    }
    throw new Error("not_authenticated");
  }

  if (res.status === 204 || !res.body || res.body.length === 0) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body.toString("utf-8"));
  } catch (_) {
    parsed = null;
  }

  if (res.status >= 400) {
    let msg = "spotify_api_error";
    if (parsed && parsed.error) {
      if (typeof parsed.error === "object") {
        msg = parsed.error.message || msg;
      } else {
        msg = String(parsed.error);
      }
    }
    throw new Error(msg + " (status " + res.status + ")");
  }

  return parsed;
}

// ---------- Convenience ----------

function fmtArtists(artists) {
  return (artists || []).map(function (a) { return a.name || ""; }).join(", ");
}

function fmtDurationMs(ms) {
  if (ms == null) return "";
  let s = Math.floor(ms / 1000);
  let m = Math.floor(s / 60);
  s = s % 60;
  const h = Math.floor(m / 60);
  m = m % 60;
  if (h) {
    return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  return m + ":" + String(s).padStart(2, "0");
}

function needSetupResponse() {
  return error(
    "Spotify plugin not authenticated",
    "Run  `sp setup <CLIENT_ID>`  with a Client ID from https://developer.spotify.com/dashboard. " +
    "Set the redirect URI to http://127.0.0.1:8888/callback when registering your app."
  );
}

// ---------- PKCE ----------

function makePkce() {
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier: verifier, challenge: challenge };
}

// ---------- Exports ----------

module.exports = {
  readInput: readInput,
  writeResponse: writeResponse,
  detail: detail,
  list: list,
  background: background,
  error: error,
  stripKeyword: stripKeyword,
  escHtml: escHtml,
  dataDir: dataDir,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  loadTokens: loadTokens,
  saveTokens: saveTokens,
  httpRequest: httpRequest,
  API_BASE: API_BASE,
  TOKEN_URL: TOKEN_URL,
  AUTHORIZE_URL: AUTHORIZE_URL,
  getClientId: getClientId,
  isAuthed: isAuthed,
  refreshAccessToken: refreshAccessToken,
  getAccessToken: getAccessToken,
  api: api,
  fmtArtists: fmtArtists,
  fmtDurationMs: fmtDurationMs,
  needSetupResponse: needSetupResponse,
  makePkce: makePkce,
};
