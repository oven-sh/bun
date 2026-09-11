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
  // The page runs \`script\` as the fake reads the view's next \`method\` command, before it answers.
  const pageDoesOnNext = (view, method, script) =>
    view.evaluate("__fake_on_next(" + JSON.stringify(method) + ", " + JSON.stringify(script) + ")");
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

// A same-document navigation (a #fragment target, or a history traversal
// between two entries of one document) fires no load event, so the promise
// has to settle on Page.navigatedWithinDocument instead. The slot is shared,
// so a navigation that never settles wedges every later one.
test.concurrent("a same-document navigation settles navigate(), goBack() and goForward()", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const urls = [];
    view.onNavigated = url => urls.push(url);
    await view.navigate("http://fake/page#one");
    const afterFragment = { url: view.url, loading: view.loading };
    await view.goBack();
    const afterBack = view.url;
    await view.goForward();
    print({ afterFragment, afterBack, afterForward: view.url, urls });
    view.close();
  `);
  expect(result).toEqual({
    afterFragment: { url: "http://fake/page#one", loading: false },
    afterBack: "http://fake/page",
    afterForward: "http://fake/page#one",
    urls: ["http://fake/page#one", "http://fake/page", "http://fake/page#one"],
  });
});

// Page.frameNavigated reports the fragment in frame.urlFragment, not in
// frame.url, and a subframe's commit arrives on the same session as the main
// frame's. view.url is the main frame's document URL, fragment and all.
test.concurrent("view.url follows the main frame and keeps its fragment", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--subframe-navigation"] },
      width: 100,
      height: 100,
    });
    const urls = [];
    view.onNavigated = url => urls.push(url);
    await view.navigate("http://fake/page#one");
    print({ url: view.url, title: view.title, urls });
    view.close();
  `);
  expect(result).toEqual({
    url: "http://fake/page#one",
    title: "fake chrome",
    urls: ["http://fake/page#one"],
  });
});

// A same-document commit the page makes on its own (an SPA router, a
// scroll-driven location.hash) fires onNavigated with nothing pending. A
// navigate() started from inside that callback is a new, cross-document
// navigation: the commit that ran the callback must not settle it or clear
// view.loading. Its page never loads here, so it has to stay pending.
test.concurrent("a navigate() started from onNavigated of the page's own commit waits for its own load", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    let started;
    view.onNavigated = url => {
      if (url.endsWith("#spa")) started = view.navigate("http://fake/never-load");
    };
    await view.evaluate("__fake_replace_state('http://fake/page#spa')");
    const loading = view.loading;
    // The fake answers commands in order, so if the commit had queued a title
    // fetch for the new navigation, its reply would beat this evaluate's.
    const first = await Promise.race([
      started.then(() => "navigate() settled before its page loaded", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ loading, first });
    view.close();
  `);
  expect(result).toEqual({ loading: true, first: "navigate() still pending" });
});

// Page.loadEventFired names no frame and no loader, so it is the load event
// of whatever document is live. A document the page navigated to on its own
// can finish loading after navigate() was called and before the navigation
// commits. That load event is not the navigation's.
test.concurrent("a load event from a document the view did not ask for settles nothing", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const started = view.navigate("http://fake/never-load");
    await view.evaluate("__fake_load_event()");
    const first = await Promise.race([
      started.then(() => "navigate() settled", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ first, loading: view.loading, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    first: "navigate() still pending",
    loading: true,
    url: "http://fake/page",
  });
});

// goBack() fills the slot and then looks the history entry up before it asks
// Chrome to traverse. A same-document commit of the page's own that lands
// during the lookup is not the traversal and must not settle the promise.
test.concurrent("goBack() is not settled by a commit of the page's own during the history lookup", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/a");
    await view.navigate("http://fake/b");
    await pageDoesOnNext(view, "Page.getNavigationHistory", "__fake_replace_state('http://fake/b#spa')");
    const urls = [];
    view.onNavigated = url => urls.push(url);
    await view.goBack();
    print({ url: view.url, urls });
    view.close();
  `);
  expect(result).toEqual({ url: "http://fake/a", urls: ["http://fake/b#spa", "http://fake/a"] });
});

