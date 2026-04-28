import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isMacOS, isMacOSVersionAtLeast } from "harness";

// Chrome backend works on any platform with Chrome/Chromium installed.
// Mark tests todo if no Chrome found (CI may not have it). Mirrors
// ChromeProcess.zig's findChrome() — $PATH names, then hardcoded absolute
// paths, then Playwright cache — so the test detects Chrome whenever the
// runtime would.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { accessSync, constants as fsConstants, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// shm_unlink for encoding:"shmem" test cleanup. macOS has no /dev/shm
// filesystem mount, so we go through libc. Linux exposes POSIX shm at
// /dev/shm/<name-without-leading-slash> — a plain unlink works.
const libcShm =
  process.platform === "darwin"
    ? dlopen("libc.dylib", {
        shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
      })
    : null;
function shmUnlinkChrome(name: string): void {
  if (process.platform === "darwin") {
    libcShm!.symbols.shm_unlink(ptr(Buffer.from(name + "\0")));
  } else if (process.platform === "linux") {
    rmSync("/dev/shm" + name, { force: true });
  }
}

function findChrome(): string | undefined {
  const isExecutable = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (process.env.BUN_CHROME_PATH) {
    return isExecutable(process.env.BUN_CHROME_PATH) ? process.env.BUN_CHROME_PATH : undefined;
  }

  // $PATH — same as `which google-chrome` etc.
  const names = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge", "chrome"];
  for (const n of names) {
    const found = Bun.which(n);
    if (found) return found;
  }

  // Hardcoded absolute paths — app bundles aren't in $PATH on macOS.
  if (process.platform === "darwin") {
    const bundles = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "Chromium.app/Contents/MacOS/Chromium",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    for (const b of bundles) {
      const sys = join("/Applications", b);
      if (isExecutable(sys)) return sys;
      const user = join(homedir(), "Applications", b);
      if (isExecutable(user)) return user;
    }
  } else if (process.platform === "linux") {
    const absolute = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
    ];
    for (const c of absolute) if (isExecutable(c)) return c;
  } // Windows TODO — ChromeProcess.zig doesn't support it yet

  // Playwright cache fallback — mirrors findPlaywrightShell().
  const cacheDir =
    process.platform === "darwin"
      ? join(homedir(), "Library/Caches/ms-playwright")
      : join(homedir(), ".cache/ms-playwright");
  let bestRev = 0;
  let bestName = "";
  try {
    for (const name of readdirSync(cacheDir)) {
      const m = name.match(/^chromium_headless_shell-(\d+)$/);
      if (m && +m[1] > bestRev) {
        bestRev = +m[1];
        bestName = name;
      }
    }
  } catch {}
  if (!bestRev) return undefined;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const plat = process.platform === "darwin" ? "mac" : "linux";
  const bin = join(cacheDir, bestName, `chrome-headless-shell-${plat}-${arch}`, "chrome-headless-shell");
  if (isExecutable(bin)) return bin;
  if (process.platform === "linux" && process.arch === "arm64") {
    const bin2 = join(cacheDir, bestName, "chrome-linux/headless_shell");
    if (isExecutable(bin2)) return bin2;
  }
  return undefined;
}

const chromePath = findChrome();
// TODO: macOS 13/14 aarch64 CI — findChrome() resolves the Playwright
// chrome-headless-shell, but it either throws ERR_DLOPEN_FAILED at spawn or
// launches and immediately closes the pipe on first navigate. Recent Chromium
// builds link against frameworks only present on macOS 15+, so the binary
// exists but can't run. Gate on CI + macOS < 15 rather than probing — a real
// probe needs an async navigate, which adds startup cost on every platform.
const chromeBroken = isCI && isMacOS && !isMacOSVersionAtLeast(15);
const it = chromePath && !chromeBroken ? test : test.todo;

// url:false forces spawn-mode — skips DevToolsActivePort auto-detect
// which would connect to the dev's running Chrome, pop the "Allow remote
// debugging?" dialog on every test, and create visible tabs. The
// executable path is still auto-found.
//
// WebSocket-transport tests live in webview-chrome-ws.test.ts — the
// Transport singleton means you can't mix pipe-mode (this file) and
// connect-mode in one process.
const chrome = { type: "chrome" as const, url: false as const };

const html = (h: string) => "data:text/html," + encodeURIComponent(h);

it("backend: chrome constructor returns a WebView", () => {
  const view = new Bun.WebView({ backend: chrome, width: 400, height: 300 });
  expect(view).toBeInstanceOf(Bun.WebView);
  view.close();
});

it("chrome: navigate + evaluate round-trip", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 400, height: 300 });
  // First navigate kicks off the Target.createTarget → attachToTarget →
  // Page.enable → Page.navigate chain; awaiting it means the sessionId
  // is established and the load event fired. Subsequent ops go direct.
  await view.navigate(html("<h1 id=t>chrome</h1>"));
  const result = await view.evaluate("document.getElementById('t').textContent");
  expect(result).toBe("chrome");
});

