import { isLinux, tempDir } from "harness";
import { join } from "node:path";
import { hasWayland, openCompositor } from "./compositor";
import { hasLibrary } from "./library";

export const hasScreen = hasLibrary && isLinux && !!Bun.which("Xvfb");

/** A display for one app, with the environment that makes it open real windows there. */
export async function openScreen() {
  const dir = tempDir("screen", {});
  const server = Bun.spawn({
    cmd: [
      "Xvfb",
      "-displayfd",
      "1",
      "-screen",
      "0",
      "500x400x24",
      "-fbdir",
      String(dir),
      "-nolisten",
      "tcp",
      "-nocursor",
    ],
    stderr: "ignore",
  });
  const { value } = await server.stdout.getReader().read();
  return {
    env: {
      BUN_DESKTOP_HEADLESS: "0",
      DISPLAY: ":" + new TextDecoder().decode(value).trim(),
      WAYLAND_DISPLAY: undefined,
      SCREEN: join(String(dir), "Xvfb_screen0"),
    },
    async [Symbol.asyncDispose]() {
      server.kill();
      await server.exited;
      dir[Symbol.dispose]();
    },
  };
}

export const screens = [...(hasScreen ? ["X11"] : []), ...(hasWayland ? ["Wayland"] : [])];

export async function openOn(where: string) {
  if (where !== "Wayland") return where === "X11" ? openScreen() : null;
  const compositor = openCompositor();
  return { env: compositor.env, [Symbol.asyncDispose]: async () => compositor[Symbol.dispose]() };
}

/** For that app: `grab({ x, y, width, height })` returns the BGRX pixels of the display, `colorAt(x, y)` one as `rrggbb`. */
export const readScreen = `
  const grab = ({ x, y, width, height }) => {
    const all = require("fs").readFileSync(process.env.SCREEN);
    const [start, stride] = [all.readUInt32BE(0) + all.readUInt32BE(76) * 12, all.readUInt32BE(48)];
    const row = index => all.subarray(start + (y + index) * stride + x * 4).subarray(0, width * 4);
    return Buffer.concat(Array.from({ length: height }, (_, index) => row(index)));
  };
  const colorAt = (x, y) => Buffer.from(grab({ x, y, width: 1, height: 1 }).subarray(0, 3)).reverse().toString("hex");
`;