// The same for the load event of a document the page navigated to during the
// lookup: that document committed before the traversal was asked for, so its
// load is not the traversal's. The traversal here never commits, so the
// promise has to stay pending.
test.concurrent("goBack() is not settled by the load of a document it did not commit", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/a");
    await view.navigate("http://fake/stall-on-return");
    await pageDoesOnNext(view, "Page.getNavigationHistory", "__fake_page_commit('http://fake/own')");
    const started = view.goBack();
    // The fake answers in order, so this resolves after it answered the
    // history lookup: the traversal command is out and has not committed.
    await view.evaluate("1");
    await view.evaluate("__fake_load_event()");
    const first = await Promise.race([
      started.then(() => "goBack() settled", () => "goBack() rejected"),
      view.evaluate("'goBack() still pending'"),
    ]);
    print({ first, url: view.url });
    view.close();
  `);
  expect(result).toEqual({ first: "goBack() still pending", url: "http://fake/own" });
});

// Chrome answers a traversal at once and commits it later: a cross-document
// one only after the network answered. history.pushState() and
// history.replaceState() of the page being left (a router, a scroll position
// saved in beforeunload) land in between. They report "historyApi", which a
// traversal never does, and must not settle the promise: the target here
// never commits, so goBack() has to stay pending.
test.concurrent("goBack() is not settled by the page's own replaceState() behind the traversal's reply", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/stall-on-return");
    await view.navigate("http://fake/b");
    const started = view.goBack();
    // The fake answers in order, so this resolves after it answered the
    // history lookup: the traversal command is out. The next evaluate is
    // behind that command, so the fake has answered the traversal by then.
    await view.evaluate("1");
    await view.evaluate("__fake_replace_state('http://fake/b?scroll=1')");
    const first = await Promise.race([
      started.then(() => "goBack() settled", () => "goBack() rejected"),
      view.evaluate("'goBack() still pending'"),
    ]);
    print({ first, url: view.url });
    view.close();
  `);
  expect(result).toEqual({ first: "goBack() still pending", url: "http://fake/b?scroll=1" });
});

// The same window exists behind the reply of a #fragment navigate().
test.concurrent("navigate() to a #fragment is not settled by the page's own replaceState()", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const started = view.navigate("http://fake/page#never-load");
    await view.evaluate("__fake_replace_state('http://fake/page?scroll=1')");
    const first = await Promise.race([
      started.then(() => "navigate() settled", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ first, loading: view.loading, url: view.url });
    view.close();
  `);
  expect(result).toEqual({ first: "navigate() still pending", loading: true, url: "http://fake/page?scroll=1" });
});

// A navigation that reaches the runtime after it wrote a navigation command,
// but before Chrome answered it, cannot be that command's: Chrome answers a
// navigation before its document commits.
test.concurrent("a navigation that arrives before the navigate command is answered settles nothing", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    await pageDoesOnNext(view, "Page.navigate", "__fake_replace_state('http://fake/page#spa')");
    const started = view.navigate("http://fake/never-load");
    const first = await Promise.race([
      started.then(() => "navigate() settled", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ first, loading: view.loading, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    first: "navigate() still pending",
    loading: true,
    url: "http://fake/page#spa",
  });
});

// Once the commit that ends a navigation has queued its title fetch, the
// navigation is over. A second same-document commit behind it (a hashchange
// handler rewriting the URL) is the page's own and fetches nothing.
test.concurrent("a second same-document commit does not fetch the title again", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    // The fake counts document.title fetches only, so the difference is what
    // the navigation below sent.
    const before = await view.evaluate("__fake_title_fetches()");
    // The next Runtime.evaluate the fake reads is the navigation's title fetch.
    await pageDoesOnNext(view, "Runtime.evaluate", "__fake_replace_state('http://fake/page#canonical')");
    await view.navigate("http://fake/page#one");
    const titleFetches = (await view.evaluate("__fake_title_fetches()")) - before;
    print({ url: view.url, titleFetches });
    view.close();
  `);
  expect(result).toEqual({ url: "http://fake/page#canonical", titleFetches: 1 });
});