it("chrome: evaluate returns native JS values", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // Runtime.evaluate with returnByValue serializes the result page-side;
  // handleResponse's Method::RuntimeEvaluate arm JSONParses it.
  expect(await view.evaluate("42")).toBe(42);
  expect(await view.evaluate("'hello'")).toBe("hello");
  expect(await view.evaluate("[1, 2, 3]")).toEqual([1, 2, 3]);
  expect(await view.evaluate("({a: 1})")).toEqual({ a: 1 });
  expect(await view.evaluate("null")).toBe(null);
  expect(await view.evaluate("undefined")).toBe(undefined);
  expect(await view.evaluate("true")).toBe(true);
});

it("chrome: evaluate awaits Promises", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // awaitPromise:true + the (async()=>{return await (...)})() wrap.
  expect(await view.evaluate("Promise.resolve(42)")).toBe(42);
  expect(await view.evaluate("new Promise(r => setTimeout(() => r('delayed'), 5))")).toBe("delayed");
  await expect(view.evaluate("Promise.reject(new Error('boom'))")).rejects.toThrow(/boom/);
});

it("chrome: screenshot returns a PNG Blob", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body style='background:red'></body>"));
  const blob = await view.screenshot();
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe("image/png");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // PNG magic: 89 50 4E 47
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50);
  expect(bytes[2]).toBe(0x4e);
  expect(bytes[3]).toBe(0x47);
  // Bun.write accepts the Blob directly — the MIME type carries through.
  expect(blob.size).toBeGreaterThan(100);
});

it("chrome: screenshot format options produce the right magic bytes", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body style='background:linear-gradient(red,blue)'></body>"));

  const jpeg = await view.screenshot({ format: "jpeg", quality: 90 });
  expect(jpeg.type).toBe("image/jpeg");
  const jb = new Uint8Array(await jpeg.arrayBuffer());
  // JPEG magic: FF D8 FF
  expect([jb[0], jb[1], jb[2]]).toEqual([0xff, 0xd8, 0xff]);

  const webp = await view.screenshot({ format: "webp", quality: 80 });
  expect(webp.type).toBe("image/webp");
  const wb = new Uint8Array(await webp.arrayBuffer());
  // WebP magic: "RIFF" <4-byte size> "WEBP"
  expect(String.fromCharCode(wb[0], wb[1], wb[2], wb[3])).toBe("RIFF");
  expect(String.fromCharCode(wb[8], wb[9], wb[10], wb[11])).toBe("WEBP");
});

it("chrome: screenshot encoding options", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body style='background:red'></body>"));

  const buf = await view.screenshot({ encoding: "buffer" });
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf[0]).toBe(0x89); // PNG magic

  // base64 — zero decode (CDP returns base64 natively). Same PNG
  // after we decode it.
  const b64 = await view.screenshot({ encoding: "base64" });
  expect(typeof b64).toBe("string");
  const decoded = Buffer.from(b64, "base64");
  expect(decoded[0]).toBe(0x89);
  expect(decoded[1]).toBe(0x50);

  // shmem — fresh segment written by the parent (Chrome doesn't use
  // shm internally, we create one after decoding). Name uses the
  // bun-chrome- prefix to disambiguate from WebKit's child-created
  // segments.
  if (process.platform !== "win32") {
    const shm = await view.screenshot({ encoding: "shmem" });
    expect(typeof shm.name).toBe("string");
    expect(shm.name.startsWith("/bun-chrome-")).toBe(true);
    expect(shm.size).toBeGreaterThan(100);
    // Clean up — the test owns it since we told the backend not to.
    // Kitty does this in real use after shm_open'ing.
    shmUnlinkChrome(shm.name);
  }
});

it("chrome: cdp() raw passthrough", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body><input id=q value='hello'></body>"));

  // DOM.getDocument → root nodeId. The result shape is documented CDP.
  const doc = await view.cdp<{ root: { nodeId: number } }>("DOM.getDocument");
  expect(typeof doc.root.nodeId).toBe("number");

  // DOM.querySelector chained through the nodeId.
  const { nodeId } = await view.cdp<{ nodeId: number }>("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "#q",
  });
  expect(nodeId).toBeGreaterThan(0);

  // Runtime.evaluate as a sanity check — same mechanism as view.evaluate()
  // but we get the raw CDP result object (including .type).
  const r = await view.cdp<{ result: { type: string; value: string } }>("Runtime.evaluate", {
    expression: "document.querySelector('#q').value",
    returnByValue: true,
  });
  expect(r.result.type).toBe("string");
  expect(r.result.value).toBe("hello");

  // Unknown method rejects with Chrome's -32601.
  await expect(view.cdp("NotADomain.nope")).rejects.toThrow(/wasn't found|method/i);

  // Empty result object (Input.* style) — should resolve {}.
  const empty = await view.cdp<object>("Page.bringToFront");
  expect(empty).toEqual({});
});

it("chrome: cdp() guards — before navigate and params validation", async () => {
  // Chrome before first navigate → no sessionId → INVALID_STATE.
  const crView = new Bun.WebView({ backend: chrome, width: 100, height: 100 });
  try {
    expect(() => crView.cdp("Page.enable")).toThrow(/session.*navigate/i);
    // params validation: non-object rejected before any I/O.
    await crView.navigate(html("<body></body>"));
    expect(() => crView.cdp("Page.enable", 42 as any)).toThrow(/object/);
  } finally {
    crView.close();
  }
});

