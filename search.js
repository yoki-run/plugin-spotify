#!/usr/bin/env node
"use strict";

/**
 * Spotify search — list mode.
 */

const {
  readInput,
  writeResponse,
  list,
  error,
  needSetupResponse,
  isAuthed,
  api,
  stripKeyword,
  fmtArtists,
  fmtDurationMs,
} = require("./lib");

async function main() {
  const inp = await readInput();
  const ctx = inp.context || {};
  const query = stripKeyword(inp.query || "", "search", "find", "s");

  if (!query) {
    writeResponse(
      list([
        {
          id: "hint",
          title: "Type something to search Spotify",
          subtitle: "e.g.  sp search dua lipa",
          icon: "?",
        },
      ])
    );
    return;
  }

  if (!isAuthed(ctx)) {
    writeResponse(needSetupResponse());
    return;
  }

  let res;
  try {
    res = await api(ctx, "GET", "/search", null, { q: query, type: "track", limit: 15 });
  } catch (e) {
    if (e.message === "not_authenticated") {
      writeResponse(needSetupResponse());
      return;
    }
    writeResponse(error("Search failed", e.message));
    return;
  }

  const items = ((res || {}).tracks || {}).items || [];
  if (!items.length) {
    writeResponse(
      list([
        {
          id: "empty",
          title: "No results for: " + query,
          subtitle: "Try a different query",
          icon: "?",
        },
      ])
    );
    return;
  }

  const out = items.map(function (t) {
    const artists = fmtArtists(t.artists);
    const album = (t.album || {}).name || "";
    const dur = fmtDurationMs(t.duration_ms);
    const subtitleParts = [artists];
    if (album) subtitleParts.push(album);
    if (dur) subtitleParts.push(dur);

    return {
      id: t.uri || t.id || "",
      title: t.name || "Unknown",
      subtitle: subtitleParts.filter(Boolean).join("  \u00B7  "),
      icon: "M",
      actions: [
        {
          title: "Play",
          shortcut: "enter",
          type: "exec",
          exec: "playback.js",
          args: ["play", t.uri || ""],
        },
        {
          title: "Open in Spotify",
          shortcut: "cmd+o",
          type: "open_url",
          url: (t.external_urls || {}).spotify || "",
        },
      ],
    };
  });

  writeResponse(list(out));
}

main().catch(function (e) {
  writeResponse(error("search crashed: " + e.message));
  process.exit(1);
});
