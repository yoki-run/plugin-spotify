#!/usr/bin/env node
"use strict";

/**
 * Spotify playlists — list mode.
 */

const {
  readInput,
  writeResponse,
  list,
  error,
  needSetupResponse,
  isAuthed,
  api,
} = require("./lib");

async function main() {
  const inp = await readInput();
  const ctx = inp.context || {};

  if (!isAuthed(ctx)) {
    writeResponse(needSetupResponse());
    return;
  }

  let data;
  try {
    data = await api(ctx, "GET", "/me/playlists", null, { limit: 50 });
  } catch (e) {
    if (e.message === "not_authenticated") {
      writeResponse(needSetupResponse());
      return;
    }
    writeResponse(error("Playlists failed", e.message));
    return;
  }

  const items = (data || {}).items || [];
  if (!items.length) {
    writeResponse(
      list([
        {
          id: "empty",
          title: "No playlists",
          subtitle: "Create one in Spotify and reload.",
          icon: "L",
        },
      ])
    );
    return;
  }

  const out = items.map(function (p) {
    const owner = (p.owner || {}).display_name || "";
    const tracks = (p.tracks || {}).total || 0;
    const subtitleParts = [];
    if (owner) subtitleParts.push("by " + owner);
    subtitleParts.push(tracks + " tracks");
    if (p.public === false) subtitleParts.push("private");

    return {
      id: p.uri || p.id || "",
      title: p.name || "Untitled",
      subtitle: subtitleParts.join("  \u00B7  "),
      icon: "L",
      actions: [
        {
          title: "Play",
          shortcut: "enter",
          type: "exec",
          exec: "playlists.js",
          args: ["play", p.uri || ""],
        },
        {
          title: "Open in Spotify",
          shortcut: "cmd+o",
          type: "open_url",
          url: (p.external_urls || {}).spotify || "",
        },
      ],
    };
  });

  writeResponse(list(out));
}

main().catch(function (e) {
  writeResponse(error("playlists crashed: " + e.message));
  process.exit(1);
});