// Validation throws before any I/O — doesn't need Chrome installed, so
// `test` directly (not the `it` alias that todo-gates on chromePath).
test("chrome: constructor rejects url combined with spawn options", () => {
  expect(
    () =>
      new Bun.WebView({
        backend: { type: "chrome", url: "ws://localhost:9222/devtools/browser/x", path: "/foo" } as any,
      }),
  ).toThrow(/connect mode.*cannot be combined.*spawn/i);
  expect(
    () =>
      new Bun.WebView({
        backend: { type: "chrome", url: "ws://localhost:9222/devtools/browser/x", argv: ["--foo"] } as any,
      }),
  ).toThrow(/connect mode.*cannot be combined.*spawn/i);
});

it("chrome: cdp() enable + addEventListener receives CDP events", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  // First navigate to get a sessionId (cdp() guards before that).
  await view.navigate(html("<body>init</body>"));

  // Network.enable starts streaming. The listener type IS the CDP
  // method name — handleEvent's fallthrough dispatches any
  // non-internal event as a MessageEvent with the params as .data.
  await view.cdp("Network.enable");
  const events: any[] = [];
  const onReq = (e: MessageEvent) => events.push(e.data);
  view.addEventListener("Network.requestWillBeSent", onReq);

  // Second navigate triggers a Network.requestWillBeSent for the
  // data: URL itself. Await resolves on Page.loadEventFired — by
  // then Chrome has sent the Network event (it precedes load).
  await view.navigate(html("<body>second</body>"));

  expect(events.length).toBeGreaterThan(0);
  expect(events[0].request.url).toStartWith("data:text/html");
  expect(typeof events[0].requestId).toBe("string");

  // removeEventListener stops delivery. Third navigate generates
  // more Network events but the count shouldn't grow.
  view.removeEventListener("Network.requestWillBeSent", onReq);
  const before = events.length;
  await view.navigate(html("<body>third</body>"));
  expect(events.length).toBe(before);

  // Unhandled events without a listener are dropped (hasEventListeners
  // check) — no parse, no dispatch. This navigate also fired
  // Network.responseReceived but we never listened for it; no crash,
  // no accumulation.
});

it("chrome: screenshot quality option affects JPEG size", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  // Gradient + text → lossy compression has work to do.
  await view.navigate(
    html("<body style='background:linear-gradient(red,blue);color:white;font-size:40px'>Hello</body>"),
  );
  const lo = await view.screenshot({ format: "jpeg", quality: 10 });
  const hi = await view.screenshot({ format: "jpeg", quality: 95 });
  expect(lo.size).toBeLessThan(hi.size);
});

it("chrome: click dispatches mousedown/mouseup/click", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__ev = [];
        document.addEventListener("mousedown", e => __ev.push("down:"+e.isTrusted), true);
        document.addEventListener("mouseup", e => __ev.push("up:"+e.isTrusted), true);
        document.addEventListener("click", e => __ev.push("click:"+e.isTrusted), true);
      </script>
      <button style="position:fixed;left:0;top:0;width:100px;height:100px">btn</button>
    `),
  );
  // Input.dispatchMouseEvent is sync-reply — Chrome processes the event
  // and THEN replies. No drain-barrier dance needed.
  await view.click(50, 50);
  const events = await view.evaluate("JSON.stringify(window.__ev)");
  expect(JSON.parse(events)).toEqual(["down:true", "up:true", "click:true"]);
});

it("chrome: click(selector) waits for actionability, clicks center", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__ev = [];
        document.addEventListener("click", e => __ev.push({
          trusted: e.isTrusted, x: e.clientX, y: e.clientY, target: e.target.id,
        }), true);
      </script>
      <button id=btn style="position:fixed;left:40px;top:60px;width:100px;height:80px">btn</button>
    `),
  );
  // Same rAF-polled actionability predicate as WKWebView. IIFE with
  // JSON-escaped selector — no injection. Two-phase: Runtime.evaluate →
  // [cx, cy] → Input.dispatchMouseEvent down+up.
  await view.click("#btn");
  const events = await view.evaluate("JSON.stringify(__ev)");
  expect(JSON.parse(events)).toEqual([{ trusted: true, x: 90, y: 100, target: "btn" }]);
});

it("chrome: click(selector) waits for element to appear", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__clicked = 0;
        let n = 0;
        requestAnimationFrame(function tick() {
          if (++n < 3) return requestAnimationFrame(tick);
          const b = document.createElement("button");
          b.id = "late";
          b.onclick = () => __clicked++;
          b.style.cssText = "position:fixed;left:0;top:0;width:50px;height:50px";
          document.body.appendChild(b);
        });
      </script>
    `),
  );
  await view.click("#late");
  expect(await view.evaluate("String(__clicked)")).toBe("1");
});

it("chrome: click(selector) rejects on timeout when obscured", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <button id=under style="position:fixed;left:0;top:0;width:100px;height:100px">under</button>
      <div style="position:fixed;left:0;top:0;width:100px;height:100px;background:red">overlay</div>
    `),
  );
  // elementFromPoint returns the overlay — actionability never passes,
  // the IIFE throws, exceptionDetails carries the message.
  await expect(view.click("#under", { timeout: 200 })).rejects.toThrow(/timeout.*actionable/);
});

