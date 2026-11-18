import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, libcPathForDlopen, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { hasLibrary } from "./library";
import { openOn, readScreen, screens } from "./screen";

/** What `script` returns, and the colors that the page then has at `points`. */
const render = renderTo.bind(null, "memory");

/** `main` runs in the app, before `script`. On a screen, what is drawn step by step has to end up like a picture that is painted at once. */
async function renderTo(
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
      app.trustOrigins(["file:", "about:"], { injectedScripts: true, inFrames: true });
      ${readScreen}
      const until = async condition => {
        for (const end = Date.now() + 10_000; !(await condition()); await Bun.sleep(1)) if (Date.now() > end) throw new Error("gave up on " + condition);
      };
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 200, height: 100, useContentSize: true });
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
        const colors = [];
        for (const [x, y] of ${JSON.stringify(points)}) {
          const [b, g, r] = (await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap();
          if (process.env.SCREEN) await until(() => Buffer.from(shown(x, y), "hex").every((value, index) => Math.abs(value - [r, g, b][index]) <= 8));
          colors.push(process.env.SCREEN ? shown(x, y) : Buffer.from([r, g, b]).toString("hex"));
        }
        console.log(JSON.stringify([result ?? null, ...colors]));
      }).then(() => app.exit(0), error => { console.error(error); app.exit(1); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", "."],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ...screen?.env, ...env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return JSON.parse(stdout);
}

const svg = (source: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${source}</svg>`)}`;

describe.skipIf(!hasLibrary).concurrent.each(["memory", ...screens])("paint to %s", where => {
  const render = renderTo.bind(null, where);

  test("colors change wherever they are used", async () => {
    const html = `<style>
      main { display: flex; color: var(--c) } main > * { width: 20px; height: 20px; flex: none; box-sizing: border-box }
      p { margin: 0; font: 900 70px/70px sans-serif; color: var(--c) } .old { --c: #f00; --o: .2 } .new { --c: #00f; --o: .6 }
    </style><body class=old><main>
      <div style="background: var(--c)"></div>
      <div style="border: 10px solid"></div>
      <div style="background: linear-gradient(var(--c), var(--c)); transform: translateX(0.5px) scale(1.01)"></div>
      <div style="box-shadow: inset 0 0 0 20px var(--c)"></div>
      <div style="outline: 10px solid; outline-offset: -10px"></div>
      <svg><rect width=20 height=20 fill=currentColor /></svg>
      <svg><linearGradient id=g><stop stop-color=currentColor /></linearGradient><rect width=20 height=20 fill=url(#g) /></svg>
      <svg><rect width=20 height=20 fill=url(#g) /></svg>
      <div style="background: #000; opacity: var(--o)"></div>
    </main><p>HHH</p>`;
    const script = `
      const frame = () => new Promise(requestAnimationFrame);
      await frame(); await frame();
      document.body.className = "new";
      await frame(); await frame();`;
    const [, ...colors] = await render(html, script, [
      ...Array.from({ length: 9 }, (_, i) => [i * 20 + 10, 10]),
      ...Array.from({ length: 30 }, (_, i) => [i * 2, 45]),
    ]);
    expect(colors.slice(0, 9)).toEqual([...Array(8).fill("0000ff"), "666666"]);
    expect([colors.slice(9).includes("0000ff"), colors.slice(9).includes("ff0000")]).toEqual([true, false]);
  });

  test("colors change in tables", async () => {
    const html = `<style>table { float: left; border-spacing: 0; font: 900 40px/40px monospace } td, caption { padding: 0 }</style>
      <div id=all style="color: #f00; transform: translate(0px, 0px)">
        <table><tr><td>H</td></tr></table>
        <table><caption>H</caption></table>
        <div style="display: table; float: left; font: 900 40px/40px monospace">H</div>
        <table style="border-collapse: collapse"><tr style="border-top: 40px solid"><td style="width: 20px"></td></tr></table>
        <table style="background: currentcolor"><tr><td style="width: 20px; height: 40px"></td></tr></table>
        <table><tr style="background: currentcolor"><td style="width: 20px; height: 40px"></td></tr></table>
      </div>`;
    const script = `
      const frame = () => new Promise(requestAnimationFrame);
      for (const [color, y] of [["rgb(255, 0, 255)", 10], ["#0f0", 20], ["hsl(240, 100%, 50%)", 30]]) {
        await frame(); await frame();
        all.style.color = color;
        all.style.transform = "translate(0px, " + y + "px)";
      }
      await frame(); await frame();
      return [...all.children].map(it => Math.round(it.getBoundingClientRect().left));`;
    const [lefts, ...row] = await render(
      html,
      script,
      Array.from({ length: 70 }, (_, i) => [i * 2, 48]),
    );
    const colored = lefts.map((left: number) =>
      [...new Set(row.slice(left / 2 + 1, left / 2 + 10))].filter(
        it => /^(00|ff){3}$/.test(it as string) && it !== "ffffff",
      ),
    );
    expect(colored).toEqual(Array(6).fill(["0000ff"]));
  });

  test.each([
    ["by itself", `<rect id=a width=10 height=10 fill=url(#g) />`, "0000ff", "ffffff"],
    [
      "with what is in it",
      `<g id=a><g transform="scale(2)"><rect width=5 height=5 fill=#00f /></g></g>`,
      "0000ff",
      "ffffff",
    ],
    ["with a clip", `<rect id=a width=99 height=99 fill=#00f clip-path=url(#c) />`, "0000ff", "ffffff"],
    ["with its copies", `<rect id=a width=10 height=10 fill=#00f /><use href=#a y=20 />`, "0000ff", "0000ff"],
    [
      "in what has copies",
      `<g id=b><rect id=a width=10 height=10 fill=#00f /></g><use href=#b y=20 />`,
      "0000ff",
      "0000ff",
    ],
    [
      "in a clip",
      `<clipPath id=d><rect id=a width=10 height=10 /></clipPath><rect width=99 height=99 fill=#00f clip-path=url(#d) />`,
      "0000ff",
      "ffffff",
    ],
    ["in a group with a filter", `<g filter=url(#f)><rect id=a width=10 height=10 /></g>`, "0000ff", "ffffff"],
    [
      "twice if that is inherited",
      `<g id=a><rect y=-40 x=-60 width=10 height=10 fill=#00f style="transform: inherit" /></g>`,
      "0000ff",
      "ffffff",
    ],
    [
      "around its own box",
      `<rect id=a width=10 height=10 fill=#00f style="transform-box: fill-box; transform-origin: center" />`,
      "0000ff",
      "ffffff",
    ],
    [
      "unless a rule says otherwise",
      `<rect id=a width=10 height=10 fill=#00f style="transform: translate(60px, 60px)" />`,
      "ffffff",
      "0000ff",
    ],
    [
      "and fades",
      `<g id=a opacity=.2><rect width=10 height=10 fill=#00f /><rect width=10 height=10 fill=#00f /></g>`,
      "ccccff",
      "ffffff",
    ],
    [
      "and keeps the width of its stroke",
      `<path id=a d="M0 5H10" stroke=#00f stroke-width=10 vector-effect=non-scaling-stroke />`,
      "0000ff",
      "ffffff",
    ],
  ])("an SVG element moves %s", async (_, markup, ...expected) => {
    const html = `<svg style="display: block" width=200 height=100>
      <linearGradient id=g><stop stop-color=#00f /><stop offset=1 stop-color=#00f /></linearGradient><clipPath id=c><rect width=10 height=10 /></clipPath>
      <filter id=f x=0 y=0 width=1 height=1><feFlood flood-color=#00f /></filter>
      ${"<rect x=190 width=1 height=1 />".repeat(40)}${markup}</svg>`;
    const script = `
      for (const value of ["translate(1 1)", "translate(2 2)", "", "translate(3 3) scale(0)", "translate(9 9) scale(3)", "translate(20 20)", "nonsense", "translate(30 30)", "translate(60 40)"]) {
        a.setAttribute("transform", value);
        await new Promise(requestAnimationFrame);
      }
      a.setAttribute("class", "other");
      await new Promise(requestAnimationFrame);
      return a.transform.baseVal[0].matrix.e;`;
    expect(
      await render(html, script, [
        [35, 35],
        [65, 45],
        [65, 65],
      ]),
    ).toEqual([60, "ffffff", ...expected]);
  });

  test.each([
    ["a background", "background: #00f"],
    ["a gradient", "background: linear-gradient(#00f, #00f)"],
    ["a border", "border: 60px solid #00f"],
    ["a border of two colors", "border: 60px solid #00f; border-right-color: #00e"],
    ["a shadow", "top: -400px; box-shadow: 0 400px #00f"],
    ["an inner shadow", "box-shadow: inset 0 0 0 60px #00f"],
    ["an outline", "outline: 60px solid #00f; outline-offset: -60px"],
    ["a clip", "overflow: hidden; --inside: #00f"],
    ["a backdrop", "backdrop-filter: invert(1) drop-shadow(0 0) url(#blue)"],
    ["what is turned", "background: #00f; rotate: 180deg"],
    ["what is translucent", "background: #00f; opacity: .99"],
  ])("-electron-corner-smoothing shapes %s", async (_, declarations) => {
    const html = `<svg width=0 height=0 style="position: absolute"><filter id=blue><feFlood flood-color=#00f /></filter></svg>
      <style>p { position: absolute; top: 0; margin: 0; box-sizing: border-box; width: 400px; height: 300px; border-radius: 50px; ${declarations} } i { display: block; height: 100%; background: var(--inside) }</style>
      <p id=a><i></i></p>`;
    const script = `
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      a.style.setProperty("-electron-corner-smoothing", "100%");`;
    const isBlue = (it: string) => parseInt(it.slice(0, 2), 16) < 0x20;
    const [, ...colors] = await render(html, script, [
      [47, 0],
      [0, 47],
      [12, 12],
      [120, 0],
      [47, 3],
      [3, 47],
      [18, 18],
    ]);
    expect(colors.map(isBlue)).toEqual([false, false, false, true, true, true, true]);
  });

  test("an empty box shows, hides and can be hit among many others", async () => {
    const html = `<style>i { position: absolute; top: 0; width: 20px; height: 20px; background: #00f; visibility: hidden }</style>
      <div>${"<i></i>".repeat(40)}<i id=a style="left: 20px"></i><i id=b style="left: 40px; visibility: visible"></i><i id=c style="left: 60px; rotate: 45deg"></i></div>`;
    const script = `
      const frame = () => new Promise(requestAnimationFrame);
      await frame(); await frame();
      c.style.background = "#0f0";
      await frame(); await frame();
      a.style.visibility = c.style.visibility = "visible";
      b.style.visibility = "hidden";
      await frame(); await frame();
      a.after(Object.assign(document.createElement("p"), { style: "margin: 40px 0 0; height: 20px; background: #000" }));
      await frame(); await frame();
      return [10, 30, 50, 70].map(x => document.elementFromPoint(x, 10).id);`;
    expect(
      await render(html, script, [
        [10, 10],
        [30, 10],
        [50, 10],
        [70, 10],
        [10, 50],
      ]),
    ).toEqual([["", "a", "", "c"], "ffffff", "0000ff", "ffffff", "00ff00", "000000"]);
  });

  test("hundreds of small things turn, each in its place", async () => {
    const html = `<style>html { overflow: hidden } i, img { position: absolute; width: 8px; height: 8px } i { border-top-left-radius: 50% }</style><div id=all></div>`;
    const script = `
      const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
      canvas.getContext("2d").fillRect(0, 0, 32, 32);
      for (let i = 0; i < 200; i++) {
        const it = all.appendChild(i % 5 ? document.createElement("i") : Object.assign(new Image(), { src: canvas.toDataURL() }));
        it.style.cssText = "left: " + (i % 20 * 10 + 1) + "px; top: " + ((i / 20 | 0) * 10 + 1) + "px; opacity: .3";
      }
      await Promise.all([...document.images].map(it => it.decode()));
      for (let step = 1; step <= 4; step++) {
        [...all.children].forEach((it, i) => {
          it.style.transform = "translate(0px, 0px)rotateZ(" + (step + i / 7) + "rad)";
          it.style.backgroundColor = it.src ? "" : "hsla(" + (step * 60) + ",100%,50%,1)";
          it.style.opacity = step / 5;
        });
        await new Promise(requestAnimationFrame);
      }`;
    expect(
      await render(html, script, [
        [5, 5],
        [15, 5],
        [195, 95],
        [155, 55],
      ]),
    ).toEqual([null, "333333", "3333ff", "3333ff", "333333"]);
  });

  test.each([
    ["by itself", "", ["0000ff", "ffffff", "ff0000", "00ff00"]],
    ["with round corners", "border-radius: 30px", ["ffffff", "ffffff", "ff0000", "00ff00"]],
    ["that is translucent", "opacity: .2", ["ccccff", "ffffff", "ffcccc", "ccffcc"]],
    ["that is turned", "rotate: 180deg", ["ff0000", "ffffff", "0000ff", "00ff00"]],
    ["that is filtered", "filter: invert(1)", ["ffff00", "ffffff", "00ffff", "ff00ff"]],
  ])("a frame %s shows what changes in it", async (_, declarations, expected) => {
    const html = `<iframe id=outer style="display: block; border: 0; margin: 10px; width: 80px; height: 80px; ${declarations}"
      srcdoc="<body style='margin: 0; background: #000'><iframe style='position: absolute; inset: 30px; width: 20px; height: 20px; border: 0' srcdoc='<body>'></iframe>"></iframe>`;
    const script = `
      const frame = () => new Promise(requestAnimationFrame);
      await frame(); await frame();
      outer.contentDocument.documentElement.style.cssText = "height: 100%; background: linear-gradient(#00f 50%, #f00 50%)";
      outer.contentDocument.body.style.background = "none";
      await frame(); await frame();
      outer.contentWindow[0].document.body.style.background = "#0f0";
      await frame(); await frame();`;
    expect(
      await render(html, script, [
        [12, 12],
        [95, 50],
        [30, 70],
        [50, 50],
      ]),
    ).toEqual([null, ...expected]);
  });

  test("what is in a frame does not blend with what is behind the frame", async () => {
    const html = `<body style="background: #f00"><iframe style="display: block; border: 0; width: 80px; height: 80px"
      srcdoc="<body style='margin: 0'><p style='margin: 0; height: 40px; background: #0f0; mix-blend-mode: multiply'></p><p style='margin: 0; height: 40px; backdrop-filter: invert(1)'>"></iframe>`;
    expect(
      await render(html, "", [
        [20, 20],
        [20, 60],
      ]),
    ).toEqual([null, "00ff00", "ff0000"]);
  });

  test.each([
    ["is moved", "position: relative; top: -19980px"],
    ["is transformed", "transform: translateY(-19980px)"],
    ["is pulled up", "margin-top: -19980px"],
    ["is positioned", "position: absolute; top: 0; width: 20px"],
    ["casts a shadow", "box-shadow: 0 -19980px #00f"],
    ["has something that sticks out", "--top: -19980px"],
  ])("the far end of a long list comes into sight when it %s", async (_, declarations) => {
    for (const around of ["", "height: 100px; overflow: hidden", "position: relative"]) {
      const html = `<style>p { margin: 0; height: 20px } p:last-child { background: #00f } i { display: block; height: 20px; background: #00f; position: relative; top: var(--top) }</style>
        <div style="${around}">${"<p></p>".repeat(999)}<p id=last><i></i></p></div>`;
      const script = `
        const frame = () => new Promise(requestAnimationFrame);
        await frame(); await frame();
        const before = document.elementFromPoint(10, 10) === document.querySelector("p");
        last.style.cssText = ${JSON.stringify(declarations)};
        await frame(); await frame();
        return before;`;
      expect(
        await render(html, script, [
          [10, 10],
          [10, 30],
        ]),
      ).toEqual([true, "0000ff", "ffffff"]);
    }
  });

  test("a long list is painted wherever it is scrolled to", async () => {
    const html = `<style>p { margin: 0; height: 20px } p:nth-child(2n) { background: #0f0; position: relative } p:nth-child(701) { background: #00f; position: sticky; top: 0 }</style>
      <div id=list style="height: 100px; overflow: hidden">${"<p></p>".repeat(1000)}</div>`;
    const script = (top: number) =>
      `await new Promise(requestAnimationFrame); list.scrollTop = ${top}; await new Promise(requestAnimationFrame);`;
    expect(
      await render(html, script(10000), [
        [10, 10],
        [10, 30],
      ]),
    ).toEqual([null, "ffffff", "00ff00"]);
    expect(
      await render(html, script(18000), [
        [10, 10],
        [10, 30],
      ]),
    ).toEqual([null, "0000ff", "00ff00"]);
  });

  test("the controls of media are drawn, whatever the policy says about styles", async () => {
    const html = `<meta http-equiv=Content-Security-Policy content="style-src 'nonce-a'">
      <style nonce=a>body { margin: 0 } audio, video { display: block; width: 200px; height: 50px } video { background: #00f }</style>
      <audio id=a controls></audio><video id=v></video>`;
    const script = `
      const reports = [];
      addEventListener("securitypolicyviolation", event => reports.push(event.violatedDirective));
      v.controls = true;
      await new Promise(requestAnimationFrame);
      return [reports, a.shadowRoot, a.childNodes.length, document.elementFromPoint(26, 25).id];`;
    const icon = (x: number, y: number) => [
      [x + 11, y + 12],
      [x + 21, y + 2],
    ];
    expect(await render(html, script, [[100, 4], ...icon(16, 13), icon(12, 68)[0]])).toEqual([
      [[], null, 0, "a"],
      "f1f3f4",
      "000000",
      "f1f3f4",
      "ffffff",
    ]);
  });

  test("a background does not shine through the edge of a round border", async () => {
    const html = `<style>div { float: left; box-sizing: border-box; width: 40px; height: 40px; margin: 5px; border-radius: 50% }</style>
      <div style="background: #f00; border: 1px solid #000"></div>
      <div style="background: #f00; border: 4px solid; border-color: #000 #000 #001"></div>
      <div style="background: linear-gradient(#f00, #f00); border: 4px solid #000"></div>
      <div style="background: url('${svg('><rect width="99" height="99" fill="red"/>')}'); border: 4px solid #000"></div>`;
    const [, ...colors] = await render(
      html,
      "",
      [0, 50, 100, 150].flatMap(x => [
        [x + 8, 13],
        [x + 25, 25],
      ]),
    );
    const isGray = (it: string) => Math.abs(parseInt(it.slice(0, 2), 16) - parseInt(it.slice(2, 4), 16)) < 12;
    expect(colors.map((it, index) => (index % 2 ? it : isGray(it)))).toEqual(Array(4).fill([true, "ff0000"]).flat());
  });

  test.each(["", "position: relative", "isolation: isolate"])(
    "a resizer is above the layers in a box with '%s'",
    async style => {
      const box = (
        z: string,
      ) => `<div style="float: left; width: 50px; height: 50px; overflow: hidden; resize: both; ${style}">
      <p style="margin: 0; height: 50px; background: #f00; position: relative; z-index: ${z}"></p></div>`;
      const html = `<style>::-webkit-resizer { background: #0f0 }</style>${box("auto")}<div><br>${box("2")}</div>
      <div style="position: relative">${box("auto")}<i style="position: absolute; left: 100px; width: 50px; height: 99px; background: #00f"></i></div>`;
      const script = `return Array.from(document.querySelectorAll("p"), it => { const { right, bottom } = it.getBoundingClientRect(); return [right, bottom, document.elementFromPoint(right - 4, bottom - 4).tagName] })`;
      const [found, ...colors] = await render(html, script, [
        [45, 45],
        [95, 62],
        [145, 62],
      ]);
      expect([found.map(it => it[2]), colors]).toEqual([
        ["DIV", "DIV", "I"],
        ["00ff00", "00ff00", "0000ff"],
      ]);
    },
  );

  test("selected text in SVG is highlighted", async () => {
    const html = `<style>::selection { background: #0f0; fill: #00f }</style>
      <svg style="display: block"><text id=t y=70 font-size=90 font-weight=900 font-family=monospace fill=#f00>HH</text></svg>`;
    const script = `
      await new Promise(requestAnimationFrame);
      getSelection().setBaseAndExtent(t.firstChild, 0, t.firstChild, 1);
      await new Promise(requestAnimationFrame);`;
    const [, above, ...row] = await render(html, script, [
      [25, 2],
      ...Array.from({ length: 50 }, (_, i) => [i * 2 + 1, 60]),
    ]);
    const has = (color: string) => [row.slice(0, 26).includes(color), row.slice(28).includes(color)];
    expect([above, has("0000ff"), has("ff0000"), has("00ff00")]).toEqual([
      "00ff00",
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  test("currentcolor in a highlight is the color of what is below", async () => {
    const html = `<style>::highlight(a) { color: #0f0 } ::highlight(b) { color: #00f } ::highlight(c) { background: #0008 } ::selection { background: currentcolor }
      p { margin: 0; font: 40px/40px monospace; width: 6ch; zoom: 1 }</style><p id=p>......</p><p id=q>......</p>`;
    const script = `
      const range = (node, from, to) => new StaticRange({ startContainer: node.firstChild, startOffset: from, endContainer: node.firstChild, endOffset: to });
      CSS.highlights.set("a", new Highlight(range(p, 0, 2)));
      CSS.highlights.set("b", new Highlight(range(p, 4, 6)));
      CSS.highlights.set("c", new Highlight(range(q, 0, 4), range(q, 2, 6)));
      getSelection().selectAllChildren(p);
      await new Promise(requestAnimationFrame);`;
    const points = [10, 50].flatMap(y => [24, 72, 120].map(x => [x, y]));
    expect(await render(html, script, points)).toEqual([
      null,
      "00ff00",
      "000000",
      "0000ff",
      "777777",
      "777777",
      "777777",
    ]);
  });

  test("an SVG filter takes in what overflows", async () => {
    const html = `<svg width=0 height=0 style="position: absolute"><filter id=f x=0 y=0 width=1 height=1><feColorMatrix values="0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1 0" /></filter></svg>
      <div style="width: 20px; height: 20px; filter: url(#f)"><div id=d style="height: 20px; background: #f00; transform: translateX(50px)"></div></div>`;
    const script = `await new Promise(requestAnimationFrame); d.style.transform = "translateX(100px)"; await new Promise(requestAnimationFrame);`;
    expect(
      await render(html, script, [
        [60, 10],
        [110, 10],
      ]),
    ).toEqual([null, "ffffff", "00ff00"]);
  });

  test("an SVG document fills its viewport", async () => {
    const html = `<style>iframe, embed { float: left; width: 60px; height: 30px; border: 0 }</style>
      <iframe src="a.svg"></iframe><embed src="b.svg">`;
    const main = `
      const write = (name, rest) => require("fs").writeFileSync(__dirname + name, '<svg xmlns="http://www.w3.org/2000/svg" ' + rest + "</svg>");
      write("/a.svg", 'viewBox="0 0 2 2">');
      write("/b.svg", 'width="9" height="9">');
      await window.loadFile("index.html");`;
    const script = `return Array.from(document.body.children, it => { const { width, height } = it.getSVGDocument().documentElement.getBoundingClientRect(); return [width, height] })`;
    expect(await render(html, script, [], 1, main)).toEqual([
      [
        [60, 30],
        [60, 30],
      ],
    ]);
  });

  test("an SVG image is laid out in a size that is not snapped", async () => {
    const sheet = svg(`viewBox="0 0 800 20"><rect width="20" height="20" fill="#0f0"/>`);
    expect(
      await render(`<img src="${sheet}" style="display: block; width: 816px; height: 20.4px">`, "", [
        [2, 10],
        [22, 10],
      ]),
    ).toEqual([null, "00ff00", "ffffff"]);
  });

  test("a missing component of a legacy color comes from its neighbor in a gradient", async () => {
    const html = `<div style="height: 9px; background: linear-gradient(90deg in srgb, rgb(none 255 none), #ff0)"></div>`;
    expect(
      await render(html, "", [
        [2, 2],
        [190, 2],
      ]),
    ).toEqual([null, "ffff00", "ffff00"]);
  });

  test("a corner is square inside of a border that is wider than its radius", async () => {
    const html = `<div style="width: 9px; height: 40px; border-top: 50px solid #0f0; border-left: 50px solid #000; border-radius: 0 10px"></div>`;
    expect(
      await render(html, "", [
        [57, 45],
        [55, 60],
      ]),
    ).toEqual([null, "00ff00", "ffffff"]);
  });

  test("small things about SVG elements and transforms", async () => {
    const html = `<svg width=100 height=50><g display=none><rect id=hidden x=1 y=2 width=3 height=4 /></g><path id=moves d="M1 2M3 4" />
      <symbol width=10><rect id=inSymbol width=50% /></symbol><script id=s async></script><text id=t systemLanguage="" /></svg><p id=p></p>`;
    const script = `
      const box = it => { const { x, y, width, height } = it.getBBox(); return [x, y, width, height] };
      const half = (from, to) => { const it = p.animate({ transform: [from, to] }, 2); it.pause(); it.currentTime = 1; const { transform } = getComputedStyle(p); it.cancel(); return transform };
      return [box(hidden), box(moves), inSymbol.width.baseVal.value, s.async, t.systemLanguage.length,
        half("skewX(0deg) rotate(0deg)", "skewY(0deg) rotate(360deg)"), half("rotateX(360deg)", "rotateZ(180deg)").split("(")[0]];`;
    expect(await render(html, script)).toEqual([
      [[1, 2, 3, 4], [3, 4, 0, 0], 50, true, 1, "matrix(1, 0, 0, 1, 0, 0)", "matrix"],
    ]);
  });

  test("a missing image has a frame, an icon and its text", async () => {
    const html = `<style>img, input { position: absolute; top: 0; font: 20px/20px monospace } p img { position: static } p { margin: 50px 0 0 }</style>
      <img src=missing.png width=30 height=30><img width=30 height=30 style="left: 40px"><img src=missing.png width=17 height=30 style="left: 80px">
      <input type=image src=missing.png width=30 height=30 style="left: 120px"><img id=late src=missing.png style="left: 160px">
      <p><img src=missing.png width=99><img src=missing.png width=99 alt><img src=missing.png width=99 height=99 alt=ab><img title=a><img></p>`;
    const script = `
      const sizes = () => Array.from(document.querySelectorAll("p img"), it => [Math.round(it.offsetWidth / 4) * 4, it.offsetHeight]);
      const before = sizes();
      late.style.width = late.style.height = "30px";
      document.querySelector("[alt=ab]").alt = "";
      await new Promise(requestAnimationFrame);
      return [before, sizes()[2], getComputedStyle(document.querySelector("p img")).display, document.elementFromPoint(5, 5).tagName];`;
    expect(
      await render(
        html,
        script,
        [0, 40, 80, 120, 160].flatMap(x => [
          [x, 20],
          [x + 8, 14],
        ]),
      ),
    ).toEqual([
      [
        [
          [16, 16],
          [0, 0],
          [28 + 12, 20],
          [28, 20],
          [0, 0],
        ],
        [100, 99],
        "inline",
        "IMG",
      ],
      ...["c0c0c0", "58ae39", "c0c0c0", "ffffff", "ffffff", "ffffff", "c0c0c0", "58ae39", "c0c0c0", "58ae39"],
    ]);
  });

  test("the size of an image that turns out to be missing is that of its text", async () => {
    const html = `<img id=a alt=a style="width: 50px; aspect-ratio: 1 / 2; font: 20px/20px monospace"><img id=b style="width: 50px">`;
    const script = `
      const size = it => [Math.round(it.offsetWidth / 4) * 4, it.offsetHeight];
      a.src = b.src = "missing.png";
      const sizes = [size(a)];
      await Promise.all([a, b].map(it => new Promise(done => (it.onerror = done))));
      sizes.push(size(a), size(b));
      b.style.width = "60px";
      sizes.push(size(b));
      b.style.height = "20px";
      b.style.border = "5px solid";
      return [...sizes, size(b), [b.width, b.height], getComputedStyle(a).aspectRatio];`;
    expect(await render(html, script)).toEqual([
      [[52, 100], [28, 20], [16, 16], [16, 16], [72, 30], [60, 20], "1 / 2"],
    ]);
  });

  test("the layers of a mask have round corners, and leave alone what is outside of them", async () => {
    const all = "linear-gradient(#000 0 0)";
    const masks = [
      `${all} content-box exclude, ${all}`,
      `${all} content-box subtract, ${all}`,
      `none intersect, ${all}`,
      `${all} content-box`,
    ];
    const html = `<style>div { float: left; width: 30px; height: 30px; padding: 5px; margin: 5px; border-radius: 20px; background: #00f; box-shadow: 0 0 0 5px #f00 }</style>
      ${masks.map(it => `<div style="mask: ${it}"></div>`).join("")}`;
    const [ring, all3, inner] = [
      ["ffffff", "0000ff", "ffffff"],
      ["ffffff", "0000ff", "0000ff"],
      ["ffffff", "ffffff", "0000ff"],
    ];
    expect(
      await render(
        html,
        "",
        [0, 50, 100, 150].flatMap(x => [
          [x + 8, 8],
          [x + 12, 12],
          [x + 25, 25],
        ]),
      ),
    ).toEqual([null, ...ring, ...ring, ...all3, ...inner]);
  });

  test("a layer of a mask erases where it is empty", async () => {
    const half = svg('width="50" height="50"><rect width="50" height="25"/>');
    const html = `<div style="width: 50px; height: 50px; background: #00f; mask: url('${half}') intersect, linear-gradient(#000 0 0)"></div>`;
    expect(
      await render(html, "", [
        [25, 10],
        [25, 40],
      ]),
    ).toEqual([null, "0000ff", "ffffff"]);
  });

  test.skipIf(isMacOS)(
    "a scrollbar has its arrows without a thumb, and a thumb where there is little room",
    async () => {
      const html = `<style>div { float: left; width: 50px; height: 40px; overflow: hidden scroll; scrollbar-color: #f00 #00f }</style><div></div><div><p style="height: 99px"></div>`;
      expect(
        await render(html, "", [
          [42, 5],
          [42, 6],
          [39, 10],
          [42, 11],
          [42, 20],
          [42, 30],
          [92, 20],
        ]),
      ).toEqual([null, "0000ff", "ff0000", "ff0000", "0000ff", "0000ff", "ff0000", "ff0000"]);
    },
  );

  test("blending and backdrop filters work in perspective", async () => {
    const html = `<style>div { float: left; width: 60px; height: 60px; margin: 10px; transform: perspective(200px) rotateY(20deg) } body { background: #0f0 }</style>
      <div style="background: #fff; mix-blend-mode: difference"></div><div style="backdrop-filter: invert(1); border-radius: 50%"></div>`;
    expect(
      await render(html, "", [
        [40, 40],
        [120, 40],
        [95, 14],
      ]),
    ).toEqual([null, "ff00ff", "ff00ff", "00ff00"]);
  });

  test.each([
    ["turned", "transform: rotate(45deg)"],
    ["clipped to a path", "clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"],
    ["cut at the corners", "corner-shape: bevel; border-radius: 50%"],
    ["an ellipse", "border-radius: 50% / 40%"],
  ])("blending and backdrop filters work in what is %s", async (_, style) => {
    const html = `<style>div { float: left; width: 60px; height: 60px; margin: 20px; ${style} } body { background: #0f0 }</style>
      <div style="background: #fff; mix-blend-mode: difference"></div><div style="backdrop-filter: invert(1)"></div>`;
    expect(
      await render(html, "", [
        [50, 50],
        [21, 21],
        [150, 50],
        [121, 21],
      ]),
    ).toEqual([null, "ff00ff", "00ff00", "ff00ff", "00ff00"]);
  });

  test("blending stops at an isolated group", async () => {
    const html = `<style>div { float: left; width: 50px; height: 50px } p { margin: 0; height: 25px } body { background: #0f0 }</style>
      <div style="isolation: isolate"><div style="background: #fff; mix-blend-mode: difference"></div></div>
      <div style="isolation: isolate"><p style="background: #00f"></p><div style="margin-top: -25px; background: #fff; mix-blend-mode: difference"></div></div>
      <div style="background: linear-gradient(#f00, #f00), linear-gradient(#00f, #00f) 0 0 / 50% no-repeat; background-blend-mode: multiply"></div>
      <div style="isolation: isolate"><p style="background: #00f8"></p><div style="margin-top: -25px; background: #f008; mix-blend-mode: multiply"></div></div>`;
    expect(
      await render(html, "", [
        [25, 25],
        [75, 10],
        [75, 40],
        [110, 25],
        [140, 25],
        [175, 40],
      ]),
    ).toEqual([null, "ffffff", "ffff00", "ffffff", "000000", "ff0000", "887700"]);
  });

  test("round corners clip what blends and what filters its backdrop", async () => {
    const html = `<style>div { float: left; width: 80px; height: 80px; margin: 10px; border-radius: 40px; overflow: hidden } p { margin: 0; height: 40px } body { background: #0f0 }</style>
      <div><p style="background: #fff; mix-blend-mode: difference"></p></div><div><p style="backdrop-filter: invert(1)"></p></div>`;
    expect(
      await render(html, "", [
        [30, 30],
        [12, 12],
        [30, 70],
        [130, 30],
        [112, 12],
        [130, 70],
      ]),
    ).toEqual([null, "ff00ff", "00ff00", "00ff00", "ff00ff", "00ff00", "00ff00"]);
  });

  test("gradients that repeat", async () => {
    const html = `<style>div, svg { display: block; width: 100px; height: 20px }</style>
      <div style="background: linear-gradient(170deg, #00f, #00f) 0 0 / 30px round"></div>
      <svg><linearGradient id=g x2=.5 spreadMethod=repeat><stop offset=.5 stop-color=#00f /><stop offset=.6 stop-color=#0f0 /></linearGradient><rect width=100 height=20 fill=url(#g) /></svg>
      <div style="background: radial-gradient(closest-side at 0 50%, #f00 5px, #00f 9px)"></div>
      <div style="background: repeating-radial-gradient(closest-side at 0 50%, #f00, #00f)"></div>`;
    const [, ...colors] = await render(html, "", [
      [33, 5],
      [66, 5],
      [67, 5],
      [10, 30],
      [40, 30],
      [60, 30],
      [90, 30],
      [2, 50],
      [2, 70],
    ]);
    expect(colors).toEqual(["0000ff", "0000ff", "0000ff", "0000ff", "00ff00", "0000ff", "00ff00", "0000ff", "800080"]);
  });

  test("an image that is on its way shows nothing", async () => {
    using server = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Promise(() => {}) });
    const html = `<img id=a width=30 height=30 alt=text style="float: left"><input id=b type=image width=30 height=30 style="float: left">`;
    const script = `
      await new Promise(requestAnimationFrame);
      a.src = b.src = "${server.url}";
      await new Promise(requestAnimationFrame);`;
    expect(
      await render(html, script, [
        [6, 12],
        [30, 20],
        [38, 14],
      ]),
    ).toEqual([null, "ffffff", "ffffff", "ffffff"]);
  });

  test("the icon of a date field is drawn, whatever the policy says about images", async () => {
    const html = `<meta http-equiv=Content-Security-Policy content="img-src 'none'">
      <script>const reports = []; addEventListener("securitypolicyviolation", event => reports.push(event.violatedDirective));</script>
      <style>::-webkit-calendar-picker-indicator { position: absolute; inset: 0; width: 96px; height: 96px; margin: 0; padding: 0 } ::-webkit-datetime-edit { display: none }</style>
      <input type=date style="border: 0">`;
    const script = `await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return reports;`;
    expect(
      await render(html, script, [
        [48, 26],
        [48, 60],
      ]),
    ).toEqual([[], "000000", "ffffff"]);
  });

  test("a gradient stays inside of an SVG rectangle that is turned", async () => {
    const html = `<svg style="display: block"><linearGradient id=h><stop stop-color=#00f /><stop offset=1 stop-color=#00f /></linearGradient>
      <rect transform="rotate(45 50 50)" x=20 y=20 width=60 height=60 fill=url(#h) /><rect x=120.5 width=20 height=20 fill=url(#h) /></svg>`;
    expect(
      await render(html, "", [
        [50, 50],
        [15, 15],
        [120, 10],
      ]),
    ).toEqual([null, "0000ff", "ffffff", expect.stringMatching(/^(7f7f|8080)ff$/)]);
  });

  test("the controls of audio follow the color scheme", async () => {
    const html = `<audio controls style="display: block; width: 200px; height: 50px; color-scheme: dark"></audio>`;
    expect(
      await render(html, "", [
        [100, 4],
        [27, 25],
      ]),
    ).toEqual([null, "3b3b3b", "ffffff"]);
  });

  test("the controls of media are under what comes after it", async () => {
    const html = `<i id=before style="position: absolute; width: 20px; height: 100px; background: #0f0"></i><video id=v controls width=100 height=100
      ></video><b id=after style="display: inline-block; width: 50px; height: 100px; margin-left: -20px; background: #00f"></b>`;
    const script = `
      const { offsetNode, offset } = document.caretPositionFromPoint(40, 85);
      return [...[10, 50, 90].map(x => document.elementFromPoint(x, 85).id), offsetNode.localName, offset];`;
    expect(
      await render(html, script, [
        [10, 95],
        [90, 95],
      ]),
    ).toEqual([["before", "v", "after", "body", 1], "00ff00", "0000ff"]);
  });

  test("the active cues of a track are drawn over the video", async () => {
    const html = `<style>video { display: block; width: 200px; height: 100px; background: #00f }
      ::cue { font: 20px/20px monospace; background: #0f0; color: #0f0 } ::cue(b) { background: #f00; color: #f00 }</style><video id=v></video>`;
    const script = `
      const track = v.addTextTrack("captions");
      track.addCue(new VTTCue(0, 1, "aa<b>bb</b>"));
      track.addCue(Object.assign(new VTTCue(0, 1, "cc"), { line: 0, align: "left" }));
      track.addCue(Object.assign(new VTTCue(5, 6, "dd"), { line: 2 }));
      track.mode = "showing";
      v.play().catch(() => {});
      await new Promise(resolve => (track.oncuechange = resolve));
      await new Promise(requestAnimationFrame);
      return [...track.activeCues].map(it => it.text);`;
    expect(
      await render(html, script, [
        [90, 90],
        [110, 90],
        [10, 90],
        [10, 10],
        [100, 50],
      ]),
    ).toEqual([["aa<b>bb</b>", "cc"], "00ff00", "ff0000", "0000ff", "00ff00", "0000ff"]);
  });

  test("the style sheets of a track apply to its cues and fetch nothing", async () => {
    const seen: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch: request => (seen.push(new URL(request.url).pathname), new Response("")),
    });
    const vtt = `WEBVTT\n\nSTYLE\n@import url(${server.url}a.css);\n* { display: none }
      ::cue { font: 20px/20px monospace; color: #0f0; background: #0f0 url(${server.url}b.png) }
      ::cue(b) { color: #f00; background: #f00 image-set("${server.url}c.png" 1x) }\n\n00:00.000 --> 00:01.000\naa<b>bb</b>`;
    const html = `<style>video { display: block; width: 200px; height: 100px; background: #00f } ::cue { color: #000 }</style>
      <video id=v><track id=t src="data:text/vtt,${encodeURIComponent(vtt)}"></video><img id=i hidden>`;
    const script = `
      t.track.mode = "showing";
      await new Promise(resolve => (t.onload = resolve));
      v.play().catch(() => {});
      await new Promise(resolve => (t.track.oncuechange = resolve));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise(onerror => Object.assign(i, { onerror, src: "${server.url}last" }));
      return t.track.activeCues.length;`;
    expect([
      await render(html, script, [
        [90, 90],
        [110, 90],
        [10, 90],
      ]),
      seen,
    ]).toEqual([[1, "00ff00", "ff0000", "0000ff"], ["/last"]]);
  });

  test("masks and shapes of another origin need its consent", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: request =>
        new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20"/></svg>`,
          {
            headers: {
              "content-type": "image/svg+xml",
              ...(request.url.endsWith("yes") && { "access-control-allow-origin": "*" }),
            },
          },
        ),
    });
    const row = (name: string) => `<p><i style="shape-outside: url(${server.url}${name})"></i><b id=${name}></b>
      <u style="mask-image: url(${server.url}${name}); background: url(${server.url}${name}), #0f0"></u></p>`;
    const html = `<style>p { margin: 0; height: 20px; font-size: 0; position: relative } i { float: left } b { display: inline-block }
      i, b, u { width: 40px; height: 20px } u { position: absolute; top: 0; left: 100px }</style>${row("no")}${row("yes")}<img id=i hidden>`;
    const script = `
      while (yes.offsetLeft === 40) await new Promise(requestAnimationFrame);
      await new Promise(onload => Object.assign(i, { onload, src: "${server.url}last" }));
      await new Promise(requestAnimationFrame);
      return [no.offsetLeft, yes.offsetLeft];`;
    expect(
      await render(html, script, [
        [110, 10],
        [130, 10],
        [110, 30],
        [130, 30],
      ]),
    ).toEqual([[40, 20], "ffffff", "ffffff", "000000", "ffffff"]);
  });

  test("lines follow the corners of a float when they change", async () => {
    const html = `<style>p { margin: 0; font-size: 0; line-height: 0 } b { display: inline-block; width: 100px; height: 10px }
      i { float: left; width: 80px; height: 80px; border-radius: 40px; shape-outside: border-box }</style><p style="width: 190px"><i id=i></i><b id=b></b></p>`;
    const script = `return ["border-radius: 0", "corner-shape: bevel", "corner-shape: notch", "corner-shape: square"].map(it => {
      i.style = it;
      return b.offsetLeft;
    });`;
    expect(await render(html, script)).toEqual([[80, 50, 40, 80]]);
  });

  test("a background is clipped to the border area and the text", async () => {
    const html = `<div style="width: 100px; height: 60px; border: 10px solid #0000; font: 900 60px/60px sans-serif; color: #0000;
      background: #00f border-area text">H</div>`;
    const [, ...colors] = await render(html, "", [
      [5, 5],
      [100, 40],
      ...Array.from({ length: 20 }, (_, i) => [12 + i * 2, 40]),
    ]);
    expect([colors[0], colors[1], colors.slice(2).includes("0000ff")]).toEqual(["0000ff", "ffffff", true]);
  });

  test("oncopy, oncut and onpaste are handlers as attributes", async () => {
    const html = `<p oncopy="1" oncut="1" onpaste="1"></p><svg oncopy="1" oncut="1" onpaste="1"></svg>`;
    const script = `return [...document.body.children].flatMap(it => [it.oncopy, it.oncut, it.onpaste].map(it => typeof it));`;
    expect(await render(html, script)).toEqual([Array(6).fill("function")]);
  });

  test("geometry of SVG", async () => {
    const html = `<svg id=s width=200 height=100><text id=t x=10 y=50 textLength=100 lengthAdjust=spacingAndGlyphs>abcd</text>
      <defs><a id=hidden href=# tabindex=0></a></defs><rect id=r x=150 width=20 height=10 transform="translate(5 6)" style="transform-box: fill-box; transform-origin: 50% 50%" />
      <circle id=c r=5><animateMotion id=m path="M0 0 H30 H90" calcMode=discrete dur=9s begin=0s /></circle></svg>`;
    const script = `
      const range = new Range();
      range.selectNode(t.firstChild);
      hidden.focus();
      s.pauseAnimations();
      s.setCurrentTime(4);
      await new Promise(requestAnimationFrame);
      const { x, width } = range.getBoundingClientRect(), { transform, transformOrigin } = getComputedStyle(r);
      return [Math.round(x), Math.round(width), document.activeElement.localName, transform, transformOrigin, c.getCTM().e];`;
    expect(await render(html, script)).toEqual([[10, 100, "body", "matrix(1, 0, 0, 1, 5, 6)", "10px 5px", 30]]);
  });

  test("an element that is removed gets back the attributes that were animated", async () => {
    const html = `<svg><g id=g><rect class=a><set attributeName=class to=b /><set attributeName=mode to=c /></rect></g></svg>`;
    const script = `
      await new Promise(requestAnimationFrame);
      const rect = g.firstChild, { animVal } = rect.className;
      g.remove();
      return [animVal, rect.getAttribute("class"), rect.getAttribute("mode")];`;
    expect(await render(html, script)).toEqual([["b", "a", null]]);
  });

  test("the transition of a scroll button is not started over and over beside a container", async () => {
    const html = `<style>div::scroll-button(down) { content: ""; transition: color 9s } @container (width > 1px) { p { height: 7px } }</style>
      <div></div><section style="container-type: size"><p id=p></p></section>`;
    expect(await render(html, "return p.offsetHeight")).toEqual([7]);
  });

  test("what is hit in SVG follows every change", async () => {
    const html = `<style>.off { pointer-events: none }</style><svg id=s width=200 height=100><defs><circle id=shape r=10 /></defs>
      <rect id=back width=200 height=100 /><g id=g><path id=p d="M10 10C60 10 60 60 10 60z" stroke=red stroke-width=8 /></g><use id=u href=#shape x=150 y=50 /></svg>`;
    const script = `
      const at = () => [[20, 30], [50, 35], [120, 30], [150, 50], [165, 50]].map(it => document.elementFromPoint(...it).id).join();
      return [
        () => {},
        () => g.setAttribute("transform", "translate(100)"),
        () => shape.r.baseVal.value = 20,
        () => p.classList.add("off"),
        () => (p.classList.remove("off"), g.removeAttribute("transform"), p.style.fill = "none"),
        () => p.setAttribute("stroke-width", 2),
        () => s.append(back),
        () => back.remove(),
        () => s.setAttribute("viewBox", "0 0 400 200"),
      ].map(change => (change(), at()));`;
    expect(await render(html, script)).toEqual([
      [
        "p,p,back,u,back",
        "back,back,p,u,back",
        "back,back,p,u,u",
        "back,back,back,u,u",
        "back,p,back,u,u",
        "back,back,back,u,u",
        "back,back,back,back,back",
        "s,s,s,u,u",
        "s,s,s,s,s",
      ],
    ]);
  });

  test("an svg with many elements shows every change", async () => {
    const square = (x: number, y: number, more = "") => `<rect x=${x * 10} y=${y * 10} width=10 height=10 ${more} />`;
    const row = (y: number) => Array.from({ length: 20 }, (_, x) => square(x, y, `id=r${y}-${x}`)).join("");
    const html = `<style>html { overflow: hidden } g.odd > :nth-child(odd) { fill: #ff0 }</style><svg id=s width=200 height=100 fill=#00f>
      <linearGradient id=paint><stop id=stop stop-color=#f00 /></linearGradient><clipPath id=clip><rect id=hole y=30 width=10 height=10 /></clipPath>
      <g id=a>${row(0)}</g><g id=b>${row(1)}</g><g id=c>${row(2)}</g><g clip-path=url(#clip)>${row(3)}</g>
      ${square(0, 4, "fill=url(#paint)")}<use href=#r0-5 y=50 /><rect y=60 width=5% height=10 /><g id=d opacity=.2>${square(0, 7, "fill=#000")}</g>
      <g id=e><path d="M0 85h20" stroke=#000 stroke-width=2 vector-effect=non-scaling-stroke /></g></svg>`;
    const script = `
      const $ = id => document.getElementById(id);
      for (const change of [
        () => {},
        () => $("r0-0").setAttribute("fill", "#0f0"),
        () => $("r0-1").remove(),
        () => b.prepend($("r0-2")),
        () => $("r0-2").setAttribute("y", 90),
        () => b.setAttribute("transform", "translate(20)"),
        () => c.classList.add("odd"),
        () => c.prepend($("r2-19")),
        () => hole.setAttribute("x", 20),
        () => $("stop").setAttribute("stop-color", "#0ff"),
        () => $("r0-5").setAttribute("x", 60),
        () => s.setAttribute("width", 400),
        () => d.setAttribute("transform", "translate(150)"),
        () => e.setAttribute("transform", "translate(0 -765) scale(10)"),
        () => $("r0-9").setAttribute("display", "none"),
        () => $("r0-10").setAttribute("display", "none"),
        () => $("r0-10").removeAttribute("display"),
      ]) {
        change();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }`;
    const expected: [number, number, string][] = [
      [0, 0, "00ff00"],
      [1, 0, "ffffff"],
      [2, 0, "ffffff"],
      [3, 0, "0000ff"],
      [5, 0, "ffffff"],
      [9, 0, "ffffff"],
      [10, 0, "0000ff"],
      [1, 1, "ffffff"],
      [2, 1, "0000ff"],
      [4, 9, "0000ff"],
      [0, 2, "0000ff"],
      [1, 2, "ffff00"],
      [19, 2, "ffff00"],
      [0, 3, "ffffff"],
      [2, 3, "0000ff"],
      [0, 4, "00ffff"],
      [5, 5, "ffffff"],
      [6, 5, "0000ff"],
      [1, 6, "0000ff"],
      [0, 7, "ffffff"],
      [15, 7, "cccccc"],
      [15, 8, "000000"],
      [15, 8.3, "ffffff"],
    ];
    expect(
      await render(
        html,
        script,
        expected.map(([x, y]) => [x * 10 + 5, y * 10 + 5]),
      ),
    ).toEqual([null, ...expected.map(it => it[2])]);
  });

  test("an SVG image with many elements follows its size", async () => {
    const stripes = Array.from(
      { length: 40 },
      (_, i) => `<rect x="${i}" width="1" height="5" fill="${i % 2 ? "#00f" : "#0f0"}"/>`,
    ).join("");
    const image =
      svg(`viewBox="0 0 40 10" preserveAspectRatio="none"><style>@media (min-width: 150px) { .wide { fill: #f00 } }</style>${stripes}
      <rect class="wide" y="5" width="20" height="5"/><path d="M30 5v5" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    const script = `
      await i.decode();
      for (const width of [40, 80, 120, 200]) {
        i.width = width;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }`;
    expect(
      await render(`<img id=i height=100 style="display: block" src="${image}">`, script, [
        [2, 5],
        [7, 5],
        [197, 5],
        [50, 75],
        [150, 75],
        [153, 75],
      ]),
    ).toEqual([null, "00ff00", "0000ff", "0000ff", "ff0000", "000000", "ffffff"]);
  });

  test("a stroke is the same wherever it is cut off", async () => {
    const script = `
      const draw = clips => {
        const context = new OffscreenCanvas(300, 300).getContext("2d");
        if (clips) (context.rect(0, 100, 300, 100), context.clip());
        context.lineWidth = 3;
        context.stroke(new Path2D("M10 70L40 70L280 230L200 230z"));
        return context.getImageData(0, 100, 300, 100).data;
      };
      const [part, whole] = [draw(true), draw(false)];
      return part.every((it, at) => Math.abs(it - whole[at]) < 3);`;
    expect(await render("", script)).toEqual([true]);
  });

  test.each([4, 1000])(
    "canvases and bitmaps of %d pixels that were copied from each other change alone",
    async side => {
      const script = `
      const create = color => {
        const context = new OffscreenCanvas(${side}, ${side}).getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, ${side}, ${side});
        return context;
      };
      const corners = context => [0, ${side - 1}].map(at => context.getImageData(at, at, 1, 1).data.join());
      const show = image => { const context = create("#0000"); context.drawImage(image, 0, 0); return corners(context); };
      const [a, b, c] = [create("#f00"), create("#fff"), create("#fff")];
      const first = await createImageBitmap(a.canvas);
      a.fillStyle = "#0f0";
      a.fillRect(0, 0, 1, 1);
      const second = await createImageBitmap(a.canvas);
      b.globalCompositeOperation = c.globalCompositeOperation = "copy";
      b.drawImage(second, 0, 0);
      c.drawImage(a.canvas, 0, 0);
      a.fillStyle = "#00f";
      a.fillRect(0, 0, ${side}, ${side});
      b.globalCompositeOperation = "source-over";
      b.clearRect(${side - 1}, ${side - 1}, 1, 1);
      const third = await createImageBitmap(c.canvas);
      c.globalCompositeOperation = "source-over";
      c.drawImage(c.canvas, ${side - 1}, ${side - 1});
      const all = c.getImageData(-1, -1, ${side + 2}, ${side + 2}).data;
      return [show(first), show(second), show(third), ...[a, b, c].map(corners), all.subarray(0, 4).join(), all.subarray(-4).join(), all.reduce((sum, it) => sum + it)];`;
      const [red, green, blue, none] = ["255,0,0,255", "0,255,0,255", "0,0,255,255", "0,0,0,0"];
      expect(await render("", script)).toEqual([
        [
          [red, red],
          [green, red],
          [green, red],
          [blue, blue],
          [green, none],
          [green, green],
          none,
          none,
          side * side * 510,
        ],
      ]);
    },
  );

  test.each([true, false])("a canvas that was read keeps up with what changes it (alpha: %p)", async alpha => {
    const script = `
      const context = a.getContext("2d", { alpha: ${alpha} }), other = new OffscreenCanvas(20, 20).getContext("2d");
      const filled = (side, ...color) => new ImageData(Uint8ClampedArray.from({ length: side * side * 4 }, (_, index) => color[index % 4]), side);
      const read = context => [1, 15].map(at => context.getImageData(at, at, 1, 1).data.join("")).join();
      const seen = [
        () => {},
        () => context.putImageData(filled(20, 9, 8, 7, 0), 0, 0),
        () => context.putImageData(filled(20, 201, 100, 3, 128), 0, 0),
        () => (other.drawImage(a, 0, 0), context.putImageData(filled(10, 1, 2, 3, 255), 0, 0)),
        () => context.putImageData(filled(20, 4, 5, 6, 255), 0, 0, 10, 10, 10, 10),
        () => context.putImageData(filled(20, 7, 8, 9, 255), 10, 10),
        () => context.clearRect(0, 0, 10, 10),
        () => (context.putImageData(filled(20, 1, 1, 1, 255), 0, 0), (a.width = 10)),
        () => (context.putImageData(filled(20, 2, 2, 2, 255), 0, 0), (a.width = 20), context.putImageData(filled(20, 3, 3, 3, 255), 0, 0)),
        () => context.reset(),
        () => (context.putImageData(filled(20, 0, 0, 255, 255), 0, 0), (context.fillStyle = "#0f0"), context.fillRect(10, 10, 10, 10)),
      ].map(change => (change(), read(context)));
      await new Promise(requestAnimationFrame);
      const image = context.getImageData(0, 0, 20, 20);
      image.data.fill(255, 0, 20 * 4 * 5);
      context.putImageData(image, 0, 0);
      return [seen, read(other)];`;
    const [none, clear, half] = alpha ? ["0000", "0000", "2011004128"] : ["000255", "987255", "2011003255"];
    const twice = (it: string) => `${it},${it}`;
    expect(
      await render("<canvas id=a width=20 height=20></canvas>", script, [
        [5, 2],
        [5, 7],
        [15, 15],
      ]),
    ).toEqual([
      [
        [
          twice(none),
          twice(clear),
          twice(half),
          `123255,${half}`,
          "123255,456255",
          "123255,789255",
          `${none},789255`,
          `${none},0000`,
          twice("333255"),
          twice(none),
          "00255255,02550255",
        ],
        twice(half),
      ],
      "ffffff",
      "0000ff",
      "00ff00",
    ]);
  });

  test.each(["copy", "source-in", "destination-atop"])("%s clears a canvas that the shape misses", async mode => {
    const script = `
      const context = new OffscreenCanvas(10, 10).getContext("2d");
      context.fillRect(0, 0, 10, 10);
      context.globalCompositeOperation = "${mode}";
      context.fillRect(0, 15, 10, 10);
      return context.getImageData(5, 5, 1, 1).data.join();`;
    expect(await render("", script)).toEqual(["0,0,0,0"]);
  });

  test("the same declaration means what it means where it is", async () => {
    const html = `<p id=a style="width: 2rem; height: 10vw; background: url(a.png)"></p><iframe id=f width=100></iframe>
      <svg><rect id=r width=3 opacity=.5 transform="scale(2) translate(1 2)" /><rect id=q style="width: 3; opacity: .5" /><svg id=inner /></svg>`;
    const script = `
      const of = (it, ...names) => names.map(name => it.ownerDocument.defaultView.getComputedStyle(it)[name]);
      const [here] = of(a, "backgroundImage");
      f.contentDocument.write("<!doctype html><html style='font-size: 5px'><base href=file:///b/>" + a.outerHTML);
      return [of(a, "width", "height"), here.includes("/b/"), of(f.contentDocument.body.firstChild, "width", "height", "backgroundImage"),
        of(r, "width", "opacity", "transform", "transformOrigin"), of(q, "width", "opacity"), q.style.cssText, of(inner, "transformOrigin")];`;
    expect(await render(html, script)).toEqual([
      [
        ["32px", "20px"],
        false,
        ["10px", "10px", 'url("file:///b/a.png")'],
        ["3px", "0.5", "matrix(2, 0, 0, 2, 2, 4)", "0px 0px"],
        ["0px", "0.5"],
        "opacity: 0.5;",
        ["0px 0px"],
      ],
    ]);
  });

  test("a foreignObject has a box while it is rendered", async () => {
    const html = `<svg width=200 height=100><defs id=d><foreignObject id=f width=50 height=50><p id=p style="margin: 0; height: 20px; background: #00f"></p></foreignObject></defs>
      <switch id=s><g id=first /></switch></svg>`;
    const script = `return [() => {}, () => d.after(f), () => s.append(f), () => first.setAttribute("systemLanguage", "xx")].map(change => (change(), p.offsetHeight));`;
    expect(await render(html, script, [[10, 10]])).toEqual([[0, 20, 0, 20], "0000ff"]);
  });

  test("blurs are limited", async () => {
    const box = (style: string) =>
      `<div style="position: fixed; left: -9900px; top: -9900px; width: 10000px; height: 20000px; ${style}"></div>`;
    const shade = async (style: string) =>
      parseInt((await render(box(style), "", [[190, 50]]))[1].slice(0, 2), 16) >> 4;
    expect(
      await Promise.all(
        [
          "box-shadow: 0 0 9000px",
          "background: #000; filter: blur(9000px)",
          "background: #000; filter: drop-shadow(0 0 9000px #000)",
        ].map(shade),
      ),
    ).toEqual([12, 9, 9]);
  });

  test("the dashes of a very long line", async () => {
    const html = `<svg width=200 height=100><path d="M-4000000 10H4000000" stroke=#00f stroke-width=20 stroke-dasharray="2 2" />
      <path d="M0 50H200V9e4H0z" fill=none stroke=#00f stroke-width=20 stroke-dasharray="10 10" stroke-dashoffset=5 /></svg>`;
    const points = [
      [0, 10],
      [2, 10],
      [100, 10],
      [102, 10],
      [2, 45],
      [10, 45],
      [20, 45],
      [5, 62],
      [5, 70],
    ];
    const [, ...colors] = await render(html, "", points);
    expect(colors.map(it => +(it < "8")).join("")).toBe("101010101");
  });

  test("a path with very many edges", async () => {
    const script = `
      const context = document.body.appendChild(document.createElement("canvas")).getContext("2d");
      for (let i = 0; i < 40000; i++) context.rect(20 + (i % 40), 0, 40, 100);
      context.fill();
      return [19, 20, 60, 98, 99].map(x => context.getImageData(x, 50, 1, 1).data[3]);`;
    expect(await render("", script)).toEqual([[0, 255, 255, 255, 0]]);
  });

  test("a blur that is much wider than the backdrop leaves its average", async () => {
    const html = `<div style="width: 100px; height: 100px; background: linear-gradient(90deg, #f00 50%, #00f 50%)"></div>
      <div style="position: absolute; inset: 0; width: 100px; height: 100px; backdrop-filter: blur(1e9px)"></div>
      <div style="position: absolute; left: 120px; top: 0; width: 50px; height: 50px; background: #000; filter: blur(1e9px)"></div>`;
    const [, ...colors] = await render(html, "", [
      [2, 2],
      [97, 97],
      [140, 20],
    ]);
    expect(colors.map(it => [...Buffer.from(it, "hex")].map(it => Math.round(it / 8)))).toEqual([
      [16, 0, 16],
      [16, 0, 16],
      [32, 32, 32],
    ]);
  });

  test("a placeholder canvas is tainted by what its OffscreenCanvas draws", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), {
          headers: { "content-type": "image/gif" },
        }),
    });
    const script = `
      const image = new Image(); image.src = ${JSON.stringify(server.url.href)}; await image.decode();
      const read = canvas => { try { return canvas.toDataURL().slice(0, 5) } catch (error) { return error.name } };
      const [near, far] = [document.createElement("canvas"), document.createElement("canvas")];
      const { port1, port2 } = new MessageChannel(), sent = far.transferControlToOffscreen();
      port1.postMessage(sent, [sent]);
      const received = await new Promise(resolve => (port2.onmessage = event => resolve(event.data)));
      for (const canvas of [near.transferControlToOffscreen(), received]) canvas.width = 7, canvas.getContext("2d").drawImage(image, 0, 0);
      while (near.width !== 7 || far.width !== 7) await new Promise(requestAnimationFrame);
      return [read(near), read(far)]`;
    expect(await render("", script)).toEqual([["SecurityError", "SecurityError"]]);
  });

  test("a worker paints a placeholder with a canvas that was transferred twice, a bitmap that was transferred, and a clone", async () => {
    const worker = `onmessage = ({ data: [canvas, moved, cloned] }) => {
      canvas.width = 40; const context = canvas.getContext("2d");
      context.drawImage(moved, 0, 0); context.drawImage(cloned, 20, 0);
    }`;
    const script = `
      const bitmap = color => {
        const context = new OffscreenCanvas(20, 20).getContext("2d");
        context.fillStyle = color; context.fillRect(0, 0, 20, 20);
        return createImageBitmap(context.canvas);
      };
      const [moved, cloned, first] = [await bitmap("#00f"), await bitmap("#0f0"), document.querySelector("canvas").transferControlToOffscreen()];
      const second = structuredClone(first, { transfer: [first] });
      new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}]))).postMessage([second, moved, cloned], [second, moved]);
      while (document.querySelector("canvas").width !== 40) await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return [first, second, moved, cloned].map(it => it.width)`;
    expect(
      await render("<canvas></canvas>", script, [
        [10, 10],
        [30, 10],
      ]),
    ).toEqual([[0, 0, 0, 20], "0000ff", "00ff00"]);
  });

  test("a copy of an ImageBitmap has the pixels and the size of the original", async () => {
    const script = `
      const filled = color => { const context = new OffscreenCanvas(2, 2).getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 2, 2); return context.canvas.transferToImageBitmap(); };
      const read = bitmap => { const context = new OffscreenCanvas(1, 1).getContext("2d"); context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, 1, 1).data.join(); };
      const others = [filled("#f00"), filled("#f00")], original = filled("#00f"), seen = new Set();
      for (let id = 1; id < 20; id++) Object.prototype.id = Object.prototype.token = id, seen.add(read(structuredClone(original)));
      const { get } = Object.getOwnPropertyDescriptor(ImageBitmap.prototype, "width");
      Object.defineProperty(ImageBitmap.prototype, "width", { value: 9 });
      const moved = structuredClone(original, { transfer: [original] });
      return [[...seen], read(moved), get.call(moved), get.call(original), others.map(read)]`;
    expect(await render("", script)).toEqual([[["0,0,255,255"], "0,0,255,255", 2, 0, ["255,0,0,255", "255,0,0,255"]]]);
  });

  test.each([
    ["use", `"<svg>" + each(i => '<g id=c' + i + '><use href=#c' + (i + 1) + ' /></g>')`],
    [
      "set",
      `"<svg><rect>" + each(i => '<set id=c' + i + ' begin=' + (i < 29999 ? 'c' + (i + 1) + '.begin' : '0s') + ' attributeName=x to=1 />')`,
    ],
    ["animate", `"<svg>" + each(i => '<rect><animate attributeName=x to=1 dur=9s /></rect>')`],
    [
      "textPath",
      `"<svg>" + ["a", "b"].map((id, y) => "<path id=" + id + " d='M0 " + y + "a1 1 0 1 1 1 1".repeat(9999) + "' />") + "<text>" + "<textPath href=#a>abc</textPath><textPath href=#b>abc</textPath>".repeat(999)`,
    ],
  ])("very many %s elements that refer to each other are rendered", async (_, markup) => {
    const script = `
      const each = make => Array.from({ length: 30000 }, (_, i) => make(i)).join("");
      document.body.innerHTML = ${markup} + "</svg><div style='position: fixed; inset: 0; background: #0f0'>";
      await new Promise(requestAnimationFrame);`;
    expect(await render("", script, [[10, 10]])).toEqual([null, "00ff00"]);
  });

  test("a view transition of an element shows its pseudo-elements in the element", async () => {
    const html = `<style>
      section { margin: 20px; border: 10px solid #000; width: 100px; height: 40px; view-transition-name: none }
      section::view-transition { background: #00f }
      div { width: 20px; height: 20px; background: #0f0; view-transition-name: box }
      ::view-transition-group(box) { animation-timing-function: linear }
    </style><section><div></div></section><div></div>`;
    const script = `
      const scope = document.querySelector("section");
      const transition = scope.startViewTransition(() => void (scope.firstChild.style.marginLeft = "80px"));
      await transition.ready;
      for (const it of document.getAnimations()) it.pause(), it.currentTime = 125;
      await new Promise(requestAnimationFrame);
      return [scope.activeViewTransition === transition, document.activeViewTransition, transition.transitionRoot === scope]`;
    expect(
      await render(html, script, [
        [80, 40],
        [40, 40],
        [25, 25],
        [150, 40],
      ]),
    ).toEqual([[true, null, true], "00ff00", "0000ff", "000000", "ffffff"]);
  });

  test("a stable gutter stays empty if the overflow is hidden", async () => {
    const html = `<style>::-webkit-scrollbar { width: 20px; background: #f00 }</style>
      <div style="width: 50px; height: 50px; overflow: hidden; scrollbar-gutter: stable; background: #0f0"><p style="height: 99px">`;
    expect(await render(html, "", [[40, 25]])).toEqual([null, "00ff00"]);
  });

  test("an underline is on the baseline of the element that has it", async () => {
    const html = `<u style="font: 20px/20px serif; color: transparent; text-decoration: underline #0f0 4px; text-decoration-skip-ink: none; position: absolute; top: 30px"
      >xxxx<span style="vertical-align: 12px">xxxx</span></u>`;
    const [, ...colors] = await render(
      html,
      "",
      [5, 65].flatMap(x => [48, 52, 56, 60, 64, 68].map(y => [x, y])),
    );
    expect(colors.slice(6)).toEqual(colors.slice(0, 6));
    expect(colors).toContain("00ff00");
  });

  test("SVG: sizes come from attributes, filters work where nothing is displayed, empty transforms are inherited", async () => {
    const html = `<svg style="display: none"><filter id=f><feFlood flood-color=#0f0 /></filter></svg>
      <svg width=200 height=100 style="display: block">
        <symbol id=s><rect width=90 height=90 fill=#00f /></symbol><use href=#s width=20 height=20 style="width: 90px; height: 90px" />
        <rect x=100 width=20 height=20 filter=url(#f) />
        <linearGradient id=a gradientTransform="scale(-1)"><stop stop-color=#0f0 /><stop offset=1 stop-color=#f00 /></linearGradient>
        <linearGradient id=b href=#a gradientTransform="" /><rect x=150 width=20 height=20 fill=url(#b) />
      </svg>`;
    expect(
      await render(html, "", [
        [10, 10],
        [50, 50],
        [110, 10],
        [165, 10],
      ]),
    ).toEqual([null, "0000ff", "ffffff", "00ff00", "00ff00"]);
  });

  test("an embedded color profile is applied", async () => {
    const number = (...all: number[]) =>
      Buffer.from(new Uint8Array(all.flatMap(it => [it >>> 24, it >>> 16, it >>> 8, it])));
    const tags = { rXYZ: 224, gXYZ: 204, bXYZ: 244, rTRC: 264, gTRC: 264, bTRC: 264 };
    const primaries = [
      [0.4361, 0.2225, 0.0139],
      [0.3851, 0.7169, 0.0971],
      [0.1431, 0.0606, 0.7141],
    ];
    const swapped = Buffer.concat([
      Buffer.alloc(16),
      Buffer.from("RGB XYZ "),
      Buffer.alloc(104),
      number(6),
      ...Object.entries(tags).flatMap(([name, at]) => [Buffer.from(name), number(at, 0)]),
      ...primaries.flatMap(it => [Buffer.from("XYZ "), number(0, ...it.map(it => Math.round(it * 65536)))]),
      Buffer.from("curv"),
      number(0, 1, 0x0233 << 16),
    ]);
    const chunk = (kind: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(kind), data]);
      return Buffer.concat([number(data.length), body, number(Bun.hash.crc32(body))]);
    };
    const red = (profile: Buffer) =>
      Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", Buffer.from("00000001000000010802000000", "hex")),
        chunk("iCCP", Buffer.concat([Buffer.from("p\0\0"), deflateSync(profile)])),
        chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
        chunk("IEND", Buffer.alloc(0)),
      ]).toString("base64");
    const html = [swapped, swapped.subarray(0, 250)].map(
      it => `<img width=20 style=float:left src="data:image/png;base64,${red(it)}">`,
    );
    expect(
      await render(html.join(""), "", [
        [10, 10],
        [30, 10],
      ]),
    ).toEqual([null, "00ff00", "ff0000"]);
  });

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

  test("a view transition of a root element that is in the top layer", async () => {
    expect(
      await render(
        "<html popover style='inset: 0; width: auto; height: auto; background: #0f0'>",
        `document.documentElement.showPopover();
        await document.startViewTransition().ready;
        for (const it of document.getAnimations()) it.pause(), it.currentTime = 125;
        return document.documentElement.matches(":active-view-transition");`,
        [[20, 20]],
      ),
    ).toEqual([true, "00ff00"]);
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

describe.skipIf(!hasLibrary).concurrent("an image is not decoded before it is drawn if", () => {
  const number = (it: number) => Buffer.from(Uint32Array.of(it).buffer).reverse();
  const chunk = (kind: string, ...data: Buffer[]) => {
    const body = Buffer.concat([Buffer.from(kind), ...data]);
    return Buffer.concat([number(body.length - 4), body, number(Bun.hash.crc32(body))]);
  };
  const png = (side: number, ...chunks: Buffer[]) =>
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", number(side), number(side - 1), Buffer.from([1, 0, 0, 0, 0])),
      ...chunks,
      chunk("IDAT", deflateSync(Buffer.alloc(501 * 3999))),
      chunk("IEND"),
    ]);
  const animated = [
    chunk("acTL", number(1), number(0)),
    chunk("fcTL", number(0), number(4000), number(3999), Buffer.alloc(14)),
  ];
  const runs = Buffer.concat([bmp(0, 0, []), Buffer.from([0, 1])]);
  [4000, 4000, 1 | (8 << 16), 1, 0, 0, 0, 0].forEach((it, i) => runs.writeUInt32LE(it, 18 + i * 4));
  test.each([
    ["it is a large GIF", gif(4000, 1)],
    ["it is a long GIF", gif(1000, 16)],
    ["it is a large BMP", runs],
    [
      "it is a large icon",
      Buffer.concat([Buffer.from("0000010001000000000001002000ffff000016000000", "hex"), png(4000)]),
    ],
    ["it is a large APNG", png(4000, ...animated)],
    ["its frames are larger than it is", png(2, ...animated)],
    [
      "its orientation is ignored",
      png(4000, chunk("eXIf", Buffer.from("49492a00080000000100120103000100000006000000", "hex"))),
    ],
  ])("%s", async (_, file) => {
    const load = `(async () => {
      const blob = new Blob([Uint8Array.fromBase64("${file.toBase64()}")]);
      const images = Array.from({ length: 8 }, () => Object.assign(new Image(), { src: URL.createObjectURL(blob), style: "visibility: hidden; image-orientation: none" }));
      document.body.append(...images);
      await Promise.all(images.map(it => new Promise(resolve => (it.onload = it.onerror = resolve))));
      while (images.some(it => it.offsetWidth < it.offsetHeight)) await new Promise(requestAnimationFrame);
      return images.map(it => it.naturalWidth > 0);
    })()`;
    const main = `
      const before = process.resourceUsage().maxRSS;
      const loaded = await page.executeJavaScript(${JSON.stringify(load)});
      await page.executeJavaScript("found = " + JSON.stringify([loaded, (process.resourceUsage().maxRSS - before) >> 10]));`;
    const [[loaded, megabytes]] = await renderTo("memory", "<body>", "return found", [], 1, main);
    expect(loaded).toEqual(Array(8).fill(true));
    expect(megabytes).toBeLessThan(isASAN ? 100 : 50);
  });
});

