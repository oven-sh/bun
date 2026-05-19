import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isMacOS, isMacOSVersionAtLeast, isWindows, tempDir } from "harness";

// FFI shm access for encoding:"shmem" tests. In real use Kitty (or
// whoever opens the segment) does this — shm_open + mmap + read + unlink.
// The test does the same to verify end-to-end that the bytes landed in
// the segment and are readable from another "process" (same-process,
// different fd — good enough to prove the IPC boundary).
const libc = isMacOS
  ? dlopen("libc.dylib", {
      shm_open: { args: [FFIType.cstring, FFIType.i32, FFIType.u16], returns: FFIType.i32 },
      shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
      mmap: {
        args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64],
        returns: FFIType.ptr,
      },
      munmap: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
    })
  : null;
function shmUnlink(name: string): void {
  libc?.symbols.shm_unlink(ptr(Buffer.from(name + "\0")));
}
// Read the first `n` bytes from a named POSIX shm segment. Mirrors what
// Kitty does for t=s transmission. Returns a fresh Buffer (copy —
// we unmap immediately).
function shmRead(name: string, n: number): Buffer {
  const O_RDONLY = 0;
  const PROT_READ = 1;
  const MAP_SHARED = 1;
  const namez = Buffer.from(name + "\0");
  const fd = libc!.symbols.shm_open(ptr(namez), O_RDONLY, 0);
  if (fd < 0) throw new Error(`shm_open(${name}) failed`);
  const map = libc!.symbols.mmap(0, n, PROT_READ, MAP_SHARED, fd, 0);
  libc!.symbols.close(fd);
  // MAP_FAILED = (void*)-1 — all bits set, so low 12 bits are 0xfff.
  // A valid mapping is page-aligned: low 12 bits zero. FFIType.ptr
  // returns a JS number; we mask the low bits to distinguish.
  if (!map || (Number(map) & 0xfff) !== 0) throw new Error("mmap failed");
  // Copy into a JS-owned Buffer — the mapping goes away with munmap.
  // `toBuffer(ptr, byteOffset, byteLength)` wraps without copying;
  // `Buffer.from(...)` then copies so munmap is safe.
  const live = new Uint8Array(toArrayBuffer(map, 0, n));
  const out = Buffer.from(live); // copies
  libc!.symbols.munmap(map, n);
  return out;
}

// Bun.WebView only exists on darwin for now.
const it = isMacOS ? test : test.skip;
// Tests that need frames to tick (rAF / CSS animation). CI macOS runners
// have no display, so CVDisplayLink never fires and these hang.
const itRendering = isMacOS ? test.todoIf(isCI) : test.skip;

// NSURL URLWithString: strictly follows RFC 3986 on x64 macOS system
// libraries — unencoded <> return nil. arm64 builds of the same OS are
// lenient (different dyld shared cache builds per arch).
const html = (h: string) => "data:text/html," + encodeURIComponent(h);

test("backend: 'webkit' throws on non-darwin", () => {
  // Default backend is platform-dependent (WebKit on Darwin, Chrome
  // elsewhere). Explicitly requesting WebKit off-Darwin should throw.
  // On Windows the message differs (points at the ws:// connect
  // workaround instead of "use backend: chrome" because chrome's
  // spawn path is also not implemented there) — that's covered by
  // the Windows-specific test below. The regex here is narrowed to
  // require "use backend" so it doesn't incidentally match the
  // Windows message's `backend: { type: "chrome", url: "ws://..." }`
  // example text.
  if (isMacOS) {
    const view = new Bun.WebView({ width: 100, height: 100, backend: "webkit" });
    expect(view).toBeInstanceOf(Bun.WebView);
    view.close();
  } else if (!isWindows) {
    expect(() => new Bun.WebView({ width: 100, height: 100, backend: "webkit" })).toThrow(
      /only available on macOS.*use backend.*chrome/i,
    );
  }
});