it("chrome: scrollTo(selector) scrolls element into view", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <div style="height:2000px"></div>
      <div id=target style="height:100px;background:red">target</div>
    `),
  );
  // scrollIntoView runs page-side — the IIFE waits for the element then
  // calls scrollIntoView atomically. No second CDP roundtrip.
  await view.scrollTo("#target");
  const y = await view.evaluate("window.scrollY");
  expect(y).toBeGreaterThan(1000);
});

it("chrome: type inserts text at focused element", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(html("<input id=i>"));
  // Input.insertText inserts at the caret — need focus first. autofocus
  // only applies on user-initiated loads; for CDP-driven navigation the
  // input may not have focus. Explicit focus via evaluate.
  await view.evaluate("document.getElementById('i').focus()");
  await view.type("hello");
  const val = await view.evaluate("document.getElementById('i').value");
  expect(val).toBe("hello");
});

it("chrome: scroll dispatches wheel event", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(html("<body style='height:2000px'></body>"));
  await view.scroll(0, 100);
  // Input.dispatchMouseEvent's reply means the event was QUEUED — the
  // compositor applies the scroll asynchronously. Playwright's own wheel
  // tests do page.waitForFunction('window.scrollY === 100') for exactly
  // this reason (wheel.spec.ts:56). Our evaluate() awaits a page-side
  // promise; rAF-polling until scrollY > 0 is the same mechanism.
  //
  // Not checking exact value — Chromium on macOS scales deltaY by device
  // pixel ratio (crbug/1324819; Playwright skips delta assertions on
  // mac+chromium for this reason, wheel.spec.ts:26). scrollY > 0 proves
  // the trusted wheel reached the compositor and scrolled.
  const y = await view.evaluate(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 2000;
      requestAnimationFrame(function tick() {
        if (window.scrollY > 0) return resolve(window.scrollY);
        if (performance.now() > deadline) return reject("scrollY never moved");
        requestAnimationFrame(tick);
      });
    })
  `);
  expect(y).toBeGreaterThan(0);
});

// Drag-automation primitives: mouseDown/Up/Move. Chrome's
// Input.dispatchMouseEvent synchronously processes each event and
// replies — the sequence of moves lands on the page before the final
// reply resolves our promise. No coalescing-off flag; Chromium
// aggregates rapid moves at rAF rate (same as real user input), so
// `steps` may emit fewer than N final pointermoves. The down/up/final
// coords always hit.
it("chrome: mouseDown/mouseUp/mouseMove drag sequence", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 400, height: 400 });
  await view.navigate(
    html(`
      <script>
        window.__ev = [];
        for (const t of ["mousedown","mouseup","mousemove","click"]) {
          document.addEventListener(t, e => __ev.push({
            t, x: e.clientX, y: e.clientY, btn: e.button, btns: e.buttons, trusted: e.isTrusted,
          }), true);
        }
      </script>
      <div style="position:fixed;left:0;top:0;width:400px;height:400px"></div>
    `),
  );

  // Position cursor, press, drag, release. Canvas drag pattern from the
  // issue: the intermediate pointermove events are what the drag
  // handlers need, not just down/up at endpoints.
  await view.mouseMove(50, 50);
  await view.mouseDown();
  await view.mouseMove(200, 200, { steps: 5 });
  await view.mouseUp();

  const events = JSON.parse(await view.evaluate("JSON.stringify(__ev)")) as Array<{
    t: string;
    x: number;
    y: number;
    btn: number;
    btns: number;
    trusted: boolean;
  }>;

  // First event is the hover move with no buttons pressed.
  expect(events[0]).toEqual({ t: "mousemove", x: 50, y: 50, btn: 0, btns: 0, trusted: true });
  // mousedown fires at the current position with buttons: 1 (left bit).
  const down = events.find(e => e.t === "mousedown")!;
  expect(down).toEqual({ t: "mousedown", x: 50, y: 50, btn: 0, btns: 1, trusted: true });
  // mouseup fires at the target position with buttons: 0 (released).
  const up = events.find(e => e.t === "mouseup")!;
  expect(up).toEqual({ t: "mouseup", x: 200, y: 200, btn: 0, btns: 0, trusted: true });
  // Intermediate drag moves — at least one, all with buttons: 1.
  const dragMoves = events.filter(e => e.t === "mousemove" && e.btns === 1);
  expect(dragMoves.length).toBeGreaterThan(0);
  // The final move always hits the target coords.
  expect(dragMoves[dragMoves.length - 1]).toEqual({
    t: "mousemove",
    x: 200,
    y: 200,
    btn: 0,
    btns: 1,
    trusted: true,
  });
});

