import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Chrome backend works on any platform with Chrome/Chromium installed.
// Skip if no Chrome found (CI may not have it).
const chromePath =
  process.env.BUN_CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome-stable");

let hasChrome = false;
try {
  const { existsSync } = await import("node:fs");
  hasChrome = existsSync(chromePath);
} catch {}

const it = hasChrome ? test : test.skip;

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