test.skipIf(!hasLibrary)("what a damaged database has is not taken for what it claims to be", async () => {
  const open = `
    const done = it => new Promise((resolve, reject) => { it.onsuccess = () => resolve(it.result); it.onerror = () => reject(it.error); });
    const request = indexedDB.open("a");
    request.onupgradeneeded = () => request.result.createObjectStore("s");
    const database = await done(request);`;
  const write = `(async () => {
    ${open}
    const values = [new ImageData(1, 1), new ImageData(1, 2), await createImageBitmap(new ImageData(1, 1)), new File(["a"], "a", { lastModified: 1 })];
    const transaction = database.transaction("s", "readwrite");
    values.forEach((it, index) => transaction.objectStore("s").put(it, index + 1));
    await new Promise(resolve => (transaction.oncomplete = resolve));
  })()`;
  const read = `(async () => {
    ${open}
    const store = database.transaction("s").objectStore("s");
    const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
    return [keys.map(String), values.map(it => String(it?.lastModified ?? it))];
  })()`;
  const view = (kind: string, length: number) =>
    `16${kind}${"00".repeat(8)}0${length}${"00".repeat(7)}150${length}${"00".repeat(7 + length)}`;
  const size = (width: string, height: string) => `01000000${width}02000000${height}`;
  const [one, two, huge] = ["07", "0502000000", "0A000000000000E041"];
  const damage = [
    ["value", view("03", 4), "0541414141"],
    ["value", view("03", 8) + size(one, two), view("03", 0) + size(huge, huge)],
    ["value", view("02", 4) + size(one, one), view("02", 0) + size(huge, huge)],
    ["value", "000000000000F03F", "2A0000000000FCFF"],
    ["key", "10C010000000000000", "100003FFFFFFFFFFD5"],
  ];
  const main = `
    await page.executeJavaScript(${JSON.stringify(write)});
    const { Database } = require("bun:sqlite");
    require("fs").mkdirSync(__dirname + "/copy");
    new Database(__dirname + "/data/Web Storage.sqlite").run("VACUUM INTO ?", [__dirname + "/copy/Web Storage.sqlite"]);
    const copy = new Database(__dirname + "/copy/Web Storage.sqlite");
    for (const [column, from, to] of ${JSON.stringify(damage)}) copy.run("UPDATE records SET " + column + " = unhex(replace(hex(" + column + "), ?, ?))", [from, to]);
    copy.close();
    const other = new BrowserWindow({ webPreferences: { session: require("electron").session.fromPath(__dirname + "/copy") } });
    await other.loadFile("index.html");
    await page.executeJavaScript("found = " + JSON.stringify(await other.webContents.executeJavaScript(${JSON.stringify(read)})));`;
  expect(await renderTo("memory", "", "return found", [], 1, main)).toEqual([
    [
      ["NaN", "1", "2", "3"],
      ["NaN", "null", "null", "null"],
    ],
  ]);
});