it("chrome: mouseMove without mouseDown is a plain hover (buttons: 0)", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__ev = [];
        document.addEventListener("mousemove", e => __ev.push({
          x: e.clientX, y: e.clientY, btns: e.buttons, trusted: e.isTrusted,
        }), true);
      </script>
      <div style="position:fixed;left:0;top:0;width:300px;height:300px"></div>
    `),
  );
  await view.mouseMove(100, 100);
  await view.mouseMove(150, 75);

  const events = JSON.parse(await view.evaluate("JSON.stringify(__ev)")) as Array<{
    x: number;
    y: number;
    btns: number;
    trusted: boolean;
  }>;
  expect(events.length).toBeGreaterThanOrEqual(2);
  // All hover events have buttons: 0 (no button pressed).
  for (const e of events) expect(e.btns).toBe(0);
  expect(events[events.length - 1]).toEqual({ x: 150, y: 75, btns: 0, trusted: true });
});

it("chrome: mouseDown + mouseUp at same position synthesizes click", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__clicks = 0;
        document.addEventListener("click", e => { if (e.isTrusted) window.__clicks++; });
      </script>
      <div style="position:fixed;left:0;top:0;width:300px;height:300px"></div>
    `),
  );
  await view.mouseMove(50, 50);
  await view.mouseDown();
  await view.mouseUp();
  // No drag in between = the browser fires a synthesized click.
  expect(await view.evaluate("String(__clicks)")).toBe("1");
});