// https://github.com/oven-sh/bun/issues/29102 — Chrome backend's spawn
// path has no Windows implementation yet. Only test shapes that force
// spawn without consulting Bun__Chrome__autoDetect, so the test is
// deterministic regardless of whether Chrome is running on the host
// with --remote-debugging-port. Default `{}` and `backend: "chrome"`
// go through auto-detect and their spawn-path coverage lives in
// test/regression/issue/29102.test.ts where LOCALAPPDATA is scrubbed
// to guarantee the auto-detect branch misses.
test.skipIf(!isWindows)("backend: 'chrome' spawn throws on Windows", () => {
  const cases: Array<object> = [
    // Explicit path forces spawn-mode (skips auto-detect).
    {
      backend: {
        type: "chrome",
        path: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      },
    },
    // url:false also forces spawn-mode (documented knob).
    { backend: { type: "chrome", url: false } },
  ];
  for (const opts of cases) {
    let err: any;
    let view: any;
    try {
      view = new (Bun as any).WebView(opts);
    } catch (e) {
      err = e;
    }
    if (view) {
      // Unexpected success — close and fail loudly rather than leave
      // a live view that could hang the suite.
      try {
        view.close();
      } catch {}
      throw new Error(`UNEXPECTED_SUCCESS for opts=${JSON.stringify(opts)}: expected ERR_METHOD_NOT_IMPLEMENTED`);
    }
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
    expect(err.message).toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
    // Positive: the message must point users at the ws:// connect
    // workaround. Mirrors the pattern in 29102.test.ts's helpers —
    // stripping the hint would otherwise pass silently.
    expect(err.message).toMatch(/ws:\/\//i);
    // Must not mention BUN_CHROME_PATH / set...backend.path — those
    // knobs are inert on the Windows spawn path and the old message's
    // hint at them is exactly what confused the bug reporter.
    expect(err.message).not.toMatch(/BUN_CHROME_PATH/);
    expect(err.message).not.toMatch(/set.*backend\.path/);
  }
});

// Companion: `backend: 'webkit'` on Windows must not suggest "use
// backend: chrome" (which is now also spawn-gated on Windows), or the
// user would hit a second not-implemented error.
test.skipIf(!isWindows)("backend: 'webkit' on Windows does not point at a broken chrome fallback", () => {
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({ width: 100, height: 100, backend: "webkit" });
  } catch (e) {
    err = e;
  }
  if (view) {
    try {
      view.close();
    } catch {}
    throw new Error("UNEXPECTED_SUCCESS: webkit should not work on Windows");
  }
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/only available on macOS/i);
  // The bare "use backend: chrome" hint was misleading on Windows —
  // chrome's spawn path is also not implemented. If we mention chrome
  // at all, it must be as the ws:// connect workaround.
  expect(err.message).toMatch(/ws:\/\//i);
});

test("calling without new throws", () => {
  expect(() => (Bun.WebView as any)({ width: 100, height: 100 })).toThrow(/without 'new'/);
});

it("is an EventTarget", () => {
  const view = new Bun.WebView({ width: 100, height: 100 });
  try {
    expect(view).toBeInstanceOf(EventTarget);
    expect(Object.getPrototypeOf(Object.getPrototypeOf(view))).toBe(EventTarget.prototype);
    // addEventListener/removeEventListener/dispatchEvent inherited from
    // EventTarget.prototype — unwrap via jsDynamicCast<JSEventTarget*>
    // which succeeds for JSWebView : JSEventTarget.
    expect(typeof view.addEventListener).toBe("function");
    expect(typeof view.removeEventListener).toBe("function");
    expect(typeof view.dispatchEvent).toBe("function");
  } finally {
    view.close();
  }
});

it("dispatchEvent fires addEventListener callbacks", () => {
  const view = new Bun.WebView({ width: 100, height: 100 });
  try {
    let fired = 0;
    let target: EventTarget | null = null;
    const handler = (e: Event) => {
      fired++;
      target = e.target;
    };
    view.addEventListener("test", handler);
    const dispatched = view.dispatchEvent(new Event("test"));
    expect(dispatched).toBe(true);
    expect(fired).toBe(1);
    // event.target resolved via WebViewEventTarget's ScriptWrappable →
    // impl→wrapper Weak — returns the JSWebView instance.
    expect(target).toBe(view);

    // removeEventListener with a different function reference is a no-op.
    view.removeEventListener("test", () => {});
    view.dispatchEvent(new Event("test"));
    expect(fired).toBe(2); // still registered

    // removeEventListener with the exact reference unhooks.
    view.removeEventListener("test", handler);
    view.dispatchEvent(new Event("test"));
    expect(fired).toBe(2); // unchanged — handler removed

    // Multiple listeners on same event fire in registration order.
    const order: number[] = [];
    view.addEventListener("multi", () => order.push(1));
    view.addEventListener("multi", () => order.push(2));
    view.dispatchEvent(new Event("multi"));
    expect(order).toEqual([1, 2]);
  } finally {
    view.close();
  }
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
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<h1 id=t>hi</h1>"));
  const result = await view.evaluate("document.getElementById('t').textContent");
  expect(result).toBe("hi");
});

it("url constructor option fires navigate()", async () => {
  // `url:` is sugar for navigate() right after Create. The promise lands in
  // m_pendingNavigate; the user's next await serializes behind it. Here
  // evaluate() blocks until the navigate's NavDone clears the slot and the
  // eval IPC goes out behind it — so by the time evaluate resolves, the
  // page has loaded.
  await using view = new Bun.WebView({ width: 200, height: 200, url: html("<h1 id=t>from-ctor</h1>") });
  // No explicit navigate() — the constructor fired it. evaluate() will
  // wait for the pending navigate to complete (checkSlot serializes).
  // Actually — evaluate uses m_pendingEval, not m_pendingNavigate, so
  // they don't serialize against each other on the JS side. The child
  // processes the Create+Navigate+Evaluate frames in order from the same
  // socket batch; evaluate lands after navigate in the child's dispatch
  // loop, but callAsyncJavaScript doesn't wait for didFinishNavigation.
  // The eval may race the load. Await onNavigated to be sure.
  const { promise, resolve } = Promise.withResolvers<void>();
  view.onNavigated = () => resolve();
  await promise;
  const result = await view.evaluate("document.getElementById('t').textContent");
  expect(result).toBe("from-ctor");
  expect(view.url).toStartWith("data:text/html");
});

