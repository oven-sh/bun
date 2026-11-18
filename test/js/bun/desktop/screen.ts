import { isArm64, isLinux, isMacOS, isWindows, tempDir } from "harness";
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
const names = isWindows ? ["GDI", "DirectComposition"] : isMacOS && isArm64 ? ["macOS"] : [];
export const ownScreen = hasLibrary && process.env.BUN_DESKTOP_TEST_SCREEN ? names : [];
const freePlaces = isWindows
  ? [0, 1, 2, 3, 5, 6, 7, 8].map(index => ({
      x: 10 + (index % 3) * 350,
      y: 10 + Math.floor(index / 3) * 250,
      alwaysOnTop: true,
    }))
  : Array.from({ length: 16 }, (_, index) => ({ x: 20 + (index % 4) * 240, y: 50 + (index >> 2) * 160 }));
const waiting: (() => void)[] = [];

export async function openOn(where: string) {
  if (names.includes(where)) {
    while (!freePlaces.length) await new Promise<void>(resolve => waiting.push(resolve));
    const place = freePlaces.shift()!;
    const renderer = { GDI: "software", DirectComposition: "gpu" }[where];
    const env = {
      BUN_DESKTOP_HEADLESS: "0",
      BUN_DESKTOP_RENDERER: renderer,
      SCREEN: where,
      PLACE: JSON.stringify(place),
    };
    return { env, [Symbol.asyncDispose]: async () => (freePlaces.push(place), waiting.shift()?.()) };
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
  const gdi = process.platform === "win32" && process.env.SCREEN && {
    ...require("bun:ffi").dlopen("user32.dll", { GetDC: { args: ["i64"], returns: "i64" } }).symbols,
    ...require("bun:ffi").dlopen("dwmapi.dll", { DwmSetWindowAttribute: { args: ["i64", "u32", "ptr", "u32"], returns: "i32" } }).symbols,
    ...require("bun:ffi").dlopen("gdi32.dll", {
      CreateCompatibleDC: { args: ["i64"], returns: "i64" },
      CreateBitmap: { args: ["i32", "i32", "u32", "u32", "i64"], returns: "i64" },
      SelectObject: { args: ["i64", "i64"], returns: "i64" },
      BitBlt: { args: ["i64", "i32", "i32", "i32", "i32", "i64", "i32", "i32", "u32"], returns: "i32" },
      GetBitmapBits: { args: ["i64", "i32", "ptr"], returns: "i32" },
      DeleteObject: { args: ["i64"], returns: "i32" },
    }).symbols,
  };
  const [display, copy] = gdi ? [gdi.GetDC(0), gdi.CreateCompatibleDC(0)] : [];
  // The system draws a border over the first row.
  if (gdi) require("electron").app.on("browser-window-created", (_, it) => gdi.DwmSetWindowAttribute(it.getNativeWindowHandle().readBigInt64LE(), 34, new Int32Array([-2]), 4));
  const grab = ({ x, y, width, height }) => {
    if (gdi) {
      const [pixels, bitmap] = [Buffer.alloc(width * height * 4), gdi.CreateBitmap(width, height, 1, 32, 0)];
      const before = gdi.SelectObject(copy, bitmap);
      gdi.BitBlt(copy, 0, 0, width, height, display, x, y, 0xcc0020);
      gdi.SelectObject(copy, before), gdi.GetBitmapBits(bitmap, pixels.length, pixels), gdi.DeleteObject(bitmap);
      return pixels;
    }
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