it("chrome: mouseDown right button fires contextmenu with modifiers", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
      <script>
        window.__ev = [];
        document.addEventListener("contextmenu", e => {
          e.preventDefault();
          __ev.push({ btn: e.button, btns: e.buttons, shift: e.shiftKey, ctrl: e.ctrlKey });
        }, true);
      </script>
      <div style="position:fixed;left:0;top:0;width:300px;height:300px"></div>
    `),
  );
  await view.mouseMove(50, 50);
  await view.mouseDown({ button: "right", modifiers: ["Shift", "Control"] });
  await view.mouseUp({ button: "right", modifiers: ["Shift", "Control"] });

  const events = JSON.parse(await view.evaluate("JSON.stringify(__ev)"));
  // event.button = 2 for right; buttons bitmask bit 1 (= 2) for right.
  expect(events).toEqual([{ btn: 2, btns: 2, shift: true, ctrl: true }]);
});

it("chrome: mouseDown validates — x/y must be finite in mouseMove", () => {
  const view = new Bun.WebView({ backend: chrome, width: 100, height: 100 });
  expect(() => view.mouseMove(NaN, 0)).toThrow(/must be finite/);
  expect(() => view.mouseMove(Infinity, 0)).toThrow(/must be finite/);
  expect(() => view.mouseMove(0, -Infinity)).toThrow(/must be finite/);
  view.close();
});

// Method-existence check — runs without Chrome. Validates the three new
// prototype functions are wired even if the test environment can't spawn
// a browser subprocess (CI containers without Chrome, Linux as root
// without --no-sandbox, etc.).
test("WebView prototype exposes mouseDown/mouseUp/mouseMove", () => {
  expect(typeof Bun.WebView.prototype.mouseDown).toBe("function");
  expect(typeof Bun.WebView.prototype.mouseUp).toBe("function");
  expect(typeof Bun.WebView.prototype.mouseMove).toBe("function");
});

it("chrome: url getter reflects committed URL", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  const url = html("<body>test</body>");
  await view.navigate(url);
  // m_url updated from Page.frameNavigated's params.frame.url.
  expect(view.url).toContain("data:text/html");
});

it("chrome: close() rejects pending promises", async () => {
  const view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // Kick off an eval that awaits forever.
  const p = view.evaluate("new Promise(() => {})");
  view.close();
  await expect(p).rejects.toThrow(/closed/);
});

it("chrome: two views have independent sessions", async () => {
  const a = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  const b = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  try {
    // Each view has its own Target → its own sessionId → its own page.
    await Promise.all([a.navigate(html("<body>A</body>")), b.navigate(html("<body>B</body>"))]);
    const [ra, rb] = await Promise.all([
      a.evaluate("document.body.textContent"),
      b.evaluate("document.body.textContent"),
    ]);
    expect(ra).toBe("A");
    expect(rb).toBe("B");
  } finally {
    a.close();
    b.close();
  }
});

test("WebView.closeAll is a static function", () => {
  expect(typeof Bun.WebView.closeAll).toBe("function");
  // No-op when no subprocesses are alive — verifies the idempotent fast path.
  Bun.WebView.closeAll();
});

it("chrome: closeAll() kills the subprocess and pending promises reject", async () => {
  // Subprocess-isolated — closeAll() SIGKILLs the one shared Chrome, which
  // would break subsequent tests in this file. ensureSpawned respawns on
  // the next WebView construction, but only after EVFILT_PROC has cleared
  // the Zig instance global — race prone in-process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const view = new Bun.WebView({ backend: {type:"chrome", url:false}, width: 200, height: 200 });
        await view.navigate("data:text/html,<body>test</body>");
        const p = view.evaluate("new Promise(() => {})"); // never resolves
        Bun.WebView.closeAll();
        // SIGKILL → socket EOF or EVFILT_PROC (whichever the event loop sees
        // first) → rejectAllAndMarkDead on next tick. Both race outcomes
        // reject; the message differs ("closed the pipe" vs "killed by signal").
        await p.then(
          () => { throw new Error("should have rejected"); },
          e => { if (!/closed the pipe|signal|killed/i.test(e.message)) throw e; },
        );
        console.log("rejected");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("rejected");
  expect(exitCode).toBe(0);
});

it("chrome: backend.stderr defaults to ignore (Chrome noise hidden)", async () => {
  // Subprocess-isolated — first spawn's stdio config wins for the shared
  // Chrome. Chrome prints GCM/updater/policy noise to stderr on launch;
  // default "ignore" keeps our stderr empty.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const view = new Bun.WebView({ backend: {type:"chrome", url:false}, width: 200, height: 200 });
        await view.navigate("data:text/html,<body>test</body>");
        view.close();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  // Chrome stderr contains "ERROR:" prefixed lines (chromium_log.cc format).
  // With .ignore, none of that reaches us.
  expect(stderr).not.toContain("ERROR:");
  expect(exitCode).toBe(0);
});

test("backend.stderr validates", () => {
  expect(() => new Bun.WebView({ backend: { type: "chrome", stderr: "pipe" as any } })).toThrow(
    /must be "inherit" or "ignore"/,
  );
  expect(() => new Bun.WebView({ backend: { type: "chrome", stderr: 123 as any } })).toThrow(
    /must be "inherit" or "ignore"/,
  );
  expect(() => new Bun.WebView({ backend: { type: "chrome", stdout: "foo" as any } })).toThrow(
    /must be "inherit" or "ignore"/,
  );
});

test("backend option validates", () => {
  expect(() => new Bun.WebView({ backend: "invalid" as any })).toThrow(/webkit.*chrome/i);
  expect(() => new Bun.WebView({ backend: { type: "invalid" } as any })).toThrow(/webkit.*chrome/i);
  expect(() => new Bun.WebView({ backend: { type: "chrome", path: 123 } as any })).toThrow(/path must be a string/);
  expect(() => new Bun.WebView({ backend: { type: "chrome", argv: [1] } as any })).toThrow(
    /argv entries must be strings/,
  );
});

it("backend: { type: 'chrome' } object form works", async () => {
  // path forces spawn-mode — without it, the bare object form would
  // auto-detect DevToolsActivePort and connect to the dev's Chrome,
  // locking the singleton into WS mode for subsequent tests.
  await using view = new Bun.WebView({ backend: { type: "chrome", path: chromePath }, width: 200, height: 200 });
  await view.navigate(html("<body>obj</body>"));
  expect(await view.evaluate("document.body.textContent")).toBe("obj");
});

it("backend.argv appends after core flags", async () => {
  // Spawn args apply on the FIRST Chrome launch only — subsequent views
  // reuse the already-running process. This test needs a fresh Chrome, so
  // it runs in a subprocess. --user-agent proves the flag reached Chrome.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const view = new Bun.WebView({
        backend: { type: "chrome", argv: ["--user-agent=BunWebViewTest/1.0"] },
        width: 200, height: 200,
      });
      await view.navigate("data:text/html,<body></body>");
      const ua = await view.evaluate("navigator.userAgent");
      if (ua !== "BunWebViewTest/1.0") throw new Error("got UA: " + ua);
      view.close();
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exit }).toEqual({ stdout: "ok", exit: 0 });
});

// --- Error handling --------------------------------------------------------

it("chrome: evaluate() throwing Error carries page-side stack", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // CDP exceptionDetails.exception.description is V8's formatted stack.
  // errorFromExceptionDetails splits at first \n for .message and stamps
  // the full description on .stack — the user sees page frames, not the
  // test callsite.
  // IIFE wrapper — our evaluate() wraps in await(expr), so statement
  // sequences need explicit IIFE.
  const err = await view
    .evaluate(
      `(() => {
          function inner() { throw new Error("page boom"); }
          function outer() { inner(); }
          outer();
        })()`,
    )
    .catch(e => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("page boom");
  // The stack should name the page functions.
  expect(err.stack).toContain("inner");
  expect(err.stack).toContain("outer");
});

it("chrome: evaluate() rejected Promise carries rejection reason", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  await expect(view.evaluate("Promise.reject(new TypeError('bad'))")).rejects.toThrow(/bad/);
});

it("chrome: evaluate() with circular reference throws", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // returnByValue can't serialize circular — Chrome throws page-side.
  await expect(view.evaluate("const a = {}; a.self = a; a")).rejects.toThrow();
});

it("chrome: click(selector) rejects on invalid selector syntax", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // querySelector throws SyntaxError page-side; the IIFE rejects.
  await expect(view.click(":::invalid")).rejects.toThrow();
});

// --- Input variants --------------------------------------------------------

it("chrome: click with right button fires contextmenu", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });

  await view.navigate(
    html(`
        <script>
          window.__ev = new Promise(r =>
            document.addEventListener("contextmenu", e => { e.preventDefault(); r({button: e.button, trusted: e.isTrusted}); }, {once: true}));
        </script>
        <div style="position:fixed;left:0;top:0;width:200px;height:200px"></div>
      `),
  );
  // button: "right" → cdpButton(1) = "right" → Chrome fires contextmenu.
  await view.click(100, 100, { button: "right" });
  const ev = await view.evaluate("__ev");
  expect(ev).toEqual({ button: 2, trusted: true });
});

it("chrome: click with modifiers sets MouseEvent flags", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
        <script>
          window.__ev = new Promise(r =>
            document.addEventListener("click", e => r({shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey}), {once: true}));
        </script>
        <div style="position:fixed;left:0;top:0;width:200px;height:200px"></div>
      `),
  );
  await view.click(100, 100, { modifiers: ["Shift", "Meta"] });
  const ev = await view.evaluate("__ev");
  expect(ev).toEqual({ shift: true, ctrl: false, alt: false, meta: true });
});