it("evaluate() returns native JS values via page-side JSON.stringify + parent JSONParse", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // The body is wrapped as `return JSON.stringify(await (${script}))` via
  // callAsyncJavaScript:. JSON.stringify runs in WebContent's JSC — the
  // only serialization. Result crosses as NSString (WebKit never allocs
  // NSArray/NSNumber intermediates). Parent JSONParse's once. Same path
  // as WebAutomationSessionProxy.js (the WebDriver backend).
  expect(await view.evaluate("true")).toBe(true);
  expect(await view.evaluate("false")).toBe(false);
  expect(await view.evaluate("42")).toBe(42);
  expect(await view.evaluate("3.14")).toBe(3.14);
  expect(await view.evaluate("null")).toBeNull();
  expect(await view.evaluate("'hello'")).toBe("hello");
  expect(await view.evaluate("[1, 2, 3]")).toEqual([1, 2, 3]);
  expect(await view.evaluate("({a: 1, b: true, c: [null]})")).toEqual({ a: 1, b: true, c: [null] });
  // JSON.stringify(undefined) evaluates to undefined → nil → jsUndefined.
  expect(await view.evaluate("undefined")).toBeUndefined();
  // Functions/symbols collapse to undefined too (JSON.stringify drops them).
  expect(await view.evaluate("() => 1")).toBeUndefined();
});

it("evaluate() awaits Promises", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // await (expr) — thenables unwrap, non-thenables pass through identity.
  expect(await view.evaluate("Promise.resolve(42)")).toBe(42);
  // Microtask roundtrip.
  expect(await view.evaluate("Promise.resolve().then(() => [1, 2])")).toEqual([1, 2]);
  // Macrotask — setTimeout fires, completion waits for it.
  expect(await view.evaluate("new Promise(r => setTimeout(() => r('delayed'), 5))")).toBe("delayed");
  // Rejected promise propagates as rejection.
  await expect(view.evaluate("Promise.reject(new Error('boom'))")).rejects.toThrow(/boom/);
});

it("evaluate() with statement sequence throws SyntaxError (use an IIFE)", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // The wrap is `await (${script})` — parenthesization forces expression
  // context. `(let x=1; x)` is a syntax error.
  await expect(view.evaluate("let x = 1; x + 1")).rejects.toThrow(/SyntaxError|Unexpected/);
  // Wrap in an IIFE for statement sequences.
  expect(await view.evaluate("(() => { let x = 1; return x + 1 })()")).toBe(2);
});

it("scroll(NaN/Infinity) throws before sending", () => {
  // NaN would permanently poison m_pendingScrollDx/Dy (NaN + anything = NaN)
  // and hit UB at the static_cast<int32_t> in CGEventCreateScrollWheelEvent.
  // The check in JSWebViewPrototype.cpp throws before sendOp — no IPC sent,
  // nothing to await. "Scroll actually works after" is covered by the
  // dedicated scroll tests; here we just verify the guard.
  using view = new Bun.WebView({ width: 200, height: 200 });
  expect(() => view.scroll(0, NaN)).toThrow(/must be finite/);
  expect(() => view.scroll(Infinity, 0)).toThrow(/must be finite/);
  expect(() => view.scroll(-Infinity, 0)).toThrow(/must be finite/);
  expect(() => view.scroll(0, 0 / 0)).toThrow(/must be finite/);
});

it("Symbol.dispose / Symbol.asyncDispose call close()", async () => {
  // Both symbols point to the same JSFunction (close). close() is
  // synchronous — writes the Close frame, rejects pending promises,
  // erases from the routing table. No async teardown to await.
  {
    using view = new Bun.WebView({ width: 100, height: 100 });
    expect(view[Symbol.dispose]).toBe(view[Symbol.asyncDispose]);
    expect(typeof view[Symbol.dispose]).toBe("function");
  }
  // `await using` prefers asyncDispose.
  {
    await using view = new Bun.WebView({ width: 100, height: 100 });
    await view.navigate(html("<body></body>"));
    expect(await view.evaluate("1+1")).toBe(2);
  }
  // And it's close() — idempotent, second close no-ops.
  const view = new Bun.WebView({ width: 100, height: 100 });
  view[Symbol.dispose]();
  view.close();
});

