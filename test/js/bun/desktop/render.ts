import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { existsSync } from "node:fs";
import { openOn, readScreen } from "./screen";

export const hasGPU = isMacOS
  ? process.arch === "arm64"
  : isLinux &&
    ["/usr/lib64", "/usr/lib", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"].some(it =>
      existsSync(it + "/libEGL_mesa.so.0"),
    );

/** The thread of its cache has the lowest priority, and a process on a busy machine waits for it to end. */
const mesa = { MESA_SHADER_CACHE_DISABLE: "true", LP_NUM_THREADS: "2" };

/** What `script` returns, and the colors that the page then has at `points`. `main` runs in the app, before `script`. On a screen, what is drawn step by step has to end up like a picture that is painted at once. */
export async function renderTo(
  where: string,
  html: string,
  script: string,
  points: number[][] = [],
  zoom = 1,
  main = "",
  env = {},
) {
  await using screen = await openOn(where);
  using dir = tempDir("paint", {
    "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
    "index.html": "<!doctype html><style>body { margin: 0 }</style>" + html,
    "main.js": `
      const { app, BrowserWindow } = require("electron");
      app.setPath("userData", __dirname + "/data");
      if (!process.env.LCD_TEXT) app.commandLine.appendSwitch("disable-lcd-text");
      app.trustOrigins(["file:", "about:"], { injectedScripts: true, inFrames: true });
      ${readScreen}
      const until = async condition => {
        for (const end = Date.now() + 10_000; !(await condition()); await Bun.sleep(1)) if (Date.now() > end) throw new Error("gave up on " + condition);
      };
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 200, height: 100, useContentSize: true, ...(process.env.PLACE && { ...JSON.parse(process.env.PLACE), frame: false, roundedCorners: false }) });
        await window.loadFile("index.html");
        const page = window.webContents;
        page.setZoomFactor(${zoom});
        const shown = (x, y) => colorAt(window.getContentBounds().x + x, window.getContentBounds().y + y);
        const showsPage = async () => {
          const [painted, seen] = [(await page.capturePage()).toBitmap(), grab(window.getContentBounds())];
          return painted.filter((value, index) => index % 4 === 1 && !(Math.abs(value - seen[index]) <= 16)).length < painted.length / 400;
        };
        ${main}
        const result = await page.executeJavaScript(${JSON.stringify(`(async () => {${script}})()`)});
        if (process.env.SCREEN) await until(showsPage);
        const [colors, area] = [[], window.getContentBounds()];
        let picture;
        const inPicture = (x, y) => Buffer.from((picture ??= grab(area)).subarray((y * area.width + x) * 4).subarray(0, 3)).reverse();
        for (const [x, y] of ${JSON.stringify(points)}) {
          const [b, g, r] = (await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap();
          if (process.env.SCREEN) await until(() => inPicture(x, y).every((value, index) => Math.abs(value - [r, g, b][index]) <= 8) || (picture = undefined));
          // The window server of macOS converts colors.
          colors.push((process.env.SCREEN && process.env.SCREEN !== "macOS" ? inPicture(x, y) : Buffer.from([r, g, b])).toString("hex"));
        }
        console.log(JSON.stringify([result ?? null, ...colors]));
      }).then(() => app.exit(0), error => { console.error(error); app.exit(1); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", "."],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ...mesa, ...screen?.env, ...env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return JSON.parse(stdout);
}
