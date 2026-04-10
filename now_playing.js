#!/usr/bin/env node
"use strict";

/**
 * Spotify "Now Playing" — detail mode.
 *
 * Triggered by:  sp
 */

const {
  readInput,
  writeResponse,
  detail,
  error,
  needSetupResponse,
  isAuthed,
  api,
  fmtArtists,
  fmtDurationMs,
} = require("./lib");

const SPOTIFY_GREEN = "#1ed760";
const MUTED = "#9b9b9b";
const DIM = "#6e6e6e";
const BG_TRACK = "rgba(255,255,255,0.08)";

// Inline SVG icons (lucide.dev)
const ICON_SKIP_BACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
const ICON_SKIP_FORWARD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
const ICON_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const ICON_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const ICON_SHUFFLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
const ICON_VOL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const ICON_HEART_OUTLINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
const ICON_HEART_FILLED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

function htmlEscape(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCard(item, data) {
  const trackName = htmlEscape(item.name || "Unknown");
  const artists = htmlEscape(fmtArtists(item.artists));
  const album = htmlEscape((item.album || {}).name || "");
  const isPlaying = data.is_playing || false;
  const progressMs = data.progress_ms || 0;
  const durationMs = item.duration_ms || 0;
  const device = htmlEscape((data.device || {}).name || "");
  const volume = (data.device || {}).volume_percent;

  const images = (item.album || {}).images || [];
  const coverUrl = images.length ? htmlEscape(images[0].url) : "";

  let pct = 0;
  if (durationMs) {
    pct = Math.max(0, Math.min(100, Math.floor((progressMs / durationMs) * 100)));
  }

  const stateGlyph = isPlaying ? "\u25B6" : "\u23F8";
  const stateColor = isPlaying ? SPOTIFY_GREEN : MUTED;

  const coverHtml = coverUrl
    ? '<img src="' + coverUrl + '" alt="" style="width:140px;height:140px;border-radius:8px;object-fit:cover;box-shadow:0 6px 20px rgba(0,0,0,0.5);flex-shrink:0" />'
    : '<div style="width:140px;height:140px;border-radius:8px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';

  let deviceLine = "";
  if (device) {
    const volStr = volume != null ? " \u00B7 " + volume + "%" : "";
    deviceLine =
      '<div style="font-size:11px;color:' + DIM + ';margin-top:10px;display:flex;align-items:center;gap:6px">' +
      '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + SPOTIFY_GREEN + ';box-shadow:0 0 6px ' + SPOTIFY_GREEN + '"></span>' +
      device + volStr +
      '</div>';
  }

  const progressHtml =
    '<div style="margin-top:14px">' +
    '<div style="height:4px;background:' + BG_TRACK + ';border-radius:2px;overflow:hidden">' +
    '<div style="height:100%;width:' + pct + '%;background:' + SPOTIFY_GREEN + ';border-radius:2px;transition:width 0.3s"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:' + DIM + ';margin-top:6px;font-variant-numeric:tabular-nums">' +
    '<span>' + fmtDurationMs(progressMs) + '</span>' +
    '<span>' + fmtDurationMs(durationMs) + '</span>' +
    '</div>' +
    '</div>';

  const albumHtml = album
    ? '<div style="font-size:12px;color:' + DIM + ';font-style:italic;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + album + '</div>'
    : "";

  const infoHtml =
    '<div style="flex:1;min-width:0;padding-top:4px">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
    '<span style="font-size:14px;color:' + stateColor + '">' + stateGlyph + '</span>' +
    '<div style="font-size:18px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + trackName + '</div>' +
    '</div>' +
    '<div style="font-size:13px;color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + artists + '</div>' +
    albumHtml +
    progressHtml +
    deviceLine +
    '</div>';

  return '<div style="display:flex;gap:16px;align-items:stretch;padding:6px 4px">' +
    coverHtml + infoHtml +
    '</div>';
}

function buildActions(isPlaying, isLiked) {
  const t = "yoki_run";
  return [
    {
      title: isLiked ? "Unlike" : "Like",
      type: t,
      value: isLiked ? "sp unlike" : "sp like",
      icon: isLiked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE,
    },
    { title: "Prev", type: t, value: "sp prev", icon: ICON_SKIP_BACK },
    {
      title: isPlaying ? "Pause" : "Play",
      type: t,
      value: isPlaying ? "sp pause" : "sp play",
      icon: isPlaying ? ICON_PAUSE : ICON_PLAY,
      variant: "primary",
    },
    { title: "Next", type: t, value: "sp next", icon: ICON_SKIP_FORWARD },
    { title: "Shuffle", type: t, value: "sp shuffle", icon: ICON_SHUFFLE },
    { title: "Vol 50", type: t, value: "sp vol 50", icon: ICON_VOL },
  ];
}

async function main() {
  const inp = await readInput();
  const ctx = inp.context || {};

  if (!isAuthed(ctx)) {
    writeResponse(needSetupResponse());
    return;
  }

  let data;
  try {
    data = await api(ctx, "GET", "/me/player");
  } catch (e) {
    if (e.message === "not_authenticated") {
      writeResponse(needSetupResponse());
      return;
    }
    writeResponse(error("Spotify API error", e.message));
    return;
  }

  if (!data || !data.item) {
    const emptyHtml =
      '<div style="padding:24px;text-align:center;color:#9b9b9b">' +
      '<div style="font-size:42px;margin-bottom:8px">\u23F8</div>' +
      '<div style="font-size:14px;color:#d4d4d4;margin-bottom:4px">Nothing playing</div>' +
      '<div style="font-size:12px">Open Spotify and start a track, then run <code>sp</code> again.</div>' +
      '<div style="font-size:11px;margin-top:10px;color:#6e6e6e">' +
      'Tip: <code>sp play &lt;query&gt;</code> searches &amp; plays in one shot.' +
      '</div>' +
      '</div>';
    writeResponse(detail(emptyHtml));
    return;
  }

  const item = data.item;
  const durationMs = item.duration_ms || 0;
  const device = (data.device || {}).name || "";

  const metadata = [];
  if (durationMs) {
    metadata.push({ label: "Duration", value: fmtDurationMs(durationMs) });
  }
  if (device) {
    metadata.push({ label: "Device", value: device });
  }
  if (item.popularity != null) {
    metadata.push({ label: "Popularity", value: item.popularity + "/100" });
  }
  const extUrl = (item.external_urls || {}).spotify;
  if (extUrl) {
    metadata.push({ label: "Open in Spotify", value: extUrl });
  }

  const isPlaying = data.is_playing || false;

  let isLiked = false;
  const trackId = item.id;
  if (trackId) {
    try {
      const contains = await api(ctx, "GET", "/me/tracks/contains", null, { ids: trackId });
      isLiked = !!(contains && contains[0]);
    } catch (_) {
      // non-fatal
    }
  }

  writeResponse(
    detail(renderCard(item, data), metadata, buildActions(isPlaying, isLiked))
  );
}

main().catch(function (e) {
  writeResponse(error("now_playing crashed: " + e.message));
  process.exit(1);
});