describe.concurrent.each(screens)("the compositor on %s", where => {
  const show = (html: string, main: string, script = "", points: number[][] = []) =>
    renderTo(where, html, script, points, 1, main);
  const wheel = (x: number, y: number, deltaY: number) => `
    window.sendInputEvent({ type: "mouseMove", x: ${x}, y: ${y} });
    window.sendInputEvent({ type: "mouseWheel", x: ${x}, y: ${y}, deltaX: 0, deltaY: ${deltaY} });`;
  const rows = ["f00", "0f0", "00f", "ff0", "0ff", "f0f"].map(it => `<p style="background: #${it}"></p>`).join("");
  const style = "<style>p { margin: 0; height: 100px } * { scrollbar-width: none }</style>";

  test("what takes minutes to paint is given up", async () => {
    const html = `<svg width=100 height=100><filter id=f>${"<feTurbulence baseFrequency=.1 numOctaves=24 />".repeat(10_000)}</filter><rect width=100 height=100 filter=url(#f) /></svg>
      <i style="position: fixed; inset: 0 0 0 100px; background: #f00; clip-path: polygon(0 0, 100% 50%, 0 100%)"></i>`;
    const main = `await until(() => shown(150, 50) === "ff0000");`;
    expect(await show(html, main, `document.querySelector("svg").remove()`, [[50, 50]])).toEqual([null, "ffffff"]);
  });

  test.each([
    ["nothing", ""],
    ["filters", `<i style="backdrop-filter: blur(2px)"></i>`.repeat(100)],
  ])("very many layers with %s in front of them are shown", async (_, more) => {
    const layers = Array.from(
      { length: 30_000 },
      (_, i) => `<i style="border-radius: ${60 + (i % 670) / 10}px"></i>`,
    ).join("");
    const html = `<style>i { position: fixed; inset: 0 -200px -200px 0; background: #00f1 }</style><div>${layers}${more}</div>
      <b style="position: fixed; inset: 40px; background: #f00"></b>`;
    const main = `await until(() => shown(100, 50) === "ff0000");`;
    expect(await show(html, main, `document.querySelector("div").remove()`, [[10, 10]])).toEqual([null, "ffffff"]);
  });

  test("large animations play, but for those that there is no memory for", async () => {
    const image = (i: number) =>
      `<img width=20 style="float: left" src="data:image/gif;base64,${gif(2000, 4, i).toBase64()}">`;
    const html = `${[0, 1, 2, 3].map(image).join("")}<template>${image(4)}</template>`;
    const main = `
      const last = new Set();
      for (const x of [10, 30, 50, 70]) await until(() => shown(x, 10) === "0000ff");
      await page.executeJavaScript("document.body.append(document.querySelector('template').content)");
      await until(() => shown(90, 10) === "ff0000");
      for (const color of ["0000ff", "ff0000", "0000ff"]) await until(() => last.add(shown(90, 10)) && shown(10, 10) === color);
      await page.executeJavaScript("last = " + JSON.stringify([...last]) + "; document.body.replaceChildren(document.images[4])");
      await until(() => shown(10, 10) === "0000ff");`;
    expect(await show(html, main, "document.images[0].remove(); return last")).toEqual([["ff0000"]]);
  });

  test("the wheel moves the page, but not what is fixed or sticks", async () => {
    const html = `${style}<i style="position: fixed; top: 0; width: 20px; height: 20px; background: #000"></i>
      <b style="display: block; position: sticky; top: 10px; margin: 50px 0 -70px 40px; width: 20px; height: 20px; background: #fff"></b>${rows}`;
    const main = `await until(showsPage); ${wheel(100, 50, 200)} await until(() => shown(100, 50) === "0000ff");`;
    const script = `while (scrollY < 200) await new Promise(requestAnimationFrame); return scrollY;`;
    expect(
      await show(html, main, script, [
        [10, 10],
        [50, 20],
        [100, 5],
        [100, 95],
      ]),
    ).toEqual([200, "000000", "ffffff", "0000ff", "0000ff"]);
  });

  test("a scroller hands on what it cannot use, unless it is told not to", async () => {
    const box = (id: string, more = "") =>
      `<div id=${id} style="float: left; width: 50px; height: 100px; overflow: auto; ${more}"><p></p><p style="background: #000"></p></div>`;
    const html = `${style}${box("a")}${box("b", "overscroll-behavior: contain")}${rows}`;
    const main = `await until(showsPage);
      ${wheel(75, 50, 100)} await until(() => shown(75, 5) === "000000");
      ${wheel(75, 50, 100)}
      ${wheel(25, 50, 100)} await until(() => shown(25, 5) === "000000");
      await until(() => page.executeJavaScript("(seen = [a.scrollTop, b.scrollTop, scrollY])[0] === 100"));
      ${wheel(25, 80, 100)} await until(() => shown(150, 5) === "00ff00");`;
    expect(await show(html, main, "return seen")).toEqual([[100, 100, 0]]);
  });

  test("a listener can keep the wheel for itself", async () => {
    const html = `${style}${rows}<script>turns = 0; addEventListener("wheel", event => ++turns === 1 && event.preventDefault(), { passive: false })</script>`;
    const main = `await until(showsPage);
      ${wheel(100, 50, 200)} await until(() => page.executeJavaScript("turns === 1"));
      ${wheel(100, 50, 100)} await until(() => shown(100, 5) !== "ff0000");`;
    const script = `while (scrollY < 100) await new Promise(requestAnimationFrame); return scrollY;`;
    expect(await show(html, main, script, [[100, 50]])).toEqual([100, "00ff00"]);
  });

  test("a smooth scroll passes what is on its way", async () => {
    const main = `await until(showsPage);
      const seen = new Set();
      page.executeJavaScript("scrollTo({ top: 500, behavior: 'smooth' })");
      await until(() => seen.add(shown(100, 1)).has("ff00ff"));
      if (seen.size < 3) throw new Error("it has jumped: " + [...seen]);`;
    expect(
      await show(style + rows, main, "while (scrollY < 500) await new Promise(requestAnimationFrame); return scrollY", [
        [100, 99],
      ]),
    ).toEqual([500, "ff00ff"]);
  });

  test("the caret blinks in a frame", async () => {
    const html = `<iframe style="border: 0" srcdoc="<body style='margin: 0'><input style='all: unset; font-size: 40px; caret-color: #f00'>"></iframe>`;
    const main = `window.focus();
      await page.executeJavaScript("frames[0].document.querySelector('input').focus()");
      await until(() => shown(0, 20) === "ff0000");
      await until(() => shown(0, 20) === "ffffff");`;
    expect(await show(html, main, "frames[0].document.activeElement.blur()", [[0, 20]])).toEqual([null, "ffffff"]);
  });

  test("an animated image plays in a frame", async () => {
    const gif =
      "R0lGODlhAQABAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAAQABAAACAkQBACH5BAAFAAAALAAAAAABAAEAAAICTAEAOw==";
    const html = `<iframe style="border: 0" srcdoc="<body style='margin: 0'><img width=40 height=40 src='data:image/gif;base64,${gif}'>"></iframe>`;
    const main = `for (const color of ["ff0000", "0000ff", "ff0000"]) await until(() => shown(20, 20) === color);`;
    expect(await show(html, main, "frames[0].document.images[0].remove()", [[20, 20]])).toEqual([null, "ffffff"]);
  });

  test("transforms and opacity are animated without scripts", async () => {
    const html = `<style>i { position: absolute; width: 20px; height: 20px; background: #000; transition: 300ms linear } .moved #a { translate: 100px } .moved #b { opacity: .2 }</style>
      <i id=a></i><i id=b style="top: 50px"></i>`;
    const main = `await until(showsPage);
      const [places, shades] = [new Set(), new Set()];
      page.executeJavaScript("document.body.className = 'moved'");
      await until(() => {
        const { x, y } = window.getContentBounds();
        places.add(grab({ x, y: y + 10, width: 200, height: 1 }).findIndex((value, index) => index % 4 === 0 && value < 128) / 4);
        return shades.add(shown(10, 60)).has("cccccc") && places.has(100);
      });
      if (places.size < 4 || shades.size < 4) throw new Error("it has jumped: " + [...places, ...shades]);`;
    const script = `await Promise.all(document.getAnimations().map(it => it.finished)); return [a.getBoundingClientRect().x, getComputedStyle(b).opacity];`;
    expect(
      await show(html, main, script, [
        [10, 10],
        [110, 10],
        [10, 60],
      ]),
    ).toEqual([[100, "0.2"], "ffffff", "000000", "cccccc"]);
  });

  test("elements that fade almost alike", async () => {
    const fades = [
      ["", "{ opacity: [.2, .2] }, 1e7"],
      ["", "{ opacity: [.6, .6] }, 1e7"],
      ["opacity: .2", "{ opacity: 1 }, 1e7"],
      ["opacity: .6", "{ opacity: 1 }, 1e7"],
      ["", "{ opacity: [.2, .6] }, { duration: 1e7 }"],
      ["", "{ opacity: [.2, .6] }, { duration: 1e7, direction: 'reverse' }"],
      ["", "{ opacity: [.2, .6], easing: 'step-end' }, 1e7"],
      ["", "{ opacity: [.2, .6], easing: 'step-start' }, 1e7"],
    ];
    const html = fades
      .map(
        ([style], index) =>
          `<i style="position: absolute; left: ${index * 20}px; width: 20px; height: 20px; background: #000; ${style}"></i>`,
      )
      .join("");
    const script = `await Promise.all([${fades.map(([, how], index) => `document.body.children[${index}].animate(${how}).ready`)}]); await new Promise(requestAnimationFrame);`;
    const points = fades.map((_, index) => [index * 20 + 10, 10]);
    expect(await show(html, "await until(showsPage)", script, points)).toEqual([
      null,
      ...fades.map((_, index) => (index % 2 ? "666666" : "cccccc")),
    ]);
  });

  test("the region that is last in the tree decides whether a press drags the window", async () => {
    const html = `<style>i { position: absolute; width: 50px; height: 50px }</style>
      <i id=a style="z-index: 1; app-region: drag"></i><i id=b style="z-index: 2; app-region: no-drag; background: #000"></i>
      <script>seen = []; onmousedown = event => seen.push(event.clientX)</script>`;
    const press = (x: number) =>
      `for (const type of ["mouseDown", "mouseUp"]) window.sendInputEvent({ type, x: ${x}, y: 10, button: "left" });`;
    const move = (
      id: string,
      color: string,
    ) => `await page.executeJavaScript("document.body.append(${id}); b.style.background = '#${color}'");
      await until(() => shown(10, 10) === "${color}");`;
    const main = `await until(showsPage); ${press(10)} await until(() => page.executeJavaScript("seen.includes(10)"));
      ${move("a", "0000ff")} ${press(20)} ${press(100)} await until(() => page.executeJavaScript("seen.includes(100)"));
      ${move("b", "00ff00")} ${press(30)} await until(() => page.executeJavaScript("seen.includes(30)"));`;
    expect(await show(html, main, "return seen")).toEqual([[10, 100, 30]]);
  });

  test("an animation that is paused, moved, reversed and canceled", async () => {
    const html = `<i id=a style="position: absolute; width: 20px; height: 20px; background: #000"></i>`;
    const main = `await until(showsPage);
      await page.executeJavaScript("it = a.animate({ transform: ['none', 'translateX(100px)'] }, { duration: 1e5, fill: 'both' }); it.pause(); it.currentTime = 5e4; 0");
      await until(() => shown(60, 10) === "000000" && shown(45, 10) === "ffffff" && shown(75, 10) === "ffffff");
      await page.executeJavaScript("it.updatePlaybackRate(-500); it.play(); it.finished.then(() => 0)");
      await until(() => shown(5, 10) === "000000" && shown(25, 10) === "ffffff");
      await page.executeJavaScript("it.playbackRate = 1; it.finish(); 0");
      await until(() => shown(110, 10) === "000000");
      await page.executeJavaScript("it.cancel()");`;
    expect(
      await show(html, main, "await new Promise(requestAnimationFrame)", [
        [10, 10],
        [110, 10],
      ]),
    ).toEqual([null, "000000", "ffffff"]);
  });

  test("what changes while it is scrolled, under a backdrop filter", async () => {
    const html = `${style}<i style="position: fixed; inset: 0 0 auto; height: 30px; backdrop-filter: invert(1)"></i>${rows}`;
    const main = `await until(showsPage);
      ${wheel(100, 50, 100)} await until(() => shown(100, 50) === "00ff00");
      await page.executeJavaScript("document.querySelectorAll('p')[1].style.background = '#000'");
      await until(() => shown(100, 50) === "000000");`;
    expect(
      await show(html, main, "", [
        [100, 10],
        [100, 50],
      ]),
    ).toEqual([null, "ffffff", "000000"]);
  });

  test("a window has the bounds that it was just given", async () => {
    const main = `await until(showsPage);
      window.setResizable(false);
      window.setSize(300, 200);
      const size = window.getSize();
      window.center();
      const seen = [size, window.getBounds()];
      await until(() => page.executeJavaScript("innerWidth === 300"));
      await page.executeJavaScript("seen = " + JSON.stringify([...seen, window.getBounds()]));`;
    const centered = { ...(where === "Wayland" ? { x: 0, y: 0 } : { x: 100, y: 100 }), width: 300, height: 200 };
    expect(await show("", main, "return seen")).toEqual([[[300, 200], centered, centered]]);
  });

  test("a window that is resized, hidden and shown", async () => {
    const html = `<i style="position: fixed; right: 0; bottom: 0; width: 20px; height: 20px; background: #000"></i>`;
    const main = `await until(showsPage);
      for (const size of [[300, 200], [120, 60], [260, 140]]) {
        window.setContentSize(...size);
        await until(() => shown(size[0] - 30, size[1] - 10) === "ffffff" && shown(size[0] - 10, size[1] - 10) === "000000");
      }
      window.hide();
      await until(() => shown(10, 10) === "000000");
      await page.executeJavaScript("document.body.style.background = '#0f0'");
      window.show();`;
    expect(
      await show(html, main, "await new Promise(requestAnimationFrame); return [innerWidth, innerHeight]", [
        [10, 10],
        [250, 130],
      ]),
    ).toEqual([[260, 140], "00ff00", "000000"]);
  });

  test.each([
    ["sizes", "window.setContentSize(200 + step, 100)", "innerWidth === 200 + step"],
    [
      "keys",
      "for (const type of ['keyDown', 'keyUp']) window.sendInputEvent({ type, keyCode: 'Left' })",
      "keys === step",
    ],
  ])("a loop of animation frames does not speed up for %s", async (_, act, isDone) => {
    const html = `<script>frames = keys = 0; onkeyup = () => keys++; (function next() { frames++; requestAnimationFrame(next); })()</script>`;
    const main = `for (const type of ["mouseDown", "mouseUp"]) window.sendInputEvent({ type, x: 1, y: 1 });
      await until(() => page.executeJavaScript("frames > 30"));
      await page.executeJavaScript("first = frames; start = performance.now()");
      for (let step = 1; step <= 20; step++) {
        ${act};
        await until(() => page.executeJavaScript("step = " + step + "; ${isDone}"));
        await page.executeJavaScript("new Promise(done => { const now = frames; (function wait() { frames > now ? done() : setTimeout(wait); })(); })");
      }`;
    const [extra] = await show(html, main, "return frames - first - (performance.now() - start) / (1000 / 60)");
    expect(extra).toBeLessThan(30);
  });
});

