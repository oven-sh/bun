import { test, expect, describe } from "bun:test";
import { isMacOS, bunEnv, bunExe, tempDir } from "harness";

// Bun.WebView only exists on darwin for now.
const it = isMacOS ? test : test.skip;

test("constructor throws on non-darwin", () => {
  if (isMacOS) {
    const view = new Bun.WebView({ width: 100, height: 100 });
    expect(view).toBeInstanceOf(Bun.WebView);
    view.close();
  } else {
    expect(() => new Bun.WebView({ width: 100, height: 100 })).toThrow(/not.*implemented/i);
  }
});

test("calling without new throws", () => {
  expect(() => (Bun.WebView as any)({ width: 100, height: 100 })).toThrow(/without 'new'/);
});

it("width/height validation", () => {
  expect(() => new Bun.WebView({ width: 0, height: 100 })).toThrow();
  expect(() => new Bun.WebView({ width: 100, height: 0 })).toThrow();
  expect(() => new Bun.WebView({ width: 99999, height: 100 })).toThrow();
});

it("headless: false throws NOT_IMPLEMENTED", () => {
  expect(() => new Bun.WebView({ width: 100, height: 100, headless: false })).toThrow(/not.*implemented/i);
});

it("navigate + evaluate round-trip", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html,<h1 id=t>hi</h1>");
    const result = await view.evaluate("document.getElementById('t').textContent");
    expect(result).toBe("hi");
  } finally {
    view.close();
  }
});

it("url/title/loading getters reflect state", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    expect(view.url).toBe("");
    await view.navigate("data:text/html,<title>hello world</title><p>body</p>");
    expect(view.url).toStartWith("data:text/html");
    // WKWebView populates .title via a separate IPC round-trip after
    // didFinishNavigation; the child reads it at reply time, which may be
    // before the title arrives. Accept either — the point is url/loading.
    expect(["", "hello world"]).toContain(view.title);
    expect(view.loading).toBe(false);
  } finally {
    view.close();
  }
});

it("onNavigated callback fires", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    let navigatedUrl = "";
    view.onNavigated = (url: string) => {
      navigatedUrl = url;
    };
    await view.navigate("data:text/html,<title>cb test</title>ok");
    expect(navigatedUrl).toStartWith("data:text/html");

    // Can be cleared.
    view.onNavigated = null;
    expect(view.onNavigated).toBe(null);
  } finally {
    view.close();
  }
});

it("onNavigationFailed callback fires", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    let failed = false;
    view.onNavigationFailed = () => {
      failed = true;
    };
    // .invalid is RFC-2606 reserved — NXDOMAIN is guaranteed, fast.
    await expect(view.navigate("http://does-not-exist.invalid/")).rejects.toThrow();
    expect(failed).toBe(true);
  } finally {
    view.close();
  }
});

it("screenshot returns PNG bytes", async () => {
  const view = new Bun.WebView({ width: 200, height: 150 });
  try {
    await view.navigate("data:text/html,<body style='background:#f00'>red</body>");
    const png = await view.screenshot();
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(8);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  } finally {
    view.close();
  }
});

