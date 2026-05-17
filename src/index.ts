import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMAND_NAMES, PACKAGE_NAME } from "./constants.js";

export default function piVibeMemory(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAMES.status, {
    description: "Show pi-vibe-memory status",
    async handler(_args, ctx) {
      ctx.ui.notify(`${PACKAGE_NAME}: package loaded`, "info");
    },
  });
}