describe.skipIf(!hasLibrary).concurrent("canvas", () => {
  test("a style keeps the space of its color", async () => {
    const script = `
      const context = new OffscreenCanvas(1, 1).getContext("2d");
      context.fillStyle = "color-mix(in srgb, red, blue)";
      context.strokeStyle = "color(display-p3 1 0 1)";
      return [context.fillStyle, context.strokeStyle];`;
    expect(await render("", script)).toEqual([["color(srgb 0.5 0 0.5)", "color(display-p3 1 0 1)"]]);
  });

  test("the image of SVG is a source, and an image without pixels makes no pattern", async () => {
    const script = `
      const file = (width, height) =>
        "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="9" height="9" fill="#0f0"/></svg>');
      const [image, empty] = [document.createElementNS("http://www.w3.org/2000/svg", "image"), new Image()];
      const context = new OffscreenCanvas(1, 1).getContext("2d");
      const before = context.createPattern(image, "repeat");
      image.setAttribute("href", file(4, 4));
      empty.src = file(0, 4);
      await Promise.all([image.decode(), empty.decode()]);
      context.drawImage(image, 0, 0);
      return [before, context.createPattern(empty, "repeat"), ...context.getImageData(0, 0, 1, 1).data];`;
    expect(await render("", script)).toEqual([[null, null, 0, 255, 0, 255]]);
  });

  test("a saved state holds its gradients, and their prototypes are those of the IDL", async () => {
    const script = `
      const context = new OffscreenCanvas(1, 1).getContext("2d");
      for (let i = 0; i < 50; i++) {
        context.fillStyle = Object.assign(context.createLinearGradient(0, 0, 1, 0), { i });
        context.fillStyle.addColorStop(0, "#00f");
        context.save();
      }
      context.fillStyle = "red";
      for (let i = 0; i < 2000; i++) new ImageData(256, 256);
      const seen = [];
      for (let i = 0; i < 50; i++) context.restore(), seen.push(context.fillStyle.i);
      context.fillRect(0, 0, 1, 1);
      const isNative = /native code/.test(Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "lineWidth").get);
      let error;
      try { CanvasRenderingContext2D.prototype.fill.call(new Path2D()); } catch (thrown) { error = thrown.name; }
      return [seen.join() === [...seen.keys()].reverse().join(), ...context.getImageData(0, 0, 1, 1).data, isNative, error, Reflect.ownKeys(context).length];`;
    expect(await render("", script)).toEqual([[true, 0, 0, 255, 255, true, "TypeError", 0]]);
  });
});

