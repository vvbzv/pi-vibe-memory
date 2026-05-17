import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadVibeMemorySettingsFromFiles } from "./config.js";
import { COMMAND_NAMES, PACKAGE_NAME } from "./constants.js";

export default function piVibeMemory(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    try {
      await loadVibeMemorySettingsFromFiles([
        path.join(getAgentDir(), "settings.json"),
        path.join(ctx.cwd, ".pi", "settings.json"),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`${PACKAGE_NAME}: config error: ${message}`, "error");
    }
  });

  pi.registerCommand(COMMAND_NAMES.status, {
    description: "Show pi-vibe-memory status",
    async handler(_args, ctx) {
      ctx.ui.notify(`${PACKAGE_NAME}: package loaded`, "info");
    },
  });
}
