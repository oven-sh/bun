import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { hasLibrary } from "./library";
import { hasScreen, openScreen, readScreen } from "./screen";

/** What `script` returns, and the colors that the page then has at `points`. */
const render = renderTo.bind(null, "memory");

/** `main` runs in the app, before `script`. On a screen, what is drawn step by step has to end up like a picture that is painted at once. */
async function renderTo(where: string, html: string, script: string, points: number[][] = [], zoom = 1, main = "") {
  await using screen = where === "a screen" ? await openScreen() : null;
  using dir = tempDir("paint", {
    "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
    "index.html": "<!doctype html><style>body { margin: 0 }</style>" + html,
    "main.js": `
      const { app, BrowserWindow } = require("electron");
      app.setPath("userData", __dirname + "/data");
      app.trustOrigins(["file:"], { injectedScripts: true, inFrames: true });
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
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", ...screen?.env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return JSON.parse(stdout);
}

const svg = (source: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${source}</svg>`)}`;

describe.skipIf(!hasLibrary).concurrent.each(hasScreen ? ["memory", "a screen"] : ["memory"])("paint to %s", where => {
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
    expect(colors.map(it => [...Buffer.from(it, "hex")].map(it => Math.round(it / 16)))).toEqual([
      [8, 0, 8],
      [8, 0, 8],
      [16, 16, 16],
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

describe.skipIf(!hasScreen).concurrent("the compositor", () => {
  const show = (html: string, main: string, script = "", points: number[][] = []) =>
    renderTo("a screen", html, script, points, 1, main);
  const wheel = (x: number, y: number, deltaY: number) => `
    window.sendInputEvent({ type: "mouseMove", x: ${x}, y: ${y} });
    window.sendInputEvent({ type: "mouseWheel", x: ${x}, y: ${y}, deltaX: 0, deltaY: ${deltaY} });`;
  const rows = ["f00", "0f0", "00f", "ff0", "0ff", "f0f"].map(it => `<p style="background: #${it}"></p>`).join("");
  const style = "<style>p { margin: 0; height: 100px } * { scrollbar-width: none }</style>";

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

  test("a window that is resized, hidden and shown", async () => {
    const html = `<i style="position: fixed; right: 0; bottom: 0; width: 20px; height: 20px; background: #000"></i>`;
    const main = `await until(showsPage);
      for (const size of [[300, 200], [120, 60], [260, 140]]) {
        window.setContentSize(...size);
        await until(() => shown(size[0] - 10, size[1] - 10) === "000000" && shown(size[0] - 30, size[1] - 10) === "ffffff");
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

function bmp(width: number, height: number, pixels: number[][]) {
  const bytes = Buffer.alloc(54 + width * height * 3);
  bytes.write("BM");
  [bytes.length, 0, 54, 40, width, height, 1 | (24 << 16)].forEach((it, i) => bytes.writeUInt32LE(it, 2 + i * 4));
  pixels.forEach(([r, g, b], i) => bytes.set([b, g, r], 54 + i * 3));
  return bytes;
}
