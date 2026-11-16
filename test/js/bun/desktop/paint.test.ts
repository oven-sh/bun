import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { hasLibrary } from "./library";

/** What `script` returns, and the colors that the page then has at `points`. */
async function render(html: string, script: string, points: number[][] = [], zoom = 1) {
  using dir = tempDir("paint", {
    "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
    "index.html": "<!doctype html><style>body { margin: 0 }</style>" + html,
    "main.js": `
      const { app, BrowserWindow } = require("electron");
      app.setPath("userData", __dirname + "/data");
      app.trustOrigins(["file:"], { injectedScripts: true });
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 200, height: 100, useContentSize: true });
        await window.loadFile("index.html");
        const page = window.webContents;
        page.setZoomFactor(${zoom});
        const result = await page.executeJavaScript(${JSON.stringify(`(async () => {${script}})()`)});
        const colors = [];
        for (const [x, y] of ${JSON.stringify(points)}) {
          const [b, g, r] = (await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap();
          colors.push(Buffer.from([r, g, b]).toString("hex"));
        }
        console.log(JSON.stringify([result ?? null, ...colors]));
        app.exit(0);
      });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", "."],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return JSON.parse(stdout);
}

const svg = (source: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${source}</svg>`)}`;

describe.skipIf(!hasLibrary).concurrent("paint", () => {
  test("a view transition moves the captured element and cleans up", async () => {
    const html = `<style>
      div { width: 20px; height: 20px; background: #0f0; view-transition-name: box; view-transition-class: moving }
      ::view-transition-group(.moving) { animation-timing-function: linear }
      :root:active-view-transition-type(slide)::view-transition-old(root) { animation: none }
    </style><div></div>`;
    const start = `
      const transition = document.startViewTransition({
        update: () => { document.querySelector("div").style.marginLeft = "100px"; document.body.style.background = "#00f" },
        types: ["slide"],
      });
      await transition.ready;
      const animations = document.getAnimations();`;
    expect(
      await render(
        html,
        `${start}
        for (const it of animations) it.pause(), it.currentTime = 125;
        return animations.map(it => it.effect.pseudoElement).sort().filter((it, index, all) => it !== all[index - 1]);`,
        [
          [60, 10],
          [110, 10],
        ],
      ).then(([parts, moving, left]) => [parts, moving, left === "00ff00"]),
    ).toEqual([
      ["group(box)", "group(root)", "new(box)", "new(root)", "old(box)"].map(it => "::view-transition-" + it),
      "00ff00",
      false,
    ]);
    expect(
      await render(
        html,
        `${start}
        for (const it of animations) it.finish();
        await transition.finished;
        return [document.activeViewTransition, document.getAnimations().length, document.documentElement.matches(":active-view-transition")];`,
        [
          [60, 10],
          [110, 10],
        ],
      ),
    ).toEqual([[null, 0, false], "0000ff", "00ff00"]);
  });

  test("two elements with one view-transition-name skip the transition", async () => {
    expect(
      await render(
        "<p style='view-transition-name: a'>x<p style='view-transition-name: a'>y",
        `let calls = 0;
        const transition = document.startViewTransition(() => void calls++);
        const error = await transition.ready.catch(it => it.name);
        await transition.finished;
        return [error, calls];`,
      ),
    ).toEqual([["InvalidStateError", 1]]);
  });

  test("an SVG image fills what it is sized to, and object-view-box crops it", async () => {
    const image = svg(
      `width="20" height="20"><path fill="#f00" d="M0 0h10v20H0z"/><path fill="#0f0" d="M10 0h10v20H10z"/>`,
    );
    expect(
      await render(
        `<img src="${image}" style="display: block; object-view-box: inset(0 0 0 10px)">
         <div style="width: 80px; height: 20px; background: url('${image}') 0 0 / 40px 20px"></div>`,
        `return document.images[0].getBoundingClientRect().width`,
        [
          [2, 10],
          [15, 30],
          [25, 30],
          [55, 30],
        ],
      ),
    ).toEqual([10, "00ff00", "ff0000", "00ff00", "ff0000"]);
  });

  test("the shades of a black inset border", async () => {
    expect(
      await render(`<div style="width: 20px; height: 20px; border: 10px inset #000"></div>`, "", [
        [20, 5],
        [20, 35],
      ]),
    ).toEqual([null, "545454", "a8a8a8"]);
  });

  test("a dash array that is separated by spaces", async () => {
    expect(
      await render(
        `<svg width=100 height=10 style="display: block"><path d="M0 5h100" stroke="#00f" stroke-width=10 style="stroke-dasharray: 20 30"/></svg>`,
        "",
        [
          [10, 5],
          [30, 5],
        ],
      ),
    ).toEqual([null, "0000ff", "ffffff"]);
  });

  test("a control looks native until it is styled", async () => {
    expect(
      await render(
        `<input type=checkbox checked style="display: block; margin: 0; width: 20px; height: 20px; accent-color: #008000">
         <button style="display: block; width: 40px; height: 20px"></button>
         <button style="display: block; width: 40px; height: 20px; background: #f00"></button>`,
        "",
        [
          [3, 3],
          [20, 30],
          [20, 50],
        ],
      ),
    ).toEqual([null, "008000", "efefef", "ff0000"]);
  });

  test("normal line heights are rounded to device pixels", async () => {
    const [heights] = await render(
      "",
      `return Array.from({ length: 12 }, (_, index) => {
        const it = document.body.appendChild(document.createElement("div"));
        it.style.font = 10 + index + "px sans-serif";
        it.textContent = "x";
        return it.getBoundingClientRect().height * 2;
      })`,
      [],
      2,
    );
    expect(heights.every(Number.isInteger)).toBe(true);
    expect(heights.some((it: number) => it % 2 === 1)).toBe(true);
  });
});

test.skipIf(!hasLibrary)("a large inline image is complete at once, and is averaged down", async () => {
  const noise = Array.from({ length: 600 * 600 }, (_, i) =>
    i % 600 < 300 ? [255, (i * i * 7919) % 11, 0] : [0, (i * i * 7919) % 11, 255],
  );
  const png = await new Bun.Image(bmp(600, 600, noise)).png().bytes();
  const src = `data:image/png;base64,${png.toBase64()}`;
  const script = `const it = new Image(60, 60); it.loading = "lazy"; it.src = "${src}"; document.body.append(it); return [it.complete, it.naturalWidth];`;
  const [state, left, right] = await render("<body>", script, [
    [10, 10],
    [50, 50],
  ]);
  expect(state).toEqual([true, 600]);
  expect([left.slice(0, 2), left.slice(4, 6), right.slice(0, 2), right.slice(4, 6)]).toEqual(["ff", "00", "00", "ff"]);
});

function bmp(width: number, height: number, pixels: number[][]) {
  const bytes = Buffer.alloc(54 + width * height * 3);
  bytes.write("BM");
  [bytes.length, 0, 54, 40, width, height, 1 | (24 << 16)].forEach((it, i) => bytes.writeUInt32LE(it, 2 + i * 4));
  pixels.forEach(([r, g, b], i) => bytes.set([b, g, r], 54 + i * 3));
  return bytes;
}
