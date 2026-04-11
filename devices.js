#!/usr/bin/env node
"use strict";

/**
 * Spotify devices — list mode.
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
    data = await api(ctx, "GET", "/me/player/devices");
  } catch (e) {
    if (e.message === "not_authenticated") {
      writeResponse(needSetupResponse());
      return;
    }
    writeResponse(error("Devices failed", e.message));
    return;
  }

  const devices = (data || {}).devices || [];
  if (!devices.length) {
    writeResponse(
      list([
        {
          id: "none",
          title: "No devices available",
          subtitle: "Open Spotify on a phone, computer, or speaker first.",
          icon: "X",
        },
      ])
    );
    return;
  }

  const out = devices.map(function (d) {
    const active = d.is_active ? "  \u00B7  active" : "";
    const vol = d.volume_percent;
    const volStr = vol != null ? "  \u00B7  vol " + vol + "%" : "";
    return {
      id: d.id || "",
      title: d.name || "Unknown",
      subtitle: ((d.type || "") + active + volStr).trim(),
      icon: "D",
      actions: [
        {
          title: "Transfer playback here",
          shortcut: "enter",
          type: "exec",
          exec: "devices.js",
          args: ["transfer", d.id || ""],
        },
      ],
    };
  });

  writeResponse(list(out));
}

main().catch(function (e) {
  writeResponse(error("devices crashed: " + e.message));
  process.exit(1);
});
