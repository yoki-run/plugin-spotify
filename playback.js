#!/usr/bin/env node
"use strict";

/**
 * Spotify playback controls — background mode.
 */

const {
  readInput,
  writeResponse,
  background,
  error,
  needSetupResponse,
  isAuthed,
  api,
  stripKeyword,
  fmtArtists,
} = require("./lib");

async function ensureDeviceId(ctx) {
  try {
    const cur = await api(ctx, "GET", "/me/player");
    if (cur && (cur.device || {}).id) return cur.device.id;
  } catch (_) {}
  let data;
  try {
    data = (await api(ctx, "GET", "/me/player/devices")) || {};
  } catch (_) {
    return null;
  }
  const items = data.devices || [];
  if (!items.length) return null;
  for (const d of items) {
    if (d.is_active) return d.id;
  }
  for (const d of items) {
    if (!d.is_restricted) return d.id;
  }
  return items[0].id;
}

function noDeviceError() {
  return error(
    "No active Spotify device",
    "Open Spotify on a phone, computer, or speaker first. `sp d` shows what Yoki sees."
  );
}

function isNoDeviceError(e) {
  const s = (e.message || "").toLowerCase();
  return s.includes("no active") || s.includes("no_active_device") || s.includes("404");
}

function detectCommand(inputCommand, query) {
  if (["play", "pause", "next", "prev", "vol", "shuffle", "like", "unlike"].indexOf(inputCommand) !== -1) {
    return inputCommand;
  }
  const low = (query || "").trim().toLowerCase();
  const mapping = [
    ["pause", "pause"], ["stop", "pause"],
    ["next", "next"], ["skip", "next"], ["n", "next"],
    ["prev", "prev"], ["previous", "prev"], ["back", "prev"], ["p", "prev"],
    ["vol", "vol"], ["volume", "vol"], ["v", "vol"],
    ["shuffle", "shuffle"], ["sh", "shuffle"],
    ["unlike", "unlike"], ["unfav", "unlike"],
    ["like", "like"], ["love", "like"], ["fav", "like"],
    ["play", "play"],
  ];
  for (const [kw, name] of mapping) {
    if (low === kw || low.startsWith(kw + " ")) return name;
  }
  return "play";
}

function isSpotifyUri(s) {
  return s.startsWith("spotify:") || s.startsWith("https://open.spotify.com/");
}

async function cmdPlay(ctx, query) {
  const arg = stripKeyword(query, "play");
  const deviceId = await ensureDeviceId(ctx);
  if (deviceId == null) return noDeviceError();

  if (!arg) {
    try {
      await api(ctx, "PUT", "/me/player/play", null, { device_id: deviceId });
      return background("Resumed");
    } catch (e) {
      if (isNoDeviceError(e)) return noDeviceError();
      return error("Play failed", e.message);
    }
  }

  if (isSpotifyUri(arg)) {
    const isTrack = arg.includes(":track:") || arg.includes("/track/");
    const body = isTrack ? { uris: [arg] } : { context_uri: arg };
    try {
      await api(ctx, "PUT", "/me/player/play", body, { device_id: deviceId });
    } catch (e) {
      if (isNoDeviceError(e)) return noDeviceError();
      return error("Play failed", e.message);
    }
    return background("Playing " + arg.split(":").pop().slice(0, 20) + "...");
  }

  // Text query — search for a track and play the first result
  let res;
  try {
    res = await api(ctx, "GET", "/search", null, { q: arg, type: "track", limit: 1 });
  } catch (e) {
    return error("Search failed", e.message);
  }
  const items = ((res || {}).tracks || {}).items || [];
  if (!items.length) return background("No tracks found for: " + arg);

  const track = items[0];
  const uri = track.uri;
  try {
    await api(ctx, "PUT", "/me/player/play", { uris: [uri] }, { device_id: deviceId });
  } catch (e) {
    if (isNoDeviceError(e)) return noDeviceError();
    return error("Play failed", e.message);
  }
  const desc = track.name + " - " + fmtArtists(track.artists);
  return background(desc, { title: "Now playing", body: desc });
}

async function cmdPause(ctx) {
  const deviceId = await ensureDeviceId(ctx);
  if (deviceId == null) return noDeviceError();
  try {
    await api(ctx, "PUT", "/me/player/pause", null, { device_id: deviceId });
  } catch (e) {
    if (isNoDeviceError(e)) return noDeviceError();
    return error("Pause failed", e.message);
  }
  return background("Paused");
}