it("click dispatches native mousedown/mouseup/click with isTrusted", async () => {
  const view = new Bun.WebView({ width: 300, height: 300 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <script>
            window.__ev = [];
            document.addEventListener("mousedown", e => __ev.push("down:"+e.isTrusted+"@"+e.clientX+","+e.clientY), true);
            document.addEventListener("mouseup", e => __ev.push("up:"+e.isTrusted), true);
            document.addEventListener("click", e => __ev.push("click:"+e.isTrusted), true);
          </script>
          <button onclick="window.__clicked=1" style="position:fixed;left:0;top:0;width:100px;height:100px">btn</button>
        `),
    );
    // _doAfterProcessingAllPendingMouseEvents: fires when WebContent has
    // acked both events — all JS handlers including the synthesized click
    // have run by the time await resolves.
    await view.click(50, 50);
    const events = await view.evaluate("JSON.stringify(window.__ev)");
    const clicked = await view.evaluate("String(window.__clicked)");
    expect(JSON.parse(events)).toEqual(["down:true@50,50", "up:true", "click:true"]);
    expect(clicked).toBe("1");
  } finally {
    view.close();
  }
});

it("type inserts text via InsertText command, fires input/beforeinput", async () => {
  const view = new Bun.WebView({ width: 300, height: 300 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <input id=i style="position:fixed;left:0;top:0">
          <script>
            let fired = [];
            i.addEventListener("beforeinput", e => fired.push("before:"+e.isTrusted));
            i.addEventListener("input", e => fired.push("input:"+e.isTrusted));
            i.addEventListener("keydown", e => fired.push("kd:"+e.isTrusted));
            window.__fired = fired;
          </script>
        `),
    );
    await view.evaluate("document.getElementById('i').focus()");
    // Straight apostrophe: no smart-quote substitution — InsertText command
    // bypasses NSTextInputContext entirely.
    await view.type("hello 'world'");
    const value = await view.evaluate("document.getElementById('i').value");
    const fired = await view.evaluate("JSON.stringify(window.__fired)");
    expect(value).toBe("hello 'world'");
    // No keydown — this is the InsertText editing command, not a keyboard
    // event. beforeinput/input fire from the editing pipeline, trusted.
    // _executeEditCommand:completion: is sendWithAsyncReply so await
    // resolves after WebContent has processed.
    expect(JSON.parse(fired)).toEqual(["before:true", "input:true"]);
  } finally {
    view.close();
  }
});

it("press dispatches virtual keys", async () => {
  const view = new Bun.WebView({ width: 300, height: 300 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <input id=i value="hello" style="position:fixed;left:0;top:0">
          <script>
            let keys = [];
            document.addEventListener("keydown", e => keys.push(e.key));
            window.__keys = keys;
          </script>
        `),
    );
    await view.evaluate("var i=document.getElementById('i');i.focus();i.setSelectionRange(5,5)");
    // Backspace/Enter/ArrowLeft map to editing commands (DeleteBackward/
    // InsertNewline/MoveLeft) — _executeEditCommand sendWithAsyncReply,
    // await resolves when WebContent has processed. Escape has no editing
    // command — keyDown fallback, no completion barrier.
    await view.press("Backspace");
    await view.press("Enter");
    await view.press("ArrowLeft");
    await view.press("Escape");
    const value = await view.evaluate("document.getElementById('i').value");
    const keys = await view.evaluate("JSON.stringify(window.__keys)");
    expect(value).toBe("hell");
    // Editing commands don't fire keydown — they're direct editing ops.
    // Only Escape (keyDown path) fires a keydown event.
    expect(JSON.parse(keys)).toEqual(["Escape"]);
  } finally {
    view.close();
  }
});

it("scroll dispatches native wheel event with isTrusted", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <div style="height:5000px;width:5000px">tall</div>
          <script>
            window.__w = [];
            addEventListener("wheel", e => __w.push({
              dy: e.deltaY, dx: e.deltaX,
              trusted: e.isTrusted,
              x: e.clientX, y: e.clientY,
              mode: e.deltaMode,
            }), { passive: true });
          </script>
        `),
    );
    await view.scroll(0, 100);
    const result = await view.evaluate("JSON.stringify({y: scrollY, w: __w})");
    const { y, w } = JSON.parse(result);
    // The double presentation-update barrier: first ensures the scrolling
    // tree is populated (commitScrollingTreeState in the layer commit),
    // second serializes against the ScrollingThread roundtrip so await
    // resolves after sendWheelEvent has fired. No polling.
    expect(y).toBe(100);
    // Wheel fires at view center — wheelEvent() passes (W/2, H/2) through
    // convertPointToScreen: + screen-height flip + _eventRelativeToWindow:
    // and lands exactly at locationInWindow=(100,100) in a 200×200 view.
    expect(w).toEqual([{ dy: 100, dx: 0, trusted: true, x: 100, y: 100, mode: 0 }]);
  } finally {
    view.close();
  }
});

it("scroll: sequential calls in same view", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html," + encodeURIComponent(`<div style="height:5000px">tall</div>`));
    // Each scroll runs the full double-barrier: both presentation-update
    // callbacks fire, m_scrollWheelFired resets to false at the top of
    // the next scrollIPC. If the state machine didn't re-arm, the second
    // scroll would hang (barrier never fires) or no-op.
    await view.scroll(0, 100);
    await view.scroll(0, 50);
    await view.scroll(0, -30);
    const y = await view.evaluate("String(scrollY)");
    expect(Number(y)).toBe(120);
  } finally {
    view.close();
  }
});

