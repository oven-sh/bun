// The spawn-mode transport (Chrome's --remote-debugging-pipe: commands on the
// child's fd 3, replies on fd 4; one socketpair on POSIX, two pipes driven by
// libuv on Windows) exercised without a browser: fake-chrome-fixture.ts is
// spawned in Chrome's place, so this runs on every platform, including CI
// agents that cannot start a real browser. webview-chrome.test.ts covers the
// real thing where one is installed.
//
// Each scenario runs in its own bun process because the transport is a
// process-wide singleton and several scenarios destroy it on purpose. A
// scenario prints one JSON value; `outcome()` turns a promise into
// { resolved } or { rejected: message }.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fake-chrome-fixture.ts");

// Same bytes fake-chrome-fixture.ts returns for Page.captureScreenshot.
const SCREENSHOT_BYTES = Buffer.alloc(100_000);
for (let i = 0; i < SCREENSHOT_BYTES.length; i++) SCREENSHOT_BYTES[i] = (i * 7) & 0xff;

// 300 KB of varying content, several times the transport's read buffer; built
// from this expression on whichever side needs it rather than passed around,
// since scenarios travel on the command line.
const BIG = "Array.from({ length: 300000 }, (_, i) => i % 10).join('')";

const prelude = /* js */ `
  const backend = {
    type: "chrome",
    url: false,
    path: ${JSON.stringify(bunExe())},
    argv: [${JSON.stringify(fixture)}],
    stderr: "inherit",
  };
  const newView = () => new Bun.WebView({ backend, width: 100, height: 100 });
  const outcome = promise => promise.then(resolved => ({ resolved }), e => ({ rejected: e.message }));
  const print = value => console.log(JSON.stringify(value));
  const big = ${BIG};
`;

async function runScenario(body: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// Whichever of the two notifications (the pipe breaking, the process exit)
// the event loop sees first decides the message.
const transportLost = {
  rejected: expect.stringMatching(/^Chrome (process closed the pipe|exited|killed by signal \d+)$/),
};

test.concurrent("navigate, events and evaluate cross the pipes", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const value = await view.evaluate("({ answer: 6 * 7, text: 'from the fake' })");
    const undef = typeof (await view.evaluate("undefined"));
    print({ url: view.url, title: view.title, value, undef });
    view.close();
  `);
  expect(result).toEqual({
    url: "http://fake/page",
    title: "fake chrome",
    value: { answer: 42, text: "from the fake" },
    undef: "undefined",
  });
});

test.concurrent("a reply larger than the read buffer is reassembled", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const value = await view.evaluate(${JSON.stringify(BIG)});
    print({ length: value.length, equal: value === big });
    view.close();
  `);
  expect(result).toEqual({ length: 300000, equal: true });
});

test.concurrent("a command larger than one write arrives whole", async () => {
  // The fake compares the 300 KB literal it received with a copy it builds itself.
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await view.evaluate(JSON.stringify(big) + " === " + ${JSON.stringify(BIG)}));
    view.close();
  `);
  expect(result).toBe(true);
});

test.concurrent("screenshot bytes survive the trip back", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const blob = await view.screenshot();
    const bytes = Buffer.from(await blob.arrayBuffer());
    print({ type: blob.type, size: bytes.length, hash: String(Bun.hash(bytes)) });
    view.close();
  `);
  expect(result).toEqual({
    type: "image/png",
    size: SCREENSHOT_BYTES.length,
    hash: String(Bun.hash(SCREENSHOT_BYTES)),
  });
});

test.concurrent("many views interleave their commands on the one transport", async () => {
  const result = await runScenario(`
    const views = Array.from({ length: 8 }, newView);
    await Promise.all(views.map((view, i) => view.navigate("http://fake/" + i)));
    const values = await Promise.all(views.map((view, i) => view.evaluate(String(i * 100))));
    print({ urls: views.map(view => view.url), values });
    for (const view of views) view.close();
  `);
  expect(result).toEqual({
    urls: Array.from({ length: 8 }, (_, i) => "http://fake/" + i),
    values: Array.from({ length: 8 }, (_, i) => i * 100),
  });
});

