import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Chrome backend works on any platform with Chrome/Chromium installed.
// Mark tests todo if no Chrome found (CI may not have it). Mirrors
// ChromeProcess.zig's findChrome() — $PATH names, then hardcoded absolute
// paths, then Playwright cache — so the test detects Chrome whenever the
// runtime would.
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
const it = chromePath ? test : test.todo;

const html = (h: string) => "data:text/html," + encodeURIComponent(h);

it("backend: chrome constructor returns a WebView", () => {
  const view = new Bun.WebView({ backend: "chrome", width: 400, height: 300 });
  expect(view).toBeInstanceOf(Bun.WebView);
  view.close();
});

it("chrome: navigate + evaluate round-trip", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 400, height: 300 });
  try {
    // First navigate kicks off the Target.createTarget → attachToTarget →
    // Page.enable → Page.navigate chain; awaiting it means the sessionId
    // is established and the load event fired. Subsequent ops go direct.
    await view.navigate(html("<h1 id=t>chrome</h1>"));
    const result = await view.evaluate("document.getElementById('t').textContent");
    expect(result).toBe("chrome");
  } finally {
    view.close();
  }
});

it("chrome: evaluate returns native JS values", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: evaluate awaits Promises", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body></body>"));
    // awaitPromise:true + the (async()=>{return await (...)})() wrap.
    expect(await view.evaluate("Promise.resolve(42)")).toBe(42);
    expect(await view.evaluate("new Promise(r => setTimeout(() => r('delayed'), 5))")).toBe("delayed");
    await expect(view.evaluate("Promise.reject(new Error('boom'))")).rejects.toThrow(/boom/);
  } finally {
    view.close();
  }
});

it("chrome: screenshot returns PNG bytes", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body style='background:red'></body>"));
    const png = await view.screenshot();
    expect(png).toBeInstanceOf(Uint8Array);
    // PNG magic: 89 50 4E 47
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  } finally {
    view.close();
  }
});

it("chrome: click dispatches mousedown/mouseup/click", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click(selector) waits for actionability, clicks center", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click(selector) waits for element to appear", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click(selector) rejects on timeout when obscured", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
    await view.navigate(
      html(`
        <button id=under style="position:fixed;left:0;top:0;width:100px;height:100px">under</button>
        <div style="position:fixed;left:0;top:0;width:100px;height:100px;background:red">overlay</div>
      `),
    );
    // elementFromPoint returns the overlay — actionability never passes,
    // the IIFE throws, exceptionDetails carries the message.
    await expect(view.click("#under", { timeout: 200 })).rejects.toThrow(/timeout.*actionable/);
  } finally {
    view.close();
  }
});

it("chrome: scrollTo(selector) scrolls element into view", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: type inserts text at focused element", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
    await view.navigate(html("<input id=i>"));
    // Input.insertText inserts at the caret — need focus first. autofocus
    // only applies on user-initiated loads; for CDP-driven navigation the
    // input may not have focus. Explicit focus via evaluate.
    await view.evaluate("document.getElementById('i').focus()");
    await view.type("hello");
    const val = await view.evaluate("document.getElementById('i').value");
    expect(val).toBe("hello");
  } finally {
    view.close();
  }
});

it("chrome: scroll dispatches wheel event", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: url getter reflects committed URL", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    const url = html("<body>test</body>");
    await view.navigate(url);
    // m_url updated from Page.frameNavigated's params.frame.url.
    expect(view.url).toContain("data:text/html");
  } finally {
    view.close();
  }
});

it("chrome: close() rejects pending promises", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // Kick off an eval that awaits forever.
  const p = view.evaluate("new Promise(() => {})");
  view.close();
  await expect(p).rejects.toThrow(/closed/);
});

