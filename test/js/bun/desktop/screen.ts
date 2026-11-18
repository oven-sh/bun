import { isArm64, isLinux, isMacOS, tempDir } from "harness";
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

/** There is only the one that somebody may be looking at. */
export const ownScreen = hasLibrary && isMacOS && isArm64 && process.env.BUN_DESKTOP_TEST_SCREEN ? ["macOS"] : [];
const freePlaces = Array.from({ length: 16 }, (_, index) => ({
  x: 20 + (index % 4) * 240,
  y: 50 + (index >> 2) * 160,
}));

export async function openOn(where: string) {
  if (where === "macOS") {
    const place = freePlaces.shift()!;
    const env = { BUN_DESKTOP_HEADLESS: "0", SCREEN: where, PLACE: JSON.stringify(place) };
    return { env, [Symbol.asyncDispose]: async () => void freePlaces.push(place) };
  }
  if (where !== "Wayland") return where === "X11" ? openScreen() : null;
  const compositor = openCompositor();
  return { env: compositor.env, [Symbol.asyncDispose]: async () => compositor[Symbol.dispose]() };
}

/** For that app: `grab({ x, y, width, height })` returns the BGRX pixels of the display, `colorAt(x, y)` one as `rrggbb`. */
export const readScreen = `
  const windowServer = process.env.SCREEN === "macOS" && require("bun:ffi").dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", {
    CGWindowListCreateImage: { args: ["f64", "f64", "f64", "f64", "u32", "u32", "u32"], returns: "ptr" },
    CGImageGetColorSpace: { args: ["ptr"], returns: "ptr" },
    CGBitmapContextCreate: { args: ["ptr", "u64", "u64", "u64", "u64", "ptr", "u32"], returns: "ptr" },
    CGContextDrawImage: { args: ["ptr", "f64", "f64", "f64", "f64", "ptr"] },
    CFRelease: { args: ["ptr"] },
  }).symbols;
  const grab = ({ x, y, width, height }) => {
    if (windowServer) {
      const number = +require("electron").BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1];
      const [pixels, image] = [Buffer.alloc(width * height * 4), windowServer.CGWindowListCreateImage(x, y, width, height, 8, number, 17)];
      if (!image) return pixels;
      const context = windowServer.CGBitmapContextCreate(pixels, width, height, 8, width * 4, windowServer.CGImageGetColorSpace(image), 0x2006);
      windowServer.CGContextDrawImage(context, 0, 0, width, height, image);
      [context, image].forEach(it => windowServer.CFRelease(it));
      return pixels;
    }
    const all = require("fs").readFileSync(process.env.SCREEN);
    const [start, stride] = [all.readUInt32BE(0) + all.readUInt32BE(76) * 12, all.readUInt32BE(48)];
    const row = index => all.subarray(start + (y + index) * stride + x * 4).subarray(0, width * 4);
    return Buffer.concat(Array.from({ length: height }, (_, index) => row(index)));
  };
  const colorAt = (x, y) => Buffer.from(grab({ x, y, width: 1, height: 1 }).subarray(0, 3)).reverse().toString("hex");
`;