// Chrome has one default browser context (one cookie jar) per process. An
// ephemeral view (the default) gets a context of its own:
// Target.createBrowserContext precedes its Target.createTarget, the tab is
// created inside that context, and close() disposes it. A proxy rides on
// that context. A view with dataStore.directory lands in the default context.
test.concurrent("an ephemeral or proxied view gets its own browser context", async () => {
  const result = await runScenario(`
    const shared = new Bun.WebView({ backend, width: 100, height: 100, dataStore: { directory: "/tmp/unused" } });
    await shared.navigate("http://fake/shared");
    const own = newView();
    await own.navigate("http://fake/own");
    const proxied = new Bun.WebView({
      backend,
      width: 100,
      height: 100,
      proxy: { server: "http://127.0.0.1:1", bypass: ["localhost", "*.internal"] },
    });
    await proxied.navigate("http://fake/proxied");
    const asString = new Bun.WebView({ backend, width: 100, height: 100, proxy: "socks5://127.0.0.1:2" });
    await asString.navigate("http://fake/string");
    own.close();
    proxied.close();
    asString.close();
    print(await shared.evaluate("__fake_targets()"));
    shared.close();
  `);
  const tab = { url: "about:blank", newWindow: true, width: 100, height: 100 };
  expect(result).toEqual([
    { method: "Target.createTarget", params: tab },
    { method: "Target.createBrowserContext", params: { disposeOnDetach: true } },
    { method: "Target.createTarget", params: { ...tab, browserContextId: "C1" } },
    {
      method: "Target.createBrowserContext",
      params: { disposeOnDetach: true, proxyServer: "http://127.0.0.1:1", proxyBypassList: "localhost,*.internal" },
    },
    { method: "Target.createTarget", params: { ...tab, browserContextId: "C2" } },
    { method: "Target.createBrowserContext", params: { disposeOnDetach: true, proxyServer: "socks5://127.0.0.1:2" } },
    { method: "Target.createTarget", params: { ...tab, browserContextId: "C3" } },
    { method: "Target.disposeBrowserContext", params: { browserContextId: "C1" } },
    { method: "Target.disposeBrowserContext", params: { browserContextId: "C2" } },
    { method: "Target.disposeBrowserContext", params: { browserContextId: "C3" } },
  ]);
});

// close() while Target.createBrowserContext is still in flight: the reply is
// the only place the new context's id ever appears, so it must still be read
// and the context disposed. The scenario process also has to exit, so that
// in-flight entry must not hold the event loop open after the reply.
test.concurrent("close() before the browser context reply still disposes the context", async () => {
  const result = await runScenario(`
    const own = newView();
    const navigation = outcome(own.navigate("http://fake/own"));
    own.close();
    const shared = new Bun.WebView({ backend, width: 100, height: 100, dataStore: { directory: "/tmp/unused" } });
    await shared.navigate("http://fake/shared");
    print({ navigation: await navigation, targets: await shared.evaluate("__fake_targets()") });
    shared.close();
  `);
  expect(result).toEqual({
    navigation: { rejected: "WebView closed" },
    targets: [
      { method: "Target.createBrowserContext", params: { disposeOnDetach: true } },
      { method: "Target.createTarget", params: { url: "about:blank", newWindow: true, width: 100, height: 100 } },
      { method: "Target.disposeBrowserContext", params: { browserContextId: "C1" } },
    ],
  });
});