it("concurrent evaluate() across two views works", async () => {
  // Completion blocks carry Ref<WebViewHost> per-call (heap-allocated
  // _NSConcreteMallocBlock, same layout as WTF::BlockPtr). No process-global
  // target pointer — the Ref in the block routes the completion to the
  // right host. Each view has its own WebContent process, so the
  // evaluates genuinely run in parallel; we're testing that the
  // completions don't cross wires.
  await using a = new Bun.WebView({ width: 200, height: 200 });
  await using b = new Bun.WebView({ width: 200, height: 200 });
  await Promise.all([a.navigate(html("<body>A</body>")), b.navigate(html("<body>B</body>"))]);
  // A deliberately slower (microtask roundtrip) so B's completion
  // would fire first and stomp A's target under the old global-target
  // design — A's eval would resolve with B's body text.
  const [ra, rb] = await Promise.all([
    a.evaluate("Promise.resolve().then(() => document.body.textContent)"),
    b.evaluate("document.body.textContent"),
  ]);
  expect(ra).toBe("A");
  expect(rb).toBe("B");

  // Same for click/scrollTo (selectorCompletionBlock path).
  await Promise.all([a.scrollTo("body"), b.scrollTo("body")]);
});

it("url/title/loading getters reflect state", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  expect(view.url).toBe("");
  await view.navigate(html("<title>hello world</title><p>body</p>"));
  expect(view.url).toStartWith("data:text/html");
  // WKWebView populates .title via a separate IPC round-trip after
  // didFinishNavigation; the child reads it at reply time, which may be
  // before the title arrives. Accept either — the point is url/loading.
  expect(["", "hello world"]).toContain(view.title);
  expect(view.loading).toBe(false);
});

it("onNavigated callback fires", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  let navigatedUrl = "";
  view.onNavigated = (url: string) => {
    navigatedUrl = url;
  };
  await view.navigate(html("<title>cb test</title>ok"));
  expect(navigatedUrl).toStartWith("data:text/html");

  // Can be cleared.
  view.onNavigated = null;
  expect(view.onNavigated).toBe(null);
});

it("console callback receives (type, ...args)", async () => {
  const calls: [string, ...unknown[]][] = [];
  await using view = new Bun.WebView({
    width: 200,
    height: 200,
    console: (type: string, ...args: unknown[]) => calls.push([type, ...args]),
  });
  await view.navigate(html("<body></body>"));
  // WKScriptMessage posts and callAsyncJavaScript completions share the
  // same WebContent→UIProcess IPC connection — ordered. The postMessage
  // inside the evaluate body delivers before the evaluate completion, so
  // calls[] is populated by the time await resumes.
  await view.evaluate("console.log('hello', 42, true)");
  await view.evaluate("console.warn('w')");
  expect(calls[0]).toEqual(["log", "hello", 42, true]);
  expect(calls[1]).toEqual(["warn", "w"]);
});

it("onNavigationFailed callback fires", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  let failed = false;
  view.onNavigationFailed = () => {
    failed = true;
  };
  // .invalid is RFC-2606 reserved — NXDOMAIN is guaranteed, fast.
  await expect(view.navigate("http://does-not-exist.invalid/")).rejects.toThrow();
  expect(failed).toBe(true);
});

it("screenshot returns a PNG Blob", async () => {
  await using view = new Bun.WebView({ width: 200, height: 150 });
  await view.navigate(html("<body style='background:#f00'>red</body>"));
  const blob = await view.screenshot();
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBeGreaterThan(8);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50);
  expect(bytes[2]).toBe(0x4e);
  expect(bytes[3]).toBe(0x47);
});

it("screenshot format options", async () => {
  await using view = new Bun.WebView({ width: 200, height: 150 });
  await view.navigate(html("<body style='background:linear-gradient(red,blue)'></body>"));

  const jpeg = await view.screenshot({ format: "jpeg", quality: 90 });
  expect(jpeg.type).toBe("image/jpeg");
  const jb = new Uint8Array(await jpeg.arrayBuffer());
  // JPEG magic: FF D8 FF
  expect([jb[0], jb[1], jb[2]]).toEqual([0xff, 0xd8, 0xff]);

  // WebP rejected on WebKit — NSBitmapImageRep has no WebP in its enum.
  // Thrown synchronously (arg validation), not promise-rejection.
  expect(() => view.screenshot({ format: "webp" })).toThrow(/webp.*chrome/i);

  // quality validation — NaN/Infinity are rejected (isfinite check).
  expect(() => view.screenshot({ quality: 101 } as any)).toThrow(/quality.*0.*100/);
  expect(() => view.screenshot({ quality: NaN } as any)).toThrow(/quality.*0.*100/);
  expect(() => view.screenshot({ quality: Infinity } as any)).toThrow(/quality.*0.*100/);
  expect(() => view.screenshot({ format: "gif" } as any)).toThrow(/png.*jpeg.*webp/i);

  // cdp() is Chrome-only.
  expect(() => view.cdp("Page.enable")).toThrow(/chrome/i);
});