it("scroll: horizontal", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html," + encodeURIComponent(`<div style="width:5000px;height:100px">wide</div>`));
    await view.scroll(80, 0);
    const x = await view.evaluate("String(scrollX)");
    // CGEventCreateScrollWheelEvent takes (wheel1, wheel2) = (-dy, -dx) —
    // y is the primary wheel. wheelEvent() passes wheelCount=2 for both.
    expect(Number(x)).toBe(80);
  } finally {
    view.close();
  }
});

it("scroll: interleaved with click in same view", async () => {
  // Scroll uses m_scrollTarget, click uses m_inputTarget — decoupled so a
  // late-firing mouse barrier doesn't clear the scroll barrier's target.
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <div style="height:5000px">tall</div>
          <button id=b style="position:fixed;left:0;top:0;width:50px;height:50px" onclick="window.__c=(window.__c||0)+1">b</button>
        `),
    );
    await view.click(25, 25);
    await view.scroll(0, 100);
    await view.click(25, 25);
    await view.scroll(0, 50);
    const r = await view.evaluate("JSON.stringify({y:scrollY,c:__c})");
    expect(JSON.parse(r)).toEqual({ y: 150, c: 2 });
  } finally {
    view.close();
  }
});

it("scroll: survives navigate (fresh scrolling tree)", async () => {
  // Second navigate gets a fresh scrolling tree. The first presentation-
  // update barrier has to wait for the NEW tree's commit, not a stale one
  // from the previous page.
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html," + encodeURIComponent(`<div style="height:5000px">a</div>`));
    await view.scroll(0, 200);
    expect(await view.evaluate("String(scrollY)")).toBe("200");
    await view.navigate("data:text/html," + encodeURIComponent(`<div style="height:5000px">b</div>`));
    expect(await view.evaluate("String(scrollY)")).toBe("0");
    await view.scroll(0, 75);
    expect(await view.evaluate("String(scrollY)")).toBe("75");
  } finally {
    view.close();
  }
});

it("scroll: targets inner scrollable under view center", async () => {
  // Wheel location is always (W/2, H/2). If a scrollable element covers
  // the center, it receives the wheel and scrolls — the scrolling tree
  // hit-test finds the inner node, not the document root.
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate(
      "data:text/html," +
        encodeURIComponent(`
          <div id=inner style="position:fixed;left:50px;top:50px;width:100px;height:100px;overflow:auto">
            <div style="height:1000px">inner content</div>
          </div>
        `),
    );
    await view.scroll(0, 60);
    const r = await view.evaluate("JSON.stringify({inner: document.getElementById('inner').scrollTop, doc: scrollY})");
    const { inner, doc } = JSON.parse(r);
    expect(inner).toBe(60);
    expect(doc).toBe(0);
  } finally {
    view.close();
  }
});

it("resize changes inner dimensions", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html,<body>hi</body>");
    view.resize(400, 300);
    const result = await view.evaluate("window.innerWidth + 'x' + window.innerHeight");
    // WebKit may apply asynchronously; just check it's not still 200x200.
    expect(result).not.toBe("200x200");
  } finally {
    view.close();
  }
});

it("second evaluate() while pending rejects with INVALID_STATE", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  try {
    await view.navigate("data:text/html,<body>hi</body>");
    // Fire two concurrently — the second should throw synchronously
    // (not return a promise).
    const p1 = view.evaluate("1+1");
    expect(() => view.evaluate("2+2")).toThrow(/pending/i);
    await p1;
  } finally {
    view.close();
  }
});

it("large evaluate() payload spans kernel socket buffer", async () => {
  // macOS AF_UNIX SO_SNDBUF default is ~8KB; a 2MB script guarantees the
  // frame is split across many writes/reads on BOTH directions (parent→child
  // for the script, child→parent for the result). Exercises partial-frame
  // buffering in both onData and onReadable.
  const view = new Bun.WebView({ width: 100, height: 100 });
  try {
    await view.navigate("data:text/html,<body>ok</body>");
    // Buffer.alloc instead of "x".repeat — debug JSC's repeat is slow.
    const big = Buffer.alloc(2 * 1024 * 1024, "x").toString();
    const script = `(() => { const s = ${JSON.stringify(big)}; return s.length + ":" + s.slice(0, 4); })()`;
    const result = await view.evaluate(script);
    expect(result).toBe(`${big.length}:xxxx`);
  } finally {
    view.close();
  }
});

it("close() makes subsequent calls throw", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate("data:text/html,hi");
  view.close();
  expect(() => view.navigate("data:text/html,bye")).toThrow(/closed/i);
  // Second close is a no-op.
  view.close();
});

it("url/title return empty after close", () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  view.close();
  expect(view.url).toBe("");
  expect(view.title).toBe("");
  expect(view.loading).toBe(false);
});

it("two views have independent JS contexts", async () => {
  // data: URLs have opaque origins (no localStorage), so we verify isolation
  // via globals — each view is a separate WebContent process.
  const a = new Bun.WebView({ width: 100, height: 100 });
  const b = new Bun.WebView({ width: 100, height: 100 });
  try {
    await a.navigate("data:text/html,<body>a</body>");
    await b.navigate("data:text/html,<body>b</body>");
    await a.evaluate("window.__marker = 'from-a'");
    const got = await b.evaluate("String(window.__marker)");
    expect(got).toBe("undefined");
  } finally {
    a.close();
    b.close();
  }
});

it("callback setter rejects non-functions", () => {
  const view = new Bun.WebView({ width: 100, height: 100 });
  try {
    expect(() => {
      view.onNavigated = 42 as any;
    }).toThrow();
    view.onNavigated = () => {};
    expect(typeof view.onNavigated).toBe("function");
  } finally {
    view.close();
  }
});

it("GC: drop reference, collect, no crash", () => {
  (() => {
    new Bun.WebView({ width: 100, height: 100 });
  })();
  Bun.gc(true);
  Bun.gc(true);
});

it("process exits after close()", async () => {
  using dir = tempDir("webview-exit", {
    "index.js": `
      const view = new Bun.WebView({ width: 100, height: 100 });
      await view.navigate("data:text/html,hi");
      await view.evaluate("1+1");
      view.close();
      // No explicit exit — process should terminate naturally
      // once the drain's keep-alive unrefs.
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

it("persistent dataStore: localStorage survives across instances", async () => {
  using dir = tempDir("webview-persist", {});
  // localStorage needs a real origin; data: URLs are opaque. Use a throwaway server.
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("<!doctype html><body>ok</body>", { headers: { "content-type": "text/html" } }),
  });
  const url = `http://127.0.0.1:${server.port}/`;
  const dataStore = { directory: String(dir) };

  {
    const a = new Bun.WebView({ width: 100, height: 100, dataStore });
    try {
      await a.navigate(url);
      await a.evaluate("localStorage.setItem('k', 'survives')");
    } finally {
      a.close();
    }
  }

  // Fresh view, same directory — storage persists.
  const b = new Bun.WebView({ width: 100, height: 100, dataStore });
  try {
    await b.navigate(url);
    const got = await b.evaluate("String(localStorage.getItem('k'))");
    expect(got).toBe("survives");
  } finally {
    b.close();
  }
});

it("ephemeral dataStore: localStorage does NOT survive across instances", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("<!doctype html><body>ok</body>", { headers: { "content-type": "text/html" } }),
  });
  const url = `http://127.0.0.1:${server.port}/`;

  {
    const a = new Bun.WebView({ width: 100, height: 100 }); // default: ephemeral
    try {
      await a.navigate(url);
      await a.evaluate("localStorage.setItem('k', 'leaks?')");
    } finally {
      a.close();
    }
  }

  const b = new Bun.WebView({ width: 100, height: 100 });
  try {
    await b.navigate(url);
    const got = await b.evaluate("String(localStorage.getItem('k'))");
    expect(got).toBe("null");
  } finally {
    b.close();
  }
});

it.todo("startFrameStream: onFrame fires with shm PNG");