// Target.createTarget failing after the context was made: the context is
// disposed with the failure, and the retry creates a new one instead of
// reusing an id nothing else would ever clean up.
test.concurrent("a failed createTarget disposes the view's context and the retry creates a new one", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--cdp-error-on=Target.createTarget:1"] },
      width: 100,
      height: 100,
      dataStore: "ephemeral",
    });
    const first = await outcome(view.navigate("http://fake/first"));
    await view.navigate("http://fake/second");
    print({ first, targets: await view.evaluate("__fake_targets()") });
    view.close();
  `);
  const tab = { url: "about:blank", newWindow: true, width: 100, height: 100 };
  expect(result).toEqual({
    first: { rejected: "Cannot navigate to invalid URL" },
    targets: [
      { method: "Target.createBrowserContext", params: { disposeOnDetach: true } },
      { method: "Target.createTarget", params: { ...tab, browserContextId: "C1" } },
      { method: "Target.disposeBrowserContext", params: { browserContextId: "C1" } },
      { method: "Target.createBrowserContext", params: { disposeOnDetach: true } },
      { method: "Target.createTarget", params: { ...tab, browserContextId: "C2" } },
    ],
  });
});

// A Target.createBrowserContext failure (a Chrome that refuses incognito under
// policy) rejects navigate() with a message that names the option to drop.
test.concurrent("a refused browser context rejects navigate() with the cause", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--cdp-error-on=Target.createBrowserContext"] },
      width: 100,
      height: 100,
      dataStore: "ephemeral",
    });
    print(await outcome(view.navigate("http://fake/refused")));
    view.close();
  `);
  expect(result).toEqual({
    rejected: expect.stringMatching(
      /^Chrome refused a browser context for this view .*: Cannot navigate to invalid URL$/,
    ),
  });
});

test("proxy option validates", () => {
  const chrome = { type: "chrome" as const, url: false as const };
  expect(() => new Bun.WebView({ backend: chrome, proxy: 42 as any })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new Bun.WebView({ backend: chrome, proxy: { server: 1 as any } })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new Bun.WebView({ backend: chrome, proxy: { server: "http://p:1", bypass: "x" as any } })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new Bun.WebView({ backend: chrome, proxy: "" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
  expect(() => new Bun.WebView({ backend: "webkit", proxy: "http://p:1" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message: expect.stringContaining('backend: "chrome"') }),
  );
  expect(
    () => new Bun.WebView({ backend: chrome, proxy: "http://p:1", dataStore: { directory: "/tmp/never-used" } }),
  ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message: expect.stringContaining("directory") }));
  expect(() => new Bun.WebView({ backend: chrome, proxy: "http://p:1", dataStore: { directory: "" } })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message: expect.stringContaining("directory") }),
  );
});

test.concurrent("an expression that throws rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await outcome(view.evaluate("(() => { throw new Error('inside the fake'); })()")));
    view.close();
  `);
  expect(result).toEqual({ rejected: expect.stringContaining("inside the fake") });
});

test.concurrent("the browser exiting rejects what it owed, and the next WebView respawns it", async () => {
  const result = await runScenario(`
    const first = newView();
    await first.navigate("http://fake/1");
    const death = await outcome(first.evaluate("__fake_exit(3)"));
    // Construction fails until the old process has been reaped; retry.
    let second;
    for (;;) {
      try {
        second = newView();
        break;
      } catch (e) {
        if (!/Failed to spawn Chrome/.test(e.message)) throw e;
        await Bun.sleep(1);
      }
    }
    await second.navigate("http://fake/2");
    print({ death, second: await second.evaluate("'alive again'") });
    second.close();
  `);
  expect(result).toEqual({ death: transportLost, second: "alive again" });
});

// close() is a user-initiated teardown, so the rejection of an in-flight
// operation must not surface as an unhandled rejection. The constructor's
// `url:` navigation is the worst case: its promise is internal, so nothing in
// user code could ever catch it (#40991).
test.concurrent("close() during the constructor url navigation raises no unhandled rejection", async () => {
  const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const view = new Bun.WebView({ backend, width: 100, height: 100, url: "http://fake/initial" });
    view.close();
    // Nothing announces "no unhandled rejection is coming"; this is a
    // bounded window for one to appear (the reject itself ran synchronously).
    await Bun.sleep(50);
    print(unhandled);
  `);
  expect(result).toEqual([]);
});