it("chrome: two views have independent sessions", async () => {
  const a = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  const b = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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

test("backend option validates", () => {
  expect(() => new Bun.WebView({ backend: "invalid" as any })).toThrow(/webkit.*chrome/i);
  expect(() => new Bun.WebView({ backend: { type: "invalid" } as any })).toThrow(/webkit.*chrome/i);
  expect(() => new Bun.WebView({ backend: { type: "chrome", path: 123 } as any })).toThrow(/path must be a string/);
  expect(() => new Bun.WebView({ backend: { type: "chrome", argv: [1] } as any })).toThrow(
    /argv entries must be strings/,
  );
});

it("backend: { type: 'chrome' } object form works", async () => {
  const view = new Bun.WebView({ backend: { type: "chrome" }, width: 200, height: 200 });
  try {
    await view.navigate(html("<body>obj</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("obj");
  } finally {
    view.close();
  }
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
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: evaluate() rejected Promise carries rejection reason", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body></body>"));
    await expect(view.evaluate("Promise.reject(new TypeError('bad'))")).rejects.toThrow(/bad/);
  } finally {
    view.close();
  }
});

it("chrome: evaluate() with circular reference throws", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body></body>"));
    // returnByValue can't serialize circular — Chrome throws page-side.
    await expect(view.evaluate("const a = {}; a.self = a; a")).rejects.toThrow();
  } finally {
    view.close();
  }
});

it("chrome: click(selector) rejects on invalid selector syntax", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body></body>"));
    // querySelector throws SyntaxError page-side; the IIFE rejects.
    await expect(view.click(":::invalid")).rejects.toThrow();
  } finally {
    view.close();
  }
});

// --- Input variants --------------------------------------------------------

it("chrome: click with right button fires contextmenu", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click with modifiers sets MouseEvent flags", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click(selector) is injection-safe", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

it("chrome: click(selector) waits for animation to stop", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

// --- scrollTo variants -----------------------------------------------------

it("chrome: scrollTo with block: start aligns top", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
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
  } finally {
    view.close();
  }
});

// --- Lifecycle -------------------------------------------------------------

it("chrome: resize changes viewport dimensions", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
    await view.navigate(html("<body></body>"));
    await view.resize(500, 400);
    // Emulation.setDeviceMetricsOverride — the reply means the metrics are
    // applied. innerWidth/innerHeight reflect them on the next layout.
    const dims = await view.evaluate("({w: innerWidth, h: innerHeight})");
    expect(dims).toEqual({ w: 500, h: 400 });
  } finally {
    view.close();
  }
});

it("chrome: reload resolves after Page.loadEventFired", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<script>window.__n = Date.now()</script>"));
    const before = await view.evaluate("__n");
    // reload uses PendingSlot::Navigate — Page.loadEventFired settles it.
    // Awaiting means the document re-ran; the timestamp differs.
    await view.reload();
    const after = await view.evaluate("__n");
    expect(after).not.toBe(before);
  } finally {
    view.close();
  }
});

it("chrome: sequential navigates work", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    // First navigate does the attach chain; subsequent go direct.
    await view.navigate(html("<body>A</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("A");
    await view.navigate(html("<body>B</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("B");
    await view.navigate(html("<body>C</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("C");
  } finally {
    view.close();
  }
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
  const view = new Bun.WebView({ backend: "chrome", width: 100, height: 100 });
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
  await using view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    const urls: string[] = [];
    view.onNavigated = (url: string) => urls.push(url);
    const url = html("<body>test</body>");
    await view.navigate(url);
    // Page.frameNavigated fires before loadEventFired; the callback runs
    // inside onData before the promise microtask.
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls[urls.length - 1]).toContain("data:text/html");
  } finally {
    view.close();
  }
});

it("chrome: press() dispatches keydown/keyup pair", async () => {
  await using view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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
  await using view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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
  await using view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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
  await using view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
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
    backend: "chrome",
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
        backend: "chrome", width: 200, height: 200,
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
  expect(() => new Bun.WebView({ backend: "chrome", console: 42 } as any)).toThrow(
    /console must be globalThis.console or a function/,
  );
  expect(() => new Bun.WebView({ backend: "chrome", console: {} } as any)).toThrow(
    /console must be globalThis.console or a function/,
  );
});

it("chrome: large evaluate payload crosses the pipe", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 200, height: 200 });
  try {
    await view.navigate(html("<body></body>"));
    // 100KB string. The socketpair buffer is ~256KB default; a single
    // write may EAGAIN partway through. The tx queue + onWritable drain
    // handles it; the response comes back intact.
    const big = "x".repeat(100_000);
    const result = await view.evaluate(`${JSON.stringify(big)}.length`);
    expect(result).toBe(100_000);
  } finally {
    view.close();
  }
});