const hasGPU = isMacOS
  ? process.arch === "arm64"
  : isLinux &&
    ["/usr/lib64", "/usr/lib", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"].some(it =>
      existsSync(it + "/libEGL_mesa.so.0"),
    );

describe.skipIf(!hasLibrary || !hasGPU).concurrent("a canvas that the GPU draws", () => {
  const onGPU = (where: string, html: string, script: string, points: number[][] = []) =>
    renderTo(where, html, script, points, 1, "", { BUN_DESKTOP_RENDERER: "gpu" });
  const prelude = `
    const both = (draw, alpha) => [false, true].map(willReadFrequently => {
      const context = new OffscreenCanvas(120, 80).getContext("2d", { willReadFrequently, alpha });
      draw(context, context.canvas);
      return context.getImageData(0, 0, 120, 80).data;
    });
    const gradient = it => (it.addColorStop(0, "#f00"), it.addColorStop(0.4, "#0f08"), it.addColorStop(1, "#00f"), it);
    const picture = (width, height, willReadFrequently) => {
      const it = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently });
      for (let i = 0; i < 16; i++) (it.fillStyle = ["#f00", "#0f0", "#00f8", "#ff0"][(i + (i >> 2)) % 4]), it.fillRect(((i % 4) * width) / 4, ((i >> 2) * height) / 4, width / 4, height / 4);
      return it.canvas;
    };
    const star = new Path2D("M40 5L62 72L5 30L75 30L18 72z");`;

  test("takes samples of edges, unless it is read often", async () => {
    const script = `${prelude}
      return both(it => (it.arc(60, 40, 33, 0, 4), it.fill())).map(data => new Set(data.filter((_, at) => at % 4 === 3)).size);`;
    const [[sampled, exact]] = await onGPU("memory", "", script);
    expect([sampled, exact > 20]).toEqual([5, true]);
  });

  test.skipIf(!isLinux)("is left to the CPU in a process that cannot make memory executable", async () => {
    const main = `
      const libc = require("bun:ffi").dlopen(${JSON.stringify(libcPathForDlopen())}, { prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" } });
      const PR_SET_MDWE = 65;
      await page.executeJavaScript("isRefused = " + (libc.symbols.prctl(PR_SET_MDWE, 1, 0, 0, 0) === 0));`;
    const script = `${prelude}
      const [first, second] = both(it => (it.arc(60, 40, 33, 0, 4), it.fill()));
      return first.every((value, at) => value === second[at]) === isRefused;`;
    expect(await renderTo("memory", "", script, [], 1, main, { BUN_DESKTOP_RENDERER: "gpu" })).toEqual([true]);
  });

  test.each([
    ["fills", `it.fillStyle = "#08f8"; it.fill(star); it.translate(40, 0); it.fill(star, "evenodd")`],
    [
      "strokes that cross themselves",
      `it.strokeStyle = "#f008"; it.lineWidth = 9; for (it.lineJoin of ["miter", "round", "bevel"]) it.stroke(star), it.translate(20, 0)`,
    ],
    [
      "caps",
      `it.lineWidth = 12; for (it.lineCap of ["butt", "round", "square"]) it.stroke(new Path2D("M20 15C40 0 60 40 100 15")), it.stroke(new Path2D("M20 25L100 28")), it.translate(0, 22)`,
    ],
    [
      "dashes",
      `it.lineWidth = 4; it.setLineDash([9, 5]); it.lineDashOffset = 3; it.arc(60, 40, 30, 0, 7); it.stroke(); it.strokeRect(5, 5, 110, 70)`,
    ],
    [
      "thin lines",
      `it.lineWidth = 0.5; it.stroke(new Path2D("M5 9H70V60")); it.lineWidth = 1; for (let x = 80.5; x < 120; x += 5) it.beginPath(), it.moveTo(x, 0), it.lineTo(x, 80), it.stroke()`,
    ],
    ["a pen that is wider than the curve", `it.lineWidth = 60; it.arc(60, 40, 5, 0, -Math.PI / 2, true); it.stroke()`],
    [
      "a pen that is distorted",
      `it.setTransform(2, 0.3, -0.4, 0.7, 20, 0); it.lineWidth = 8; it.arc(25, 40, 15, 0, 5); it.stroke()`,
    ],
    [
      "gradients",
      `it.fillStyle = gradient(it.createLinearGradient(5, 5, 35, 70)); it.fillRect(0, 0, 40, 80); it.fillStyle = gradient(it.createRadialGradient(55, 30, 3, 60, 40, 30)); it.fillRect(40, 0, 40, 80);
      it.strokeStyle = gradient(it.createConicGradient(1, 100, 40)); it.lineWidth = 15; it.arc(100, 40, 10, 0, 7); it.stroke()`,
    ],
    [
      "rectangles",
      `it.fillStyle = "#080"; it.fillRect(0, 0, 120, 80); it.clearRect(10, 10, 30, 30); it.clearRect(50.5, 10.5, 9, 9); it.fillStyle = "#fff8"; it.fillRect(20.25, 20.5, 50, 30.5); it.rotate(0.3); it.fillRect(60, 10, 40, 20)`,
    ],
    [
      "clips",
      `it.save(); it.rect(10, 10, 50, 40); it.clip(); it.fill(star); it.restore(); it.translate(40, 0); it.clip(star); it.fillStyle = "#00f"; it.fillRect(0, 20, 99, 30)`,
    ],
    [
      "what covers what",
      `for (let i = 0; i < 300; i++) it.fillStyle = ["#f00", "#0f08", "#00f"][i % 3], it.beginPath(), it.arc(i * 37 % 120, i * 53 % 80, 5 + i % 20, 0, 7), it.fill()`,
    ],
    [
      "more than fits in a pass",
      `it.lineWidth = 2; const steps = new Path2D("M0 0H9V9H19V19H29V29H39"); for (let i = 0; i < 20000; i++) it.strokeStyle = i % 2 ? "#f00" : "#00f1", it.setTransform(1, 0, 0, 1, i * 7 % 80, i * 3 % 50), it.stroke(steps)`,
    ],
    [
      "operators",
      `for (it.globalCompositeOperation of ["source-over", "lighter", "destination-out", "multiply", "xor", "destination-over", "source-atop"]) it.fillStyle = "#3c98", it.fill(star), it.translate(6, 0)`,
    ],
    [
      "operators that clear",
      `it.fillRect(0, 0, 120, 60); it.globalCompositeOperation = "destination-in"; it.fill(star); it.globalCompositeOperation = "source-over"; it.stroke(star)`,
    ],
    [
      "shadows and filters",
      `it.fill(star); it.shadowColor = "#f00"; it.shadowBlur = 6; it.shadowOffsetX = 4; it.fillRect(70, 10, 20, 20); it.shadowColor = "#0000"; it.filter = "blur(2px)"; it.fillRect(70, 50, 20, 20)`,
    ],
    [
      "text",
      `it.fill(star); it.font = "20px sans-serif"; it.fillStyle = "#f00"; it.fillText("Hello", 50, 30); it.strokeText("Hi", 70, 70); it.rotate(0.2); it.fillText("you", 60, 40)`,
    ],
    [
      "itself",
      `it.fillStyle = "#f00"; it.fill(star); it.drawImage(canvas, 40, 0); it.fillStyle = "#00f"; it.fill(star); it.drawImage(canvas, 0, 0, 120, 80, 60, 40, 60, 40)`,
    ],
    [
      "images that are turned or reduced",
      `it.rotate(0.3); it.drawImage(picture(20, 20, true), 30, 0); it.drawImage(picture(400, 400, true), 60, 0, 40, 40); it.drawImage(picture(40, 40, false), 30, 30, 36, 36)`,
    ],
    [
      "pixels that are read and written",
      `it.fill(star); it.putImageData(it.getImageData(20, 20, 40, 40), 75, 5); it.strokeStyle = "#0f0"; it.lineWidth = 5; it.stroke(star)`,
    ],
    [
      "another size",
      `it.fill(star); canvas.width = 60; it.fill(star); canvas.width = 120; it.stroke(star); it.reset(); it.fillStyle = "#f0f"; it.fill(star)`,
    ],
  ])("has the pixels that the CPU makes: %s", async (_, draw) => {
    const script = `${prelude}
      const [gpu, cpu] = both((it, canvas) => { ${draw} });
      let [painted, edges, far] = [0, 0, 0];
      for (let at = 0; at < cpu.length; at += 4) {
        const off = Math.max(...[0, 1, 2, 3].map(it => Math.abs((gpu[at + it] * (it < 3 ? gpu[at + 3] : 255) - cpu[at + it] * (it < 3 ? cpu[at + 3] : 255)) / 255)));
        painted += cpu[at + 3] > 0, edges += off > 4, far += off > 100;
      }
      return [painted > 200, edges < painted / 2, far];`;
    expect(await onGPU("memory", "", script)).toEqual([[true, true, 0]]);
  });

  const operators =
    "source-over source-in source-out source-atop destination-over destination-in destination-out destination-atop lighter copy xor multiply screen overlay darken lighten color-dodge color-burn hard-light soft-light difference exclusion hue saturation color luminosity clear";
  test.each([
    [
      "operators",
      `for (const [i, operator] of "${operators}".split(" ").entries()) {
      it.setTransform(1, 0, 0, 1, i % 9 * 13, (i / 9 | 0) * 26); it.drawImage(picture(12, 16, true), 0, 0);
      for (const [clip, draw] of [["M0 0H4V25H0z", () => it.fillRect(1, 5, 2, 15)], ["M4 0H8V25H4z", () => it.drawImage(picture(4, 8, true), 5, 12)], ["M8 0L12 2V25L8 20z", () => it.fill(new Path2D("M8 4H12V22H8zM9 9H11V14H9z"), "evenodd")]])
        it.save(), it.clip(new Path2D(clip)), (it.globalCompositeOperation = operator), (it.fillStyle = "#3c98"), draw(), it.restore();
    }`,
    ],
    [
      "parts of images",
      `it.drawImage(picture(40, 40, true), 3, 4); it.drawImage(picture(200, 200, true), 20, 20, 40, 40, 50, -10, 40, 40); it.globalAlpha = 0.5; it.drawImage(picture(200, 200, false), 120, 20, 40, 40, 95, 50, 40, 40)`,
    ],
    [
      "images that are enlarged or mirrored",
      `it.drawImage(picture(8, 8, true), 3.5, 4.5, 30, 60); it.imageSmoothingEnabled = false; it.drawImage(picture(8, 8, true), 40, 4, 32, 64); it.scale(-1, -1); it.drawImage(picture(200, 200, true), 40, 40, 30, 30, -115, -70, 30, 30)`,
    ],
    [
      "an image that changes",
      `const from = picture(200, 200, true); for (let i = 0; i < 6; i++) from.getContext("2d").clearRect(i * 3, 0, 2, 9), it.drawImage(from, 0, 0, 20, 70, i * 20, 5, 20, 70); it.drawImage(from, 90, 90, 20, 20, 0, 0, 20, 20)`,
    ],
    [
      "a small canvas that stays as it is",
      `const from = picture(20, 20, true); it.drawImage(from, 5, 5); it.getImageData(0, 0, 1, 1); it.drawImage(picture(40, 8, true), 60, 5); it.drawImage(from, 5, 40)`,
    ],
    [
      "a canvas of the GPU that changes",
      `const from = picture(20, 70, false); for (let i = 0; i < 6; i++) from.getContext("2d").clearRect(i * 3, 0, 2, 9), it.drawImage(from, i * 20, 5)`,
    ],
    [
      "patterns",
      `for (const [side, repetition] of [[12, "repeat"], [12, "repeat-x"], [12, "repeat-y"], [132, "no-repeat"]]) it.fillStyle = it.createPattern(picture(side, side, true), repetition), it.fillRect(-10, -10, 29, 80), it.translate(30, 5)`,
    ],
    [
      "glyphs",
      `it.font = "20px sans-serif"; it.fillStyle = "#f008"; it.fillText("Hello", 5.3, 20); it.fillStyle = gradient(it.createLinearGradient(0, 0, 120, 0)); it.fillText("gradient", 5, 45); it.rect(10, 55, 60, 12); it.clip(); it.fillText("clipped", 5, 70)`,
    ],
    [
      "more glyphs than fit in a pass",
      `it.font = "250px sans-serif"; it.letterSpacing = "-139.7px"; it.fillStyle = "#00f1"; for (let i = 0; i < 9; i++) it.fillText(String.fromCharCode(...Array.from({ length: 250 }, (_, at) => 192 + at)), i / 4 - 20, 150 + i)`,
    ],
    [
      "pixels that stick out",
      `it.drawImage(picture(120, 80, true), 0, 0); const pixels = it.getImageData(10, 10, 70, 50); it.putImageData(pixels, -30, -20); it.putImageData(pixels, 90, 60); it.putImageData(pixels, 200, 0); it.fillRect(50, 30, 9, 9); it.putImageData(it.getImageData(0, 0, 120, 80), 0, 0)`,
    ],
    [
      "parts that are read in turn",
      `it.clearRect(0, 0, 120, 80); it.drawImage(picture(120, 80, true), 0, 0); const parts = [0, 40, 80].map(x => it.getImageData(x, 20, 30, 50)); it.clearRect(0, 0, 120, 80); parts.forEach((part, at) => it.putImageData(part, 85 - at * 40, 5))`,
    ],
    [
      "what a mask clips",
      `it.clip(star); it.drawImage(picture(60, 60, true), 3, 4); it.font = "20px sans-serif"; it.fillText("Hello", 15, 45); it.clearRect(30, 20, 10, 40)`,
    ],
    [
      "many clips",
      `for (let i = 0; i < 200; i++) it.save(), it.beginPath(), it.rect(i % 20 * 6, (i / 20 | 0) * 8, 5, 7), it.clip(), (it.fillStyle = i % 3 ? "#f008" : "#00f"), it.fill(new Path2D("M9 9H99V70H9z")), it.restore(), i % 7 || it.fillRect(i % 100, 40, 9, 9)`,
    ],
    [
      "shadows",
      `it.shadowColor = "#f00"; it.shadowBlur = 6; it.shadowOffsetX = 4; it.fill(star); it.drawImage(picture(20, 20, true), 80, 4); it.fillText("shadow", 70, 60)`,
    ],
  ])("has the very pixels that the CPU makes: %s", async (_, draw) => {
    const script = `${prelude}
      return [true, false].map(alpha => {
        const [gpu, cpu] = both(it => { ${draw} }, alpha);
        const on = (data, at) => (at % 4 < 3 ? (data[at] * data[at | 3]) / 255 : data[at]);
        return [new Set(new Uint32Array(cpu.buffer)).size > 2, cpu.filter((_, at) => Math.abs(on(gpu, at) - on(cpu, at)) > 3).length];
      });`;
    expect(await onGPU("memory", "", script)).toEqual([
      [
        [true, 0],
        [true, 0],
      ],
    ]);
  });

  test.each(["memory", ...screens])("is shown in %s, in a frame and under other things", async where => {
    const html = `<canvas id=a width=40 height=40 style="position: absolute"></canvas><canvas id=b width=40 height=40 style="position: absolute; left: 50px; background: #ff0"></canvas>
      <div style="position: absolute; left: 50px; width: 9px; height: 9px; background: #0ff"></div><iframe id=f style="position: absolute; left: 100px; border: 0" width=40 height=40></iframe>`;
    const script = `
      f.contentDocument.body.innerHTML = "<canvas width=40 height=40 style='position: absolute; inset: 0'></canvas>";
      for (const color of ["#f00", "#0f0", "#00f"]) {
        for (const it of [a, b, f.contentDocument.body.firstChild].map(it => it.getContext("2d"))) {
          it.clearRect(0, 0, 40, 40), (it.fillStyle = color), it.beginPath(), it.arc(15, 15, 15, 0, 7), it.fill();
        }
        await new Promise(requestAnimationFrame);
      }`;
    expect(
      await onGPU(where, html, script, [
        [15, 15],
        [65, 15],
        [115, 15],
        [57, 7],
        [85, 35],
        [35, 35],
      ]),
    ).toEqual([null, "0000ff", "0000ff", "0000ff", "00ffff", "ffff00", "ffffff"]);
  });
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

  test("a face does not get what was shaped with another one", async () => {
    const script = `${prelude}
      const narrow = fonts[0].slice(), view = new DataView(narrow.buffer), tables = {};
      for (let at = 12; at < 12 + view.getUint16(4) * 16; at += 16) tables[String.fromCharCode(...narrow.subarray(at, at + 4))] = view.getUint32(at + 8);
      for (let i = 0; i < view.getUint16(tables.hhea + 34); i++) view.setUint16(tables.hmtx + i * 4, 100);
      for (const face of [new FontFace("a", fonts[0]), new FontFace("b", narrow)]) document.fonts.add(await face.load());
      const width = (style, textContent) => Object.assign(document.body.appendChild(document.createElement("p")), { style: "float: left;" + style, textContent }).offsetWidth;
      const crafted = "font: 10px b; font-feature-settings: 'aaaa' 1049163, 'bbbb' 1048439, 'cccc' 1029294, 'dddd' 1034851";
      return [width("font: 10px a", "A"), width("font: 10px b", "A"), width(crafted, "000"), width("font: 10px a", "000")];`;
    expect(await render("", script)).toEqual([[6, 1, 3, 18]]);
  });

  test.skipIf(!isMacOS)("the fonts that macOS adds are those of Chromium", async () => {
    const script = `
      const size = ([font, textContent, lang = ""]) => {
        const { width, height } = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position: absolute; white-space: pre; font:" + font, textContent, lang }).getBoundingClientRect();
        return Math.round(width) + "x" + height;
      };
      const all = [["14px serif", "🙂"], ["20px serif", "🙂"], ["32px serif", "🙂"], ["14px serif", "한글"], ["14px sans-serif", "한글"], ["16px Menlo", "עברית"], ["16px missing", "Hamburgefonstiv 0123", "ja"], ["16px missing", "Hamburgefonstiv 0123"]];
      return all.map(size);`;
    expect(await render("<meta charset=utf-8>", script)).toEqual([
      ["18x23", "22x29", "32x42", "28x17", "24x17", "48x20", "185x24", "148x18"],
    ]);
  });

  test("faces are chosen by their slope", async () => {
    const script = `${prelude}
      for (const [family, angle, size] of [["a", 40, 1], ["a", -20, 2], ["b", -60, 3], ["b", 1, 4], ["c", 5, 1], ["c", 30, 2]])
        document.fonts.add(await new FontFace(family, fonts[0], { style: "oblique " + angle + "deg", sizeAdjust: size + "00%" }).load());
      const width = font => Object.assign(document.body.appendChild(document.createElement("span")), { style: "font:" + font, textContent: "00" }).offsetWidth;
      const matches = async font => (await document.fonts.load(font)).map(it => it.style).join();
      const wanted = ["10px a", "oblique -5deg 10px b", "oblique 13deg 10px c", "oblique 14deg 10px c"];
      return [wanted.map(width), await Promise.all(wanted.map(matches))];`;
    expect(await render("", script)).toEqual([[[12, 37, 12, 24], [40, -60, 5, 30].map(it => `oblique ${it}deg`)]]);
  });

  test("a face is loaded for a character that was added to a text", async () => {
    const script = `
      const text = document.querySelector("p").firstChild;
      document.body.offsetHeight, text.appendData("é"), document.body.offsetHeight;
      document.head.append(Object.assign(document.createElement("style"), { textContent: "@font-face { font-family: a; src: url(data:font/ttf;base64,${font("ttf")}); unicode-range: U+E9 }" }));
      await new Promise(requestAnimationFrame), await document.fonts.ready;
      return [...document.fonts].map(it => it.status);`;
    expect(await render(`<p style="font: 10px a, serif">${"some words ".repeat(30)}</p>`, script)).toEqual([
      ["loaded"],
    ]);
  });

  test("load() answers with an array of the script's own", async () => {
    const script = `${prelude}
      await draw("a", fonts[0]), await draw("a", fonts[0]);
      Object.defineProperty(Array.prototype, "then", { configurable: true, get() { this.fill(0.5); } });
      const { length } = await document.fonts.load("10px a");
      delete Array.prototype.then;
      return length;`;
    expect(await render("", script)).toEqual([2]);
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

  test("glyphs that are made of each other many times over are given up", async () => {
    const script = `${prelude}
      const parts = 60, size = 10 + parts * 6, font = new Uint8Array(fonts[0].length + 1024 * (size + 4)), view = new DataView(font.buffer);
      font.set(fonts[0]);
      const entry = tag => 12 + 16 * [...Array(view.getUint16(4)).keys()].find(i => String.fromCharCode(...font.subarray(12 + i * 16, 16 + i * 16)) === tag);
      const count = view.getUint16(view.getUint32(entry("maxp") + 8) + 4), loca = fonts[0].length, glyf = loca + 4 * (count + 1);
      view.setUint16(view.getUint32(entry("head") + 8) + 50, 1);
      view.setUint32(entry("loca") + 8, loca), view.setUint32(entry("loca") + 12, glyf - loca);
      view.setUint32(entry("glyf") + 8, glyf), view.setUint32(entry("glyf") + 12, count * size);
      const empty = await draw("a", font.slice());
      for (let glyph = 1; glyph < count; glyph++) {
        const at = glyf + (glyph - 1) * size;
        view.setUint32(loca + 4 * (glyph + 1), glyph * size), view.setInt16(at, -1);
        for (let i = 0; i < parts; i++) view.setUint16(at + 10 + i * 6, i + 1 < parts ? 0x22 : 2), view.setUint16(at + 12 + i * 6, glyph % 8 && glyph - 1);
      }
      return (await draw("b", font)) === empty;`;
    expect(await render("", script)).toEqual([true]);
  });
});

describe.skipIf(!hasLibrary).concurrent("text that is edited is laid out like a copy of it", () => {
  const words = "To AVAT office don’t x-1 → (a) “quoted” café ".repeat(9);
  const spans = (name: string) => `<span class="${name}">word </span><b>office</b>, `.repeat(30);
  test.each([
    ["words", "", words],
    ["markup", "", `${words}<code>a.b()</code> <em>${words}</em> z`],
    ["many elements", "", spans("")],
    ["translucent elements", "", spans("faded")],
    ["moved elements", "height: 500px", spans("moved")],
    ["ideographs", "", "日本語の文章、「テスト」です。漢字漢字（株）。“中文”标点 React 42 ".repeat(9)],
    ["emoji", "", "a 👍🏽 b 👨‍👩‍👧 Привет 한국어 🇯🇵 ".repeat(20)],
    ["preserved lines", "white-space: pre-wrap", "\tif (a) <i>return</i> b;\t// and so on and so on\n".repeat(20)],
    ["break-spaces", "white-space: break-spaces", "some  words   and\tspaces ".repeat(20)],
    ["long words", "overflow-wrap: break-word", "a ".repeat(40) + "b".repeat(200)],
  ])("%s", async (_, style, html) => {
    const css = `code { unicode-bidi: isolate; padding: 0 4px } .faded { opacity: .5 } .moved { position: relative; top: 1%; vertical-align: super } .after::after { content: "x y" }`;
    const script = `
      const edited = document.querySelector("p"), range = document.createRange();
      const texts = root => { const all = []; for (const it = document.createTreeWalker(root, 4); it.nextNode(); ) all.push(it.currentNode); return all; };
      const measure = root => {
        const { x, y, height } = root.getBoundingClientRect(), round = it => [it.x - x, it.y - y, it.width].map(it => Math.round(it * 8));
        const letters = texts(root).flatMap(text => Array.from(text.data, (_, at) => (range.setStart(text, at), range.setEnd(text, at + 1), [...range.getClientRects()].map(round))));
        return JSON.stringify([Math.round(height * 8), root.scrollWidth, letters, [...root.children].map(it => [...it.getClientRects()].map(round))]);
      };
      const element = (name, className, textContent) => Object.assign(document.createElement(name), { className, textContent });
      const edits = [
        ...["AV", " fi", "⁄2 ", "」", "。漢", "\\u200d🔥", "\\n", "\\tz", " שלום "].map(it => () => texts(edited).at(-1).appendData(it)),
        () => texts(edited).at(-1).deleteData(texts(edited).at(-1).length - 7, 7),
        () => edited.append(element("span", "faded", "more ")),
        () => edited.lastChild.append(element("b", "moved", "inside")),
        () => (edited.lastChild.className = "after"),
        () => edited.lastChild.append("text"),
        () => edited.append(element("div", "", "block"), "tail"),
        () => (edited.lastChild.remove(), edited.lastChild.remove()),
        () => texts(edited)[0].insertData(3, "wide words "),
        () => texts(edited)[0].deleteData(1, 9),
        () => (edited.parentNode.style.width = "150px", edited.append(" end")),
        () => (edited.innerHTML += "!"),
      ];
      return edits.flatMap((edit, index) => {
        edited.offsetHeight;
        edit();
        const copy = edited.parentNode.appendChild(edited.cloneNode(true)), is = measure(edited) === measure(copy);
        copy.remove();
        return is ? [] : [index];
      })`;
    expect(
      await render(
        `<meta charset=utf-8><style>${css}</style><div style="width: 190px"><p style="font: 14px sans-serif; ${style}">${html}</p></div>`,
        script,
      ),
    ).toEqual([[]]);
  });
});

test.skipIf(!hasLibrary).concurrent.each(["horizontal-tb", "vertical-rl"])(
  "::first-line may part a mark from its letter in %s",
  async mode => {
    const html = `<style>p::first-line { font-size: 20px }</style>
    <p style="writing-mode: ${mode}; inline-size: max-content; font: 10px serif">a<i style="font: 10px serif">&#x301;</i>b c<br><b style="padding-top: 50px">d</b></p>`;
    expect(
      await render(html, `const b = document.querySelector("b"); return [b.offsetWidth > 50, b.offsetHeight > 50]`),
    ).toEqual([[false, true]]);
  },
);

test.skipIf(!hasLibrary).concurrent.each([
  [
    "pre-wrap",
    "<q>aa <q>bbb&#10;</q></q><q></q><q>&#9;c&#10;&#10;</q>d",
    ["0,0,3,2", "0,1,3,1", "0,2,0,1", "0,2,8,2"],
    [5, 6],
  ],
  ["pre-wrap", "aaaaa <q> </q><q></q>a", ["6,0,1,1", "7,0,0,1"], [5, 2]],
  ["pre", "<q>aaa <q>bbb</q>&#10;c</q><q>&#10;</q>", ["0,0,7,2", "4,0,3,1", "1,1,0,1"], [7, 2]],
  ["normal", "<q class=pre>aaa-</q><q class=pre>bb</q>", ["0,0,4,1", "0,1,2,1"], [5, 2]],
])("elements among kept white space in %s: %s", async (space, html, rects, size) => {
  const style = `<style>body, p { margin: 0 } p { font: 20px/20px monospace; width: 5ch; white-space: ${space} } q { quotes: none } q::before, q::after { content: none } .pre { white-space: pre }</style>`;
  const script = `
    const p = document.querySelector("p"), ch = p.getBoundingClientRect().width / 5;
    const cells = it => [it.x / ch, Math.floor(it.y / 20 + 0.5), it.width / ch, it.height / 20].map(Math.round).join();
    return [[...p.querySelectorAll("q")].map(it => cells(it.getBoundingClientRect())), [Math.round(p.scrollWidth / ch), p.offsetHeight / 20]];`;
  expect(await render(`${style}<p>${html}</p>`, script)).toEqual([[rects, size]]);
});

test.skipIf(!hasLibrary).concurrent("control characters are visible, whatever is around them", async () => {
  const script = `
    const text = document.querySelector("p").appendChild(new Text()), range = document.createRange();
    const width = data => ((text.data = data), range.setStart(text, 1), range.setEnd(text, 2), range.getBoundingClientRect().width);
    const expected = width("a\\x01b");
    return [expected > 0, ["\\x1f", "\\x7f", "\\x80", "\\x9f"].flatMap(it => ["a" + it + "b", "é" + it + "é", "\\u2b24" + it]).filter(it => Math.abs(width(it) - expected) > 0.05)];`;
  expect(await render(`<p style="font: 20px serif"></p>`, script)).toEqual([[true, []]]);
});

test.skipIf(!hasLibrary).concurrent("a resizer leaves the size alone that it does not change", async () => {
  const main = `for (const [type, x] of [["mouseMove", 98], ["mouseDown", 98], ["mouseMove", 78], ["mouseUp", 78]]) page.sendInputEvent({ type, x, y: 48, button: "left", modifiers: ["leftbuttondown"] });`;
  const html = `<div style="height: 100px"><p style="margin: 0; width: 100px; height: 50%; overflow: hidden; resize: both"></p></div>`;
  const script = `const { style } = document.querySelector("p"); return [style.width, style.height];`;
  expect(await render(html, script, [], 1, main)).toEqual([["80px", "50%"]]);
});

test
  .skipIf(!hasLibrary)
  .concurrent("content-visibility: auto shows what its clip margin brings into sight", async () => {
    const html = `<body style="height: 9000px"><div style="content-visibility: auto; height: 10px; overflow-clip-margin: 9000px"><p style="margin: 0; height: 9000px; background: #00f">`;
    const script = `scrollTo(0, 2000); for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);`;
    expect(await render(html, script, [[10, 10]])).toEqual([null, "0000ff"]);
  });

test.skipIf(!hasLibrary).concurrent("the rule of nested columns reaches the end of its row", async () => {
  const html = `<div style="columns: 2; gap: 0; height: 40px; column-fill: auto"><div style="columns: 2; gap: 10px; column-rule: 10px solid #00f; height: 80px">${"<p style='margin: 0; height: 20px'></p>".repeat(3)}</div></div>`;
  expect(
    await render(html, "", [
      [50, 10],
      [50, 35],
      [150, 10],
    ]),
  ).toEqual([null, "0000ff", "0000ff", "ffffff"]);
});

test.skipIf(!hasLibrary).concurrent("quotes follow the language", async () => {
  const script = `
    const [changed, expected] = document.querySelectorAll("q");
    changed.offsetWidth, (changed.parentNode.lang = "fr");
    return changed.getBoundingClientRect().width - expected.getBoundingClientRect().width;`;
  expect(await render(`<p lang=en><q lang=de>a</q></p><p lang=fr><q lang=de>a</q></p>`, script)).toEqual([0]);
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
      "many dashes with huge caps",
      `<svg><path d="M0 0H9000" stroke=red stroke-width=9000 stroke-dasharray=".01" stroke-linecap=round /></svg>`,
    ],
    [
      "many huge joins",
      `<svg><path d="M0 0${times("h9v9H0z", 30000)}" stroke=red stroke-width=9000 stroke-linejoin=round /></svg>`,
    ],
    ["dashes that are too small to add up", `<svg><path d="M-1e30 9H1e30" stroke=red stroke-dasharray=1 /></svg>`],
    [
      "many dashes far from the start",
      `<canvas></canvas><script>const it = document.querySelector("canvas").getContext("2d"); it.setLineDash(Array(40000).fill(0.001)); it.moveTo(-2e13, 9); it.lineTo(2e13, 9); it.stroke()</script>`,
    ],
    [
      "huge shadows",
      times(
        `<p style="filter:drop-shadow(0 0 4000px red);box-shadow:0 0 4000px,inset 0 0 4000px;text-shadow:0 0 4000px">a</p>`,
        9,
      ),
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

/** Red and blue by turns. */
function gif(side: number, frames: number, spare = 0) {
  const short = (it: number) => [it & 255, it >> 8];
  const frame = (index: number) => {
    // Each code stands for a run that is longer by one.
    const codes = [4, index % 2, ...Array.from({ length: Math.ceil(Math.sqrt(2) * side) }, (_, i) => i + 6)];
    const bits = codes
      .map(it => it.toString(2).padStart(3, "0"))
      .reverse()
      .join("");
    const data = bits
      .match(/.{1,8}(?=(.{8})*$)/g)!
      .map(it => parseInt(it, 2))
      .reverse();
    const blocks = data.flatMap((it, i) => (i % 255 ? [it] : [Math.min(255, data.length - i), it]));
    return [0x21, 0xf9, 4, 0, 5, 0, 0, 0, 0x2c, 0, 0, 0, 0, ...short(side), ...short(side), 0, 2, ...blocks, 0];
  };
  const header = [...Buffer.from("GIF89a"), ...short(side), ...short(side), 0x80, 0, spare, 255, 0, 0, 0, 0, 255];
  return Buffer.from([...header, ...Array.from({ length: frames }, (_, i) => frame(i)).flat(), 0x3b]);
}

function bmp(width: number, height: number, pixels: number[][]) {
  const bytes = Buffer.alloc(54 + width * height * 3);
  bytes.write("BM");
  [bytes.length, 0, 54, 40, width, height, 1 | (24 << 16)].forEach((it, i) => bytes.writeUInt32LE(it, 2 + i * 4));
  pixels.forEach(([r, g, b], i) => bytes.set([b, g, r], 54 + i * 3));
  return bytes;
}
