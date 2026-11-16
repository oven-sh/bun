import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
        return it.getBoundingClientRect().height * devicePixelRatio;
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

describe.skipIf(!hasLibrary).concurrent("web fonts", () => {
  const font = (type: string) =>
    readFileSync(
      join(import.meta.dir, "../../../../packages/bun-desktop/fixtures/space-mono-subset." + type),
      "base64",
    );
  const prelude = `
    const fonts = ${JSON.stringify(["ttf", "woff", "woff2"].map(font))}.map(it => Uint8Array.fromBase64(it));
    const draw = async (family, bytes) => {
      document.fonts.add(await new FontFace(family, bytes).load());
      const context = new OffscreenCanvas(400, 60).getContext("2d");
      context.font = "40px " + family;
      context.fillText("AÅÉabcéñ012.,", 0, 45);
      return context.getImageData(0, 0, 400, 60).data.join();
    };`;

  test("WOFF and WOFF2 have the glyphs of the original", async () => {
    const script = `${prelude}
      const [ttf, woff, woff2] = [await draw("a", fonts[0]), await draw("b", fonts[1]), await draw("c", fonts[2])];
      return [ttf.includes("255"), woff === ttf, woff2 === ttf];`;
    expect(await render("", script)).toEqual([[true, true, true]]);
  });

  test("a damaged font is refused or drawn", async () => {
    const script = `${prelude}
      const results = new Set();
      for (const [kind, font] of fonts.entries())
        for (let index = 0; index < font.length; index += 23)
          results.add(await draw("f" + kind + "x" + index, font.with(index, font[index] ^ 255)).then(() => "drawn", error => error.name));
      return [...results].sort();`;
    expect(await render("", script)).toEqual([["SyntaxError", "drawn"]]);
  });
});