it("screenshot encoding options", async () => {
  await using view = new Bun.WebView({ width: 200, height: 150 });
  await view.navigate(html("<body style='background:#00f'>blue</body>"));

  // buffer — zero-copy mmap-backed on WebKit. Same PNG magic.
  const buf = await view.screenshot({ encoding: "buffer" });
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
  // Mutate the buffer — the ArrayBuffer adopts the mapping PROT_WRITE,
  // so this is safe (writes the mmap'd page; munmap's on GC).
  buf[0] = 0xff;
  expect(buf[0]).toBe(0xff);

  // base64 — string encoding. Decodes to the same PNG bytes.
  const b64 = await view.screenshot({ encoding: "base64" });
  expect(typeof b64).toBe("string");
  const decoded = Buffer.from(b64, "base64");
  expect(decoded[0]).toBe(0x89);
  expect(decoded[1]).toBe(0x50);

  // shmem — POSIX shm name + size. We don't unlink; the user (Kitty)
  // does after shm_open'ing. Verify end-to-end by reading the segment
  // ourselves — same thing Kitty does.
  const shm = await view.screenshot({ encoding: "shmem" });
  try {
    expect(typeof shm.name).toBe("string");
    expect(shm.name.startsWith("/bun-webview-")).toBe(true);
    expect(shm.size).toBeGreaterThan(100);
    // shm_open + mmap + read — proves the bytes landed in the segment
    // and are PNG. This is what Kitty's t=s handler does.
    const bytes = shmRead(shm.name, 8);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  } finally {
    // Clean up even if assertions fail — leaked shm names persist
    // until logout on macOS.
    shmUnlink(shm.name);
  }
});

it("screenshot Blob survives GC (mmap-backed store)", async () => {
  // The WebKit path mmap's the shm segment directly into the Blob's store
  // — no copy. The store's allocator vtable munmap's on free (when the
  // Blob's refcount drops). This verifies the mapping is valid across a
  // GC cycle and that `await blob.bytes()` reads live pages.
  await using view = new Bun.WebView({ width: 200, height: 150 });
  await view.navigate(html("<body style='background:#0f0'>green</body>"));
  const blob = await view.screenshot();
  Bun.gc(true);
  const bytes = await blob.bytes();
  expect(bytes[0]).toBe(0x89); // PNG magic still readable
  expect(bytes.length).toBe(blob.size);
});

// Probe test — if click(selector) times out on CI, this tells us whether
// the page sees itself as visible (rAF throttling root cause) vs. something
// in the actionability script itself. The -[NSWindow isVisible]→YES override
// keeps the ActivityState::IsVisible bit set, but CI macOS 14's CVDisplayLink
// still doesn't callback for the (0,0) alpha=0 window — todo until closed.
itRendering("document.visibilityState is visible and rAF fires", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  const state = await view.evaluate("document.visibilityState");
  expect(state).toBe("visible");
  // rAF is gated on ActivityState::IsVisible in WebContent. If the initial
  // activity state was wrong (window not visible at process launch), the
  // callback never fires and this evaluate() hangs at the test timeout.
  const fired = await view.evaluate("new Promise(r => requestAnimationFrame(() => r('fired')))");
  expect(fired).toBe("fired");
});

it("click dispatches native mousedown/mouseup/click with isTrusted", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
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
});

// TODO: times out on CI (90s) — the rAF-driven actionability poll never
// resolves. Passes locally; likely a headless/offscreen WKWebView rAF
// scheduling quirk on the CI runner.
itRendering("click(selector) waits for actionability, clicks center", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <script>
          window.__ev = [];
          document.addEventListener("click", e => __ev.push({
            trusted: e.isTrusted, x: e.clientX, y: e.clientY,
            target: e.target.id,
          }), true);
        </script>
        <button id=btn style="position:fixed;left:40px;top:60px;width:100px;height:80px">btn</button>
      `),
  );
  // No coord math on our side — the rAF-polled actionability check
  // resolves the center page-side and returns it. Button center is
  // (40+50, 60+40) = (90, 100).
  await view.click("#btn");
  const events = await view.evaluate("JSON.stringify(__ev)");
  expect(JSON.parse(events)).toEqual([{ trusted: true, x: 90, y: 100, target: "btn" }]);
});

itRendering("click(selector) waits for element to appear", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <script>
          window.__clicked = 0;
          // Element doesn't exist yet — appears after 3 rAF frames.
          // The page-side poll catches it; no host-side retry.
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
  // callAsyncJavaScript: awaits the page-side Promise. The actionability
  // loop rAF-polls until #late appears AND is stable for 2 frames AND
  // elementFromPoint confirms it's not obscured. No timing assumptions
  // on our side — just await.
  await view.click("#late");
  expect(await view.evaluate("String(__clicked)")).toBe("1");
});

itRendering("click(selector) waits for element to stop animating", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <style>
          @keyframes slide { from { left: 0px; } to { left: 100px; } }
          #mover { position: fixed; top: 50px; width: 60px; height: 60px;
                   animation: slide 100ms linear forwards; }
        </style>
        <button id=mover onclick="window.__hit=this.getBoundingClientRect().left">mv</button>
      `),
  );
  // The stable-for-2-consecutive-frames check means we don't click until
  // the animation stops. If we clicked mid-slide, __hit would be < 100.
  await view.click("#mover");
  const left = await view.evaluate("String(__hit)");
  expect(Number(left)).toBe(100);
});