async function cmdNext(ctx) {
  const deviceId = await ensureDeviceId(ctx);
  if (deviceId == null) return noDeviceError();
  try {
    await api(ctx, "POST", "/me/player/next", null, { device_id: deviceId });
  } catch (e) {
    if (isNoDeviceError(e)) return noDeviceError();
    return error("Next failed", e.message);
  }
  return background("Next track");
}

async function cmdPrev(ctx) {
  const deviceId = await ensureDeviceId(ctx);
  if (deviceId == null) return noDeviceError();
  try {
    await api(ctx, "POST", "/me/player/previous", null, { device_id: deviceId });
  } catch (e) {
    if (isNoDeviceError(e)) return noDeviceError();
    return error("Prev failed", e.message);
  }
  return background("Previous track");
}

async function cmdVol(ctx, query) {
  const arg = stripKeyword(query, "vol", "volume", "v");
  const level = parseInt(arg, 10);
  if (isNaN(level)) {
    return error("Volume must be 0-100", "Got: " + JSON.stringify(arg));
  }
  const clamped = Math.max(0, Math.min(100, level));
  const deviceId = await ensureDeviceId(ctx);
  if (deviceId == null) return noDeviceError();
  try {
    await api(ctx, "PUT", "/me/player/volume", null, { volume_percent: clamped, device_id: deviceId });
  } catch (e) {
    if (isNoDeviceError(e)) return noDeviceError();
    return error("Volume failed", e.message);
  }
  const bars = "#".repeat(Math.floor(clamped / 5)) + "-".repeat(20 - Math.floor(clamped / 5));
  return background("vol " + bars + " " + clamped + "%");
}

async function currentTrackId(ctx) {
  const cur = await api(ctx, "GET", "/me/player/currently-playing");
  if (!cur) return null;
  return (cur.item || {}).id || null;
}

async function cmdLike(ctx, forceState) {
  let trackId;
  try {
    trackId = await currentTrackId(ctx);
  } catch (e) {
    return error("Like failed", e.message);
  }
  if (!trackId) return background("Nothing playing");

  let contains;
  try {
    contains = await api(ctx, "GET", "/me/tracks/contains", null, { ids: trackId });
  } catch (e) {
    return error("Like check failed", e.message + " \u2014 try `sp setup` to refresh scopes");
  }
  const isLiked = !!(contains && contains[0]);
  const targetLiked = forceState === undefined ? !isLiked : forceState;

  try {
    if (targetLiked) {
      await api(ctx, "PUT", "/me/tracks", null, { ids: trackId });
      return background("Added to Liked", { title: "Spotify", body: "Saved to Liked Songs" });
    } else {
      await api(ctx, "DELETE", "/me/tracks", null, { ids: trackId });
      return background("Removed from Liked");
    }
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("403") || msg.toLowerCase().includes("scope") || msg.toLowerCase().includes("insufficient")) {
      return error(
        "Missing user-library-modify scope",
        "Run `sp setup` to re-authenticate with the new permission."
      );
    }
    return error("Like failed", msg);
  }
}

async function cmdShuffle(ctx) {
  let cur;
  try {
    cur = await api(ctx, "GET", "/me/player");
  } catch (e) {
    return error("Shuffle failed", e.message);
  }
  if (!cur) return background("Nothing playing");
  const newState = !cur.shuffle_state;
  try {
    await api(ctx, "PUT", "/me/player/shuffle", null, { state: newState ? "true" : "false" });
  } catch (e) {
    return error("Shuffle failed", e.message);
  }
  return background(newState ? "Shuffle ON" : "Shuffle OFF");
}

async function main() {
  const inp = await readInput();
  const ctx = inp.context || {};
  const query = inp.query || "";
  const commandName = inp.command || "";

  if (!isAuthed(ctx)) {
    writeResponse(needSetupResponse());
    return;
  }

  const cmd = detectCommand(commandName, query);
  let resp;
  try {
    if (cmd === "play") resp = await cmdPlay(ctx, query);
    else if (cmd === "pause") resp = await cmdPause(ctx);
    else if (cmd === "next") resp = await cmdNext(ctx);
    else if (cmd === "prev") resp = await cmdPrev(ctx);
    else if (cmd === "vol") resp = await cmdVol(ctx, query);
    else if (cmd === "shuffle") resp = await cmdShuffle(ctx);
    else if (cmd === "like") resp = await cmdLike(ctx);
    else if (cmd === "unlike") resp = await cmdLike(ctx, false);
    else resp = error("Unknown command: " + cmd);
  } catch (e) {
    if (e.message === "not_authenticated") {
      resp = needSetupResponse();
    } else {
      resp = error("Spotify error", e.message);
    }
  }

  writeResponse(resp);
}

main().catch(function (e) {
  writeResponse(error("playback crashed: " + e.message));
  process.exit(1);
});
