import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const name =
  process.platform === "win32" ? "bun_desktop.dll" : `libbun_desktop.${process.platform === "darwin" ? "dylib" : "so"}`;

/** `bun run build:desktop` makes it. Without it Bun would download one. */
export const hasLibrary = !!process.env.BUN_DESKTOP_LIBRARY || existsSync(join(dirname(process.execPath), name));

process.env.BUN_DESKTOP_HEADLESS = "1";