test.concurrent("close() rejects a held navigate() catchably and a floating one quietly", async () => {
  const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const first = newView();
    const held = first.navigate("http://fake/held");
    first.close();
    const heldOutcome = await outcome(held);
    const second = newView();
    second.navigate("http://fake/floating");
    second.close();
    // Nothing announces "no unhandled rejection is coming"; this is a
    // bounded window for one to appear (the reject itself ran synchronously).
    await Bun.sleep(50);
    print({ heldOutcome, unhandled });
  `);
  expect(result).toEqual({ heldOutcome: { rejected: "WebView closed" }, unhandled: [] });
});

// The browser dying (instead of close()) rejects the same internal
// constructor-url promise; that must be quiet too. A floating user promise
// is the opposite: a crash is not a requested teardown, so its rejection
// must stay loud. --no-title-reply keeps the Navigate slot pending past
// onNavigated, like a real browser whose title fetch has not come back yet.
test.concurrent(
  "a browser death is quiet for the constructor url promise and loud for a floating evaluate",
  async () => {
    const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--no-title-reply"] },
      width: 100,
      height: 100,
      url: "http://fake/initial",
    });
    await new Promise(resolve => { view.onNavigated = resolve; });
    view.evaluate("__fake_exit(3)"); // floating: a crash rejection must stay loud
    const deadline = Date.now() + 5000;
    while (unhandled.length === 0 && Date.now() < deadline) await Bun.sleep(10);
    // Both slots reject in the same teardown call; if the internal navigate
    // promise were loud too, its report would land in the same window.
    await Bun.sleep(50);
    print(unhandled);
  `);
    expect(result).toEqual([expect.stringMatching(/^Chrome (process closed the pipe|exited|killed by signal \d+)$/)]);
  },
);

// A genuine navigation failure (Chrome answers Page.navigate with errorText)
// stays observable: a held navigate() rejects with that text, and the
// constructor url, whose promise is internal and marked handled, reports
// through onNavigationFailed like the WebKit backend does.
test.concurrent("a navigation that Chrome fails with errorText rejects and fires onNavigationFailed", async () => {
  const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const errBackend = { ...backend, argv: [...backend.argv, "--navigate-error=net::ERR_NAME_NOT_RESOLVED"] };
    const view = new Bun.WebView({ backend: errBackend, width: 100, height: 100 });
    const held = await outcome(view.navigate("http://fake/held"));
    view.close();
    const ctor = new Bun.WebView({ backend: errBackend, width: 100, height: 100, url: "http://fake/ctor" });
    const failed = await new Promise(resolve => { ctor.onNavigationFailed = resolve; });
    const loadingAfterFail = ctor.loading;
    ctor.close();
    // Nothing announces "no unhandled rejection is coming"; this is a
    // bounded window for one to appear (the reject itself ran synchronously).
    await Bun.sleep(50);
    print({ held, failedMessage: failed.message, loadingAfterFail, unhandled });
  `);
  expect(result).toEqual({
    held: { rejected: "net::ERR_NAME_NOT_RESOLVED" },
    failedMessage: "net::ERR_NAME_NOT_RESOLVED",
    loadingAfterFail: false,
    unhandled: [],
  });
});

// A CDP protocol error ({"error":{"code":-32000}}) can fail a navigation at
// any stage: the attach chain, or Page.navigate itself (real Chrome answers
// "Cannot navigate to invalid URL" this way). The constructor url has no
// promise the user can see, so the failure must reach onNavigationFailed and
// clear loading, and must not surface as an unhandled rejection.
test.concurrent("a CDP protocol error failing the constructor url fires onNavigationFailed", async () => {
  const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--cdp-error-on=Page.navigate"] },
      width: 100,
      height: 100,
      url: "http://fake/ctor",
    });
    const failed = await new Promise(resolve => { view.onNavigationFailed = resolve; });
    const loadingAfterFail = view.loading;
    view.close();
    // Nothing announces "no unhandled rejection is coming"; this is a
    // bounded window for one to appear (the reject itself ran synchronously).
    await Bun.sleep(50);
    print({ failedMessage: failed.message, loadingAfterFail, unhandled });
  `);
  expect(result).toEqual({
    failedMessage: "Cannot navigate to invalid URL",
    loadingAfterFail: false,
    unhandled: [],
  });
});

