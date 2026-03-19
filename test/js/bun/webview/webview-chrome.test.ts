import { expect, test } from "bun:test";

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

it("chrome: type inserts text", async () => {
  const view = new Bun.WebView({ backend: "chrome", width: 300, height: 300 });
  try {
    await view.navigate(html("<input id=i autofocus>"));
    // Input.insertText — same semantics as WKWebView's InsertText command.
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
    // mouseWheel deltaY > 0 scrolls down. Chrome applies it sync.
    const y = await view.evaluate("window.scrollY");
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
});