// A history traversal onto a page Chrome kept in its back-forward cache
// commits with type "BackForwardCacheRestore" and fires no load event: the
// page is complete as it commits, so goBack() settles there.
test.concurrent("goBack() onto a page restored from the back-forward cache settles", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/bfcached#top");
    await view.navigate("http://fake/b");
    const urls = [];
    view.onNavigated = url => urls.push(url);
    await view.goBack();
    const afterBack = { url: view.url, loading: view.loading };
    await view.goForward();
    print({ afterBack, afterForward: view.url, urls });
    view.close();
  `);
  expect(result).toEqual({
    afterBack: { url: "http://fake/bfcached#top", loading: false },
    afterForward: "http://fake/b",
    urls: ["http://fake/bfcached#top", "http://fake/b"],
  });
});

// After a load fails, Chrome commits its own error page
// (chrome-error://chromewebdata/, with frame.unreachableUrl naming the page it
// stands in for) and fires that page's load event. Neither is a navigation of
// the view's: navigate() already rejected with the errorText of its reply, so
// the error page reports nothing more, and view.url and view.title keep the
// last real page.
test.concurrent("a failed navigate() reports one failure and Chrome's error page changes nothing", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const failed = await outcome(view.navigate("http://fake/unreachable"));
    // The fake sent the error page's commit and load event behind the reply,
    // and it answers in order, so both are handled once this resolves.
    await view.evaluate("1");
    print({ failed, events, url: view.url, title: view.title, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    failed: { rejected: "net::ERR_CONNECTION_REFUSED" },
    events: ["failed:net::ERR_CONNECTION_REFUSED"],
    url: "http://fake/before",
    title: "fake chrome",
    loading: false,
  });
});

// That error page can land after a retry from onNavigationFailed was answered.
// It commits under a loader that no reply named (Chromium 139 and older), so
// only the order says whose it is: the next error page behind a failed
// navigate() is that failure's. It is not the retry's commit, its load event
// does not end the retry, and it is not a second failure. The retry's page
// never loads here, so the retry has to stay pending.
test.concurrent("the error page of a failed navigate() ends nothing for the retry behind it", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    let retry;
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => {
      events.push("failed:" + error.message);
      retry ??= view.navigate("http://fake/never-load");
    };
    await outcome(view.navigate("http://fake/unreachable-late"));
    // This evaluate is behind the retry's command, so the fake has answered
    // the retry by the time it commits the error page.
    await view.evaluate("__fake_error_page('http://fake/unreachable-late')");
    const first = await Promise.race([
      retry.then(() => "retry settled", () => "retry rejected"),
      view.evaluate("'retry still pending'"),
    ]);
    print({ first, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    first: "retry still pending",
    events: ["failed:net::ERR_CONNECTION_REFUSED"],
    url: "http://fake/before",
    loading: true,
  });
});

// A load the page starts itself can fail too. Its error page is the only sign:
// onNavigationFailed fires once that page has loaded. reload() then loads the
// failed URL again, fails again, and rejects instead of resolving on the error
// page's load event.
test.concurrent("a failed load the page started fires onNavigationFailed, and reload() of it rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/start");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    const afterLink = { events: [...events], url: view.url };
    const reloaded = await outcome(view.reload());
    print({ afterLink, reloaded, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    afterLink: { events: ["failed:Navigation to http://fake/unreachable-link failed"], url: "http://fake/start" },
    reloaded: { rejected: "Navigation to http://fake/unreachable-link failed" },
    events: [
      "failed:Navigation to http://fake/unreachable-link failed",
      "failed:Navigation to http://fake/unreachable-link failed",
    ],
    url: "http://fake/start",
    loading: false,
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