itRendering("click(selector) rejects on timeout when obscured", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <button id=under style="position:fixed;left:0;top:0;width:100px;height:100px">under</button>
        <div style="position:fixed;left:0;top:0;width:100px;height:100px;background:red">overlay</div>
      `),
  );
  // elementFromPoint at the center returns the overlay div, not #under
  // or a descendant of it — the actionability check never passes.
  // callAsyncJavaScript: surfaces the page-side throw as
  // WKErrorJavaScriptAsyncFunctionResultRejected.
  await expect(view.click("#under", { timeout: 200 })).rejects.toThrow(/timeout waiting for '#under'/);
});

itRendering("click(selector) with options", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <button id=b style="position:fixed;left:0;top:0;width:100px;height:100px"></button>
        <script>
          window.__ev = [];
          b.addEventListener("mousedown", e => __ev.push({btn: e.button, shift: e.shiftKey, det: e.detail}));
        </script>
      `),
  );
  await view.click("#b", { button: "right", modifiers: ["Shift"], clickCount: 2 });
  const ev = await view.evaluate("JSON.stringify(__ev)");
  expect(JSON.parse(ev)).toEqual([{ btn: 2, shift: true, det: 2 }]);
});

it("click(selector) is injection-safe", async () => {
  // The selector goes via callAsyncJavaScript:'s arguments: NSDictionary,
  // not string interpolation. A selector containing JS syntax is passed
  // as a literal string value to querySelector, which throws
  // SyntaxError: not a valid selector — it doesn't execute.
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(html("<body><script>window.__pwned=0</script></body>"));
  const bad = `"); window.__pwned = 1; //`;
  await expect(view.click(bad, { timeout: 100 })).rejects.toThrow();
  expect(await view.evaluate("String(__pwned)")).toBe("0");
});

it("scrollTo(selector) centers element in viewport", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <div style="height:2000px"></div>
        <div id=target style="height:40px">target</div>
        <div style="height:2000px"></div>
      `),
  );
  // scrollIntoView runs page-side via callAsyncJavaScript: — atomic,
  // no layout race between rect-read and scroll-fire. The await
  // resolves when the async function body returns, which is after
  // scrollIntoView has already updated scrollY. The scroll event fires
  // on a later task (browser timing); we don't wait for it.
  await view.scrollTo("#target");
  const r = await view.evaluate(
    "JSON.stringify({y: scrollY, top: document.getElementById('target').getBoundingClientRect().top})",
  );
  const { y, top } = JSON.parse(r);
  // block:'center' default — element's center near viewport center.
  // 40px tall element centered in 200px viewport → top ≈ 80.
  expect(y).toBeGreaterThan(1800);
  expect(top).toBeGreaterThan(60);
  expect(top).toBeLessThan(100);
});

itRendering("scrollTo(selector) waits for element to appear", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <div style="height:3000px"></div>
        <script>
          let n = 0;
          requestAnimationFrame(function tick() {
            if (++n < 3) return requestAnimationFrame(tick);
            const d = document.createElement('div');
            d.id = 'late';
            d.style.height = '20px';
            document.body.appendChild(d);
          });
        </script>
      `),
  );
  // Same rAF-polled existence check as click(selector), but no stability
  // or elementFromPoint requirement — just attached. The page-side loop
  // catches the element as soon as it enters the DOM.
  await view.scrollTo("#late");
  expect(Number(await view.evaluate("String(scrollY)"))).toBeGreaterThan(2800);
});