describe.skipIf(!hasLibrary).concurrent("untrusted markup", () => {
  const times = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
  test.each([
    ["text with a transform-box", `<svg><text style="transform-box:fill-box;scale:2">a</text></svg>`],
    ["a group with a transform-box", `<svg><g style="transform-box:fill-box;rotate:1deg"><text>a</text></g></svg>`],
    ["a gradient without stops", `<img src="${svg(`style="background:-webkit-gradient(linear,0 0,0 9)">`)}">`],
    ["rules without a prelude", times("<style>{}</style>", 3) + `<img src="${svg("><style>{}</style>")}">`],
    [
      "a huge plane",
      `<b style="display:block;transform-style:preserve-3d;transform:rotate3d(1,2,3,40deg) scale(1e15)"></b>`,
    ],
    ["nested :is()", `<style>${times(":is(", 20000)}a${times(")", 20000)}{color:red}</style>`],
    ["nested :nth-child()", `<style>${times(":nth-child(n of ", 30)}a${times(")", 30)}{color:red}</style>`],
    ["a long selector", `<style>${times("*+", 40000)}p{color:red}</style>${times("<p hidden></p>", 40001)}`],
    ["a number system with one digit", `<ol style='list-style-type:symbols( numeric "a")'><li>x</ol>`],
    [
      "a shape far down",
      `<p style="font-size:1e9px">a <i style="shape-outside:circle();float:left;width:9px;height:9px"></i>b c`,
    ],
    ["an empty mpadded", times("<math><mpadded hidden=until-found>x</mpadded></math>", 3)],
    ["wide cells", `<table rules=all><tr>${times("<td colspan=1000>", 300)}${times("<tr>", 100)}</table>`],
    [
      "a clip path that clips itself",
      `<svg><clipPath id=c>${times("<rect clip-path=url(#c) />", 12)}</clipPath><rect width=99 height=99 clip-path=url(#c) /></svg>`,
    ],
    [
      "a huge blur",
      `<canvas></canvas><script>const it = document.querySelector("canvas").getContext("2d"); it.shadowBlur = 1e12; it.shadowColor = "red"; it.fillRect(0, 0, 9, 9)</script>`,
    ],
    [
      "frames that are larger than their image",
      `<img src="data:image/gif;base64,${btoa("GIF89a\x01\0\x01\0\0\0\0,\0\0\0\0\x01\0\x01\0\0\x02\0" + times(",\0\0\0\0A-A-\0\x02\0", 2000) + ";")}">`,
    ],
  ])("survives %s", async (_, html) => {
    const mark = `<div style="position:fixed;z-index:1;left:100px;top:50px;width:9px;height:9px;background:#0f0"></div>`;
    const script = `
      await Promise.allSettled(Array.from(document.images, it => it.decode()));
      document.elementFromPoint(5, 5);
      return document.querySelector("div").offsetWidth;`;
    expect(await render(mark + html, script, [[105, 55]])).toEqual([9, "00ff00"]);
  });

  test("feMorphology, and results that are used later", async () => {
    const html = `<svg width=200 height=100><filter id=f x=0 y=0 width=200 height=100 filterUnits=userSpaceOnUse color-interpolation-filters=sRGB>
      <feMorphology radius="7 3" operator=dilate result=wide /><feFlood flood-color=#00f /><feComposite in2=wide operator=in result=blue />
      ${times("<feOffset />", 50)}<feMorphology in=SourceGraphic radius=2 /><feMerge><feMergeNode in=blue /><feMergeNode /></feMerge>
    </filter><rect x=20 y=20 width=20 height=20 fill=#0f0 filter=url(#f) /></svg>`;
    const row = [12, 13, 21, 22, 37, 38, 46, 47].map(x => [x, 30]);
    const column = [16, 17, 42, 43].map(y => [30, y]);
    expect((await render(html, "", [...row, ...column])).join()).toBe(
      ",ffffff,0000ff,0000ff,00ff00,00ff00,0000ff,0000ff,ffffff,ffffff,0000ff,0000ff,ffffff",
    );
  });

  test("a font whose tables are larger than it says is refused", async () => {
    const script = `const count = 4000, view = new DataView(new ArrayBuffer(44 + count * 20 + 200000));
      view.setUint32(0, 0x774f4646), view.setUint32(4, 0x10000), view.setUint16(12, count);
      for (let i = 0; i < count; i++) view.setUint32(44 + i * 20, 0x61000000 + i), view.setUint32(52 + i * 20, view.byteLength);
      return new FontFace("a", "url(" + URL.createObjectURL(new Blob([view])) + ")").load().catch(it => it.name)`;
    expect(await render("", script)).toEqual(["NetworkError"]);
  });

  test("an attribute is one declaration", async () => {
    const values = ["url(#a);position:fixed", "a{}position:fixed", "url(#a) red;position:fixed", "red!important"];
    const script = `return ${JSON.stringify(values)}.map(value => {
      document.body.setHTML("<svg></svg>");
      document.body.firstChild.setAttribute("fill", value);
      const { position, fill } = getComputedStyle(document.body.firstChild);
      return position + " " + fill;
    })`;
    expect(await render("", script)).toEqual([values.map(() => "static rgb(0, 0, 0)")]);
    const table = `<table background="data:,a;b"></table><svg fill="url('a;b') red"></svg>`;
    const kept = `const of = it => getComputedStyle(document.querySelector(it));
      return [of("table").backgroundImage, of("svg").fill.endsWith('a;b") rgb(255, 0, 0)')]`;
    expect(await render(table, kept)).toEqual([['url("data:,a;b")', true]]);
  });

  test("XML is limited in depth and in what entities expand to", async () => {
    const script = `const fails = source => new DOMParser().parseFromString(source, "text/xml").querySelector("parsererror") !== null;
      const entities = count => "<!DOCTYPE a [<!ENTITY b '" + "x".repeat(9000) + "'>]><a>" + "&b;".repeat(count) + "</a>";
      const nested = count => "<a>".repeat(count) + "</a>".repeat(count);
      return [entities(10), entities(1000), nested(1000), nested(6000)].map(fails)`;
    expect(await render("", script)).toEqual([[false, true, false, true]]);
  });
});

function bmp(width: number, height: number, pixels: number[][]) {
  const bytes = Buffer.alloc(54 + width * height * 3);
  bytes.write("BM");
  [bytes.length, 0, 54, 40, width, height, 1 | (24 << 16)].forEach((it, i) => bytes.writeUInt32LE(it, 2 + i * 4));
  pixels.forEach(([r, g, b], i) => bytes.set([b, g, r], 54 + i * 3));
  return bytes;
}