// The quiet close() is scoped to promises rejected BY the teardown. A
// genuine failure of a floating user navigate() must stay loud, or a future
// over-suppression refactor would pass the whole suite.
test.concurrent("a floating navigate() that genuinely fails still raises an unhandled rejection", async () => {
  const result = await runScenario(`
    const unhandled = [];
    process.on("unhandledRejection", e => unhandled.push(e.message));
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--navigate-error=net::ERR_NAME_NOT_RESOLVED"] },
      width: 100,
      height: 100,
    });
    view.navigate("http://fake/floating"); // floating: nobody handles it
    await new Promise(resolve => { view.onNavigationFailed = resolve; });
    // Nothing announces "no unhandled rejection is coming"; this is a
    // bounded window for one to appear (the reject itself ran synchronously).
    await Bun.sleep(50);
    view.close();
    print(unhandled);
  `);
  expect(result).toEqual(["net::ERR_NAME_NOT_RESOLVED"]);
});

// The navigate slot settles before onNavigationFailed runs, so the callback
// can retry with navigate() instead of hitting ERR_INVALID_STATE.
test.concurrent("onNavigationFailed can retry navigate() immediately", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--navigate-error=net::ERR_NAME_NOT_RESOLVED"] },
      width: 100,
      height: 100,
    });
    let retried = false;
    const outcomeStr = await new Promise(resolve => {
      view.onNavigationFailed = () => {
        if (retried) return resolve("retry was accepted and failed too");
        retried = true;
        try {
          view.navigate("http://fake/retry").catch(() => {});
        } catch (err) {
          resolve("retry threw " + err.code);
        }
      };
      view.navigate("http://fake/first").catch(() => {});
    });
    view.close();
    print(outcomeStr);
  `);
  expect(result).toBe("retry was accepted and failed too");
});

// `bun test --isolate` replaces the global object between files. The transport
// is bound to the global that spawned the browser, so it has to go with that
// file: its open views are closed, their pending promises rejected, and the
// next file spawns a browser of its own. The fake outlives its pipes by 20 s
// like a real browser shutting down, so the next file cannot depend on the
// old process having gone away by itself.
test.concurrent("bun test --isolate retires the transport with the file that spawned it", async () => {
  const file = /* js */ `
    import { test } from "bun:test";
    const backend = {
      type: "chrome",
      url: false,
      path: ${JSON.stringify(bunExe())},
      argv: [${JSON.stringify(fixture)}, "--exit-delay=20000"],
      stderr: "inherit",
    };
    test("leaves a view open with a command in flight", async () => {
      const view = new Bun.WebView({ backend, width: 100, height: 100 });
      await view.navigate("http://fake/" + import.meta.file);
      console.log(JSON.stringify({ file: import.meta.file, url: view.url }));
      view.evaluate("__fake_no_reply()").catch(e => {
        console.log(JSON.stringify({ file: import.meta.file, rejected: e.message, isError: e instanceof Error }));
      });
    });
  `;
  using dir = tempDir("webview-isolate", { "a.test.ts": file, "b.test.ts": file });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.ts", "b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The first stdout line is the `bun test` banner.
  const lines = stdout
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line));
  // The first file's evaluate is rejected when its global retires; the second
  // file's is still in flight when the run ends. Discovery order decides
  // which file is which.
  const [first, second] = lines[0]?.file === "b.test.ts" ? ["b.test.ts", "a.test.ts"] : ["a.test.ts", "b.test.ts"];
  expect(lines).toEqual([
    { file: first, url: "http://fake/" + first },
    { file: first, rejected: "WebView closed: its test file finished", isError: true },
    { file: second, url: "http://fake/" + second },
  ]);
  expect(stderr).toContain(" 2 pass");
  expect(exitCode).toBe(0);
});

// On POSIX fd 3 and fd 4 are one socket, so losing a single direction is not
// a state that exists there; on Windows they are two pipes with two failure
// modes of their own.
const windowsOnly = isWindows ? test.concurrent : test.skip;

windowsOnly("the reply pipe closing while the process lives rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await outcome(view.evaluate("__fake_close_replies()")));
  `);
  expect(result).toEqual({ rejected: "Chrome process closed the pipe" });
});

windowsOnly("a write to a command pipe nobody reads any more rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const closing = await outcome(view.evaluate("__fake_close_commands()"));
    const next = await outcome(view.evaluate("1"));
    print({ closing, next });
  `);
  expect(result).toEqual({ closing: {}, next: { rejected: "Chrome process closed the pipe" } });
});