it("scrollTo(selector, { block }) controls alignment", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <div style="height:2000px"></div>
        <div id=t style="height:40px">t</div>
        <div style="height:2000px"></div>
      `),
  );
  await view.scrollTo("#t", { block: "start" });
  const topStart = Number(await view.evaluate("document.getElementById('t').getBoundingClientRect().top"));
  // block:'start' → element's top at viewport top (≈0 plus body margin).
  expect(topStart).toBeLessThan(20);

  await view.scrollTo("#t", { block: "end" });
  const topEnd = Number(await view.evaluate("document.getElementById('t').getBoundingClientRect().top"));
  // block:'end' → element's bottom at viewport bottom → top ≈ 200-40 = 160.
  expect(topEnd).toBeGreaterThan(140);
});

itRendering("scrollTo(selector) rejects on timeout", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  await expect(view.scrollTo("#nonexistent", { timeout: 150 })).rejects.toThrow(/timeout waiting for '#nonexistent'/);
});

it("type inserts text via InsertText command, fires input/beforeinput", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
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
});

it("press dispatches virtual keys", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
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
  await view.evaluate("(() => { let i=document.getElementById('i');i.focus();i.setSelectionRange(5,5) })()");
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
});

it("press with modifiers fires keydown with modifier flags", async () => {
  await using view = new Bun.WebView({ width: 300, height: 300 });
  await view.navigate(
    "data:text/html," +
      encodeURIComponent(`
        <script>
          window.__keys = [];
          addEventListener("keydown", e => __keys.push({key: e.key, shift: e.shiftKey, meta: e.metaKey}));
        </script>
      `),
  );
  // Modified keys skip the editing-command path and fall through to
  // keyDown: — mapping every chord→command (Shift+ArrowLeft is
  // MoveLeftAndModifySelection etc.) isn't done yet. The options object
  // was being passed directly to parseModifiers which expects an array;
  // the modifiers field is now extracted first.
  await view.press("Escape", { modifiers: ["Shift"] });
  const keys = await view.evaluate("JSON.stringify(__keys)");
  expect(JSON.parse(keys)).toEqual([{ key: "Escape", shift: true, meta: false }]);
});

itRendering("scroll dispatches native wheel event with isTrusted", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
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
});

itRendering("scroll: sequential calls in same view", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
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
});

itRendering("scroll: horizontal", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate("data:text/html," + encodeURIComponent(`<div style="width:5000px;height:100px">wide</div>`));
  await view.scroll(80, 0);
  const x = await view.evaluate("String(scrollX)");
  // CGEventCreateScrollWheelEvent takes (wheel1, wheel2) = (-dy, -dx) —
  // y is the primary wheel. wheelEvent() passes wheelCount=2 for both.
  expect(Number(x)).toBe(80);
});

itRendering("scroll: interleaved with click in same view", async () => {
  // Scroll uses m_scrollTarget, click uses m_inputTarget — decoupled so a
  // late-firing mouse barrier doesn't clear the scroll barrier's target.
  await using view = new Bun.WebView({ width: 200, height: 200 });
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
});

itRendering("scroll: survives navigate (fresh scrolling tree)", async () => {
  // Second navigate gets a fresh scrolling tree. The first presentation-
  // update barrier has to wait for the NEW tree's commit, not a stale one
  // from the previous page.
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate("data:text/html," + encodeURIComponent(`<div style="height:5000px">a</div>`));
  await view.scroll(0, 200);
  expect(await view.evaluate("String(scrollY)")).toBe("200");
  await view.navigate("data:text/html," + encodeURIComponent(`<div style="height:5000px">b</div>`));
  expect(await view.evaluate("String(scrollY)")).toBe("0");
  await view.scroll(0, 75);
  expect(await view.evaluate("String(scrollY)")).toBe("75");
});

itRendering("scroll: targets inner scrollable under view center", async () => {
  // Wheel location is always (W/2, H/2). If a scrollable element covers
  // the center, it receives the wheel and scrolls — the scrolling tree
  // hit-test finds the inner node, not the document root.
  await using view = new Bun.WebView({ width: 200, height: 200 });
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
});

it("resize changes inner dimensions", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body>hi</body>"));
  view.resize(400, 300);
  const result = await view.evaluate("window.innerWidth + 'x' + window.innerHeight");
  // WebKit may apply asynchronously; just check it's not still 200x200.
  expect(result).not.toBe("200x200");
});

it("second evaluate() while pending rejects with INVALID_STATE", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body>hi</body>"));
  // Fire two concurrently — the second should throw synchronously
  // (not return a promise).
  const p1 = view.evaluate("1+1");
  expect(() => view.evaluate("2+2")).toThrow(/pending/i);
  await p1;
});

it("large evaluate() payload spans kernel socket buffer", async () => {
  // macOS AF_UNIX SO_SNDBUF default is ~8KB; a 5MB script guarantees the
  // frame is split across many writes/reads on BOTH directions (parent→child
  // for the script, child→parent for the result). Exercises partial-frame
  // buffering in both onData and onReadable, and the write() EAGAIN + queue
  // path in FrameWriter / writeRaw.
  await using view = new Bun.WebView({ width: 100, height: 100 });
  await view.navigate(html("<body>ok</body>"));
  // Buffer.alloc instead of "x".repeat — debug JSC's repeat is slow.
  const big = Buffer.alloc(5 * 1024 * 1024, "x").toString();
  const script = `(() => { const s = ${JSON.stringify(big)}; return s.length + ":" + s.slice(0, 4); })()`;
  const result = await view.evaluate(script);
  expect(result).toBe(`${big.length}:xxxx`);
});

it("close() makes subsequent calls throw", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate("data:text/html,hi");
  view.close();
  expect(() => view.navigate("data:text/html,bye")).toThrow(/closed/i);
  // Second close is a no-op.
  view.close();
});

it("close() rejects pending promises", async () => {
  const view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate(html("<body>hi</body>"));
  // Start an evaluate that never resolves page-side (infinite loop would
  // block WebContent; use a pending promise-like shape via a slow script
  // instead — actually, just start the evaluate and close before it
  // round-trips). The promise must reject, not hang. Without rejection,
  // m_pendingActivityCount stays >0 and the view leaks.
  const p = view.evaluate("new Promise(()=>{})" /* unsupported type → slow-ish */);
  view.close();
  await expect(p).rejects.toThrow(/closed/i);
});

it("WebView.closeAll() kills the host subprocess and pending promises reject", async () => {
  // Subprocess-isolated — closeAll() SIGKILLs the one shared WKWebView host,
  // which would break subsequent tests. ensureSpawned respawns on the next
  // WebView construction, but only after EVFILT_PROC has cleared the Zig
  // instance global — race prone in-process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const view = new Bun.WebView({ width: 200, height: 200 });
        await view.navigate("data:text/html," + encodeURIComponent("<body>test</body>"));
        const p = view.evaluate("new Promise(() => {})"); // never resolves
        Bun.WebView.closeAll();
        // SIGKILL → socket EOF or EVFILT_PROC (whichever wins) →
        // rejectAllAndMarkDead on next tick. Both paths reject; the message
        // differs ("host process died" vs "killed by signal").
        await p.then(
          () => { throw new Error("should have rejected"); },
          e => { if (!/died|signal|killed/i.test(e.message)) throw e; },
        );
        console.log("rejected");
      `,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("rejected");
  expect(exitCode).toBe(0);
});