it("chrome: click(selector) is injection-safe", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  // Selector string contains double-quote + close-paren + close-brace —
  // characters that would break naive `")(sel,${timeout})` interpolation
  // into the IIFE call-site. appendQuotedJSONString escapes the quote;
  // the parens/braces are inert inside a JSON string.
  await view.navigate(
    html(
      `<button data-k='x")}' onclick="window.__hit=1" style="position:fixed;left:0;top:0;width:50px;height:50px"></button>`,
    ),
  );
  await view.click(`[data-k='x")}']`);
  expect(await view.evaluate("String(window.__hit)")).toBe("1");
});

it("chrome: click(selector) waits for animation to stop", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
        <style>
          @keyframes slide { from { left: 0; } to { left: 100px; } }
          #mover { position: fixed; top: 50px; width: 60px; height: 60px;
                   animation: slide 80ms linear forwards; }
        </style>
        <button id=mover onclick="window.__hit=this.getBoundingClientRect().left">mv</button>
      `),
  );
  // Stable-for-2-frames check — the click lands after the animation stops.
  await view.click("#mover");
  const left = Number(await view.evaluate("String(__hit)"));
  expect(left).toBe(100);
});

// --- scrollTo variants -----------------------------------------------------

it("chrome: scrollTo with block: start aligns top", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(
    html(`
        <div style="height:1000px"></div>
        <div id=t style="height:100px;background:red">target</div>
        <div style="height:1000px"></div>
      `),
  );
  await view.scrollTo("#t", { block: "start" });
  // block: start → target's top aligns with viewport top.
  const top = await view.evaluate("document.getElementById('t').getBoundingClientRect().top");
  expect(Math.abs(top)).toBeLessThan(2);
});

// --- Lifecycle -------------------------------------------------------------

it("chrome: resize changes viewport dimensions", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(html("<body></body>"));
  await view.resize(500, 400);
  // Emulation.setDeviceMetricsOverride — the reply means the metrics are
  // applied. innerWidth/innerHeight reflect them on the next layout.
  const dims = await view.evaluate("({w: innerWidth, h: innerHeight})");
  expect(dims).toEqual({ w: 500, h: 400 });
});

it("chrome: reload resolves after Page.loadEventFired", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<script>window.__n = Date.now()</script>"));
  const before = await view.evaluate("__n");
  // reload uses PendingSlot::Navigate — Page.loadEventFired settles it.
  // Awaiting means the document re-ran; the timestamp differs.
  await view.reload();
  const after = await view.evaluate("__n");
  expect(after).not.toBe(before);
});

it("chrome: sequential navigates work", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });

  // First navigate does the attach chain; subsequent go direct.
  await view.navigate(html("<body>A</body>"));
  expect(await view.evaluate("document.body.textContent")).toBe("A");
  await view.navigate(html("<body>B</body>"));
  expect(await view.evaluate("document.body.textContent")).toBe("B");
  await view.navigate(html("<body>C</body>"));
  expect(await view.evaluate("document.body.textContent")).toBe("C");
});

it("chrome: close() during attach chain doesn't leak the tab", async () => {
  // close() settles all slots and prunes m_pending entries for the view.
  // If the attach chain (createTarget → attach → Page.enable → navigate)
  // is in-flight, the next chain reply drops on m_pending.find()==end().
  // Without the prune, the chain would continue: m_sessions.add would
  // re-register a closed view, PageEnable would send Page.navigate, the
  // tab would navigate and fire Page.frameNavigated → onNavigated on a
  // disposed view.
  const navigated: string[] = [];
  await using view = new Bun.WebView({ backend: chrome, width: 100, height: 100 });
  view.onNavigated = (u: string) => navigated.push(u);
  // navigate() kicks off the chain; don't await.
  const navP = view.navigate("data:text/html,<body>leaked</body>");
  view.close(); // close mid-chain
  // The navigate promise rejects with "WebView closed". It never resolves
  // because the chain was pruned at close(), not continued.
  await expect(navP).rejects.toThrow(/closed/i);
  // Give Chrome a moment — if the tab leaked, we'd see onNavigated fire.
  await new Promise(r => setTimeout(r, 200));
  expect(navigated).toEqual([]);
});

it("chrome: url/title getters populated after navigate", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<title>Page Title</title><body>hi</body>"));
  // Page.loadEventFired chains Runtime.evaluate("document.title") before
  // settling — navigate() resolves with m_title populated. Same guarantee
  // as WKWebView's NavDone packing url+title.
  expect(view.title).toBe("Page Title");
  expect(view.url).toContain("data:text/html");
  // Second navigate updates both.
  await view.navigate(html("<title>Second</title>"));
  expect(view.title).toBe("Second");
});

it("chrome: onNavigated fires with committed URL", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  const urls: string[] = [];
  view.onNavigated = (url: string) => urls.push(url);
  const url = html("<body>test</body>");
  await view.navigate(url);
  // Page.frameNavigated fires before loadEventFired; the callback runs
  // inside onData before the promise microtask.
  expect(urls.length).toBeGreaterThanOrEqual(1);
  expect(urls[urls.length - 1]).toContain("data:text/html");
});

it("chrome: press() dispatches keydown/keyup pair", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  // Listeners in the HTML so they're live before any press. evaluate() wraps
  // as `await (${script})` — statement sequences need IIFE, but putting the
  // setup in the navigate body sidesteps that entirely.
  await view.navigate(
    html(`
    <body><script>
      window.__keys = [];
      addEventListener('keydown', e => __keys.push('d:' + e.key));
      addEventListener('keyup', e => __keys.push('u:' + e.key));
    </script></body>
  `),
  );
  // Named key (rawKeyDown — no text, just keydown/keyup).
  await view.press("Escape");
  // Text-producing key (keyDown — fires keydown + input).
  await view.press("Enter");
  const keys = await view.evaluate("__keys.join(',')");
  expect(keys).toBe("d:Escape,u:Escape,d:Enter,u:Enter");
});

it("chrome: press() with modifiers", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(
    html(`
    <body><script>
      window.__ev = new Promise(r =>
        addEventListener('keydown', e => r({key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey}), {once: true}));
    </script></body>
  `),
  );
  await view.press("ArrowLeft", { modifiers: ["Shift", "Control"] });
  expect(await view.evaluate("__ev")).toEqual({ key: "ArrowLeft", shift: true, ctrl: true });
});

it("chrome: goBack/goForward navigates history", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body>A</body>"));
  await view.navigate(html("<body>B</body>"));
  await view.navigate(html("<body>C</body>"));
  // Page.getNavigationHistory → entries[currentIndex-1].id →
  // Page.navigateToHistoryEntry → loadEventFired settles.
  await view.goBack();
  expect(await view.evaluate("document.body.textContent")).toBe("B");
  await view.goBack();
  expect(await view.evaluate("document.body.textContent")).toBe("A");
  await view.goForward();
  expect(await view.evaluate("document.body.textContent")).toBe("B");
});

it("chrome: goBack at history start resolves undefined (no-op)", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body>only</body>"));
  // Target.createTarget({url:"about:blank"}) means history[0]=about:blank,
  // history[1]=our page after navigate. goBack once → about:blank.
  await view.goBack();
  expect(await view.evaluate("document.body.textContent")).toBe("");
  // Now at index 0. Second goBack hits the boundary — target=-1 → out of
  // range → resolve undefined. Same semantics as WKWebView's goBack no-op.
  const r = await view.goBack();
  expect(r).toBeUndefined();
  expect(await view.evaluate("document.body.textContent")).toBe("");
});

// --- Console capture -------------------------------------------------------

it("chrome: console callback receives (type, ...args)", async () => {
  const calls: [string, ...unknown[]][] = [];
  await using view = new Bun.WebView({
    backend: chrome,
    width: 200,
    height: 200,
    console: (type: string, ...args: unknown[]) => calls.push([type, ...args]),
  });
  await view.navigate(html("<body></body>"));
  // Runtime.consoleAPICalled fires for each console.* call. Primitives
  // unwrap to raw values; objects come as JSONParsed RemoteObject wrappers.
  await view.evaluate("console.log('hello', 42, true)");
  await view.evaluate("console.warn('warning', {a: 1})");
  await view.evaluate("console.error('boom')");

  expect(calls[0]).toEqual(["log", "hello", 42, true]);
  expect(calls[1][0]).toBe("warning");
  expect(calls[1][1]).toBe("warning");
  // Object arg is the RemoteObject — preview.properties has the structure.
  expect(calls[1][2]).toHaveProperty("type", "object");
  expect(calls[2]).toEqual(["error", "boom"]);
});

it("chrome: console: globalThis.console forwards to parent's stdout", async () => {
  // Subprocess so stdout capture is clean and the globalThis.console
  // identity check hits the subprocess's own console.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const view = new Bun.WebView({
        backend: {type:"chrome", url:false}, width: 200, height: 200,
        console: globalThis.console,
      });
      await view.navigate("data:text/html,<body></body>");
      await view.evaluate("console.log('from page', 1, 2)");
      await view.evaluate("console.error('page error')");
      view.close();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // ConsoleClient::logWithLevel — Bun's formatter applies. Log → stdout,
  // Error → stderr. The args forward with Bun's util.inspect formatting.
  expect(stdout).toContain("from page");
  expect(stdout).toContain("1");
  expect(stdout).toContain("2");
  expect(stderr).toContain("page error");
  expect(exit).toBe(0);
});

it("chrome: console option validates", () => {
  expect(() => new Bun.WebView({ backend: chrome, console: 42 } as any)).toThrow(
    /console must be globalThis.console or a function/,
  );
  expect(() => new Bun.WebView({ backend: chrome, console: {} } as any)).toThrow(
    /console must be globalThis.console or a function/,
  );
});

it("chrome: large evaluate payload crosses the pipe", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // 100KB string. The socketpair buffer is ~256KB default; a single
  // write may EAGAIN partway through. The tx queue + onWritable drain
  // handles it; the response comes back intact.
  const big = "x".repeat(100_000);
  const result = await view.evaluate(`${JSON.stringify(big)}.length`);
  expect(result).toBe(100_000);
});