it("reload() fires onNavigated", async () => {
  await using view = new Bun.WebView({ width: 200, height: 200 });
  await view.navigate("data:text/html," + encodeURIComponent("<body>hi</body>"));
  expect(view.url).toStartWith("data:text/html");

  // NavEvent is unsolicited now — fires for reload() even though
  // reload() Acks immediately (m_pendingMisc, not m_pendingNavigate).
  // Before this change, onNavigationFinished early-returned when
  // m_navPending was false, so reload/back/forward never fired the
  // callback and never updated view.url.
  const { promise, resolve } = Promise.withResolvers<string>();
  view.onNavigated = url => resolve(url);
  await view.reload();
  const navUrl = await promise;
  expect(navUrl).toStartWith("data:text/html");
  expect(view.url).toStartWith("data:text/html");
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
  await using a = new Bun.WebView({ width: 100, height: 100 });
  await using b = new Bun.WebView({ width: 100, height: 100 });
  await a.navigate(html("<body>a</body>"));
  await b.navigate(html("<body>b</body>"));
  await a.evaluate("window.__marker = 'from-a'");
  const got = await b.evaluate("String(window.__marker)");
  expect(got).toBe("undefined");
});

it("callback setter rejects non-functions", () => {
  using view = new Bun.WebView({ width: 100, height: 100 });
  expect(() => {
    view.onNavigated = 42 as any;
  }).toThrow();
  view.onNavigated = () => {};
  expect(typeof view.onNavigated).toBe("function");
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

// _WKWebsiteDataStoreConfiguration initWithDirectory: is macOS 15.2+.
const itPersistentDataStore = isMacOS && isMacOSVersionAtLeast(15.2) ? test : test.skip;
itPersistentDataStore("persistent dataStore: localStorage survives across instances", async () => {
  using dir = tempDir("webview-persist", {});
  // localStorage needs a real origin; data: URLs are opaque. Use a throwaway server.
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("<!doctype html><body>ok</body>", { headers: { "content-type": "text/html" } }),
  });
  const url = `http://127.0.0.1:${server.port}/`;
  const dataStore = { directory: String(dir) };

  {
    await using a = new Bun.WebView({ width: 100, height: 100, dataStore });
    await a.navigate(url);
    await a.evaluate("localStorage.setItem('k', 'survives')");
  }

  // Fresh view, same directory — storage persists.
  await using b = new Bun.WebView({ width: 100, height: 100, dataStore });
  await b.navigate(url);
  const got = await b.evaluate("String(localStorage.getItem('k'))");
  expect(got).toBe("survives");
});

it("ephemeral dataStore: localStorage does NOT survive across instances", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("<!doctype html><body>ok</body>", { headers: { "content-type": "text/html" } }),
  });
  const url = `http://127.0.0.1:${server.port}/`;

  {
    await using a = new Bun.WebView({ width: 100, height: 100 }); // default: ephemeral
    await a.navigate(url);
    await a.evaluate("localStorage.setItem('k', 'leaks?')");
  }

  await using b = new Bun.WebView({ width: 100, height: 100 });
  await b.navigate(url);
  const got = await b.evaluate("String(localStorage.getItem('k'))");
  expect(got).toBe("null");
});

test.todo("startFrameStream: onFrame fires with shm PNG");
