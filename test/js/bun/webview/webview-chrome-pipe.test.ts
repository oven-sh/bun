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
    const afterForward = view.url;
    // The URL the view is already at is a same-document navigation too.
    await view.navigate("http://fake/page#one");
    print({ afterFragment, afterBack, afterForward, afterSame: view.url, urls });
    view.close();
  `);
  expect(result).toEqual({
    afterFragment: { url: "http://fake/page#one", loading: false },
    afterBack: "http://fake/page",
    afterForward: "http://fake/page#one",
    afterSame: "http://fake/page#one",
    urls: ["http://fake/page#one", "http://fake/page", "http://fake/page#one", "http://fake/page#one"],
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

// A load the page started on its own (a link, location.href) still refreshes
// view.title once it finishes, with nothing to settle.
test.concurrent("a load the page started on its own updates view.title", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const before = await view.evaluate("__fake_title_fetches()");
    await view.evaluate("__fake_page_commit('http://fake/own')");
    await view.evaluate("__fake_load_event()");
    const titleFetches = (await view.evaluate("__fake_title_fetches()")) - before;
    print({ url: view.url, title: view.title, loading: view.loading, titleFetches });
    view.close();
  `);
  expect(result).toEqual({ url: "http://fake/own", title: "page's own", loading: false, titleFetches: 1 });
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

// A #fragment change of the page being left (a scroll spy, a link the user
// follows) reports "fragment" like a traversal's own commit does. The
// traversal's commit lands on the entry it asked for, and this one does not.
test.concurrent("goBack() is not settled by a #fragment change of the page being left", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/stall-on-return");
    await view.navigate("http://fake/b");
    const started = view.goBack();
    // See the test above: the fake has answered the traversal by the second evaluate.
    await view.evaluate("1");
    await view.evaluate("__fake_hash_change('http://fake/b#section')");
    const first = await Promise.race([
      started.then(() => "goBack() settled", () => "goBack() rejected"),
      view.evaluate("'goBack() still pending'"),
    ]);
    print({ first, url: view.url });
    view.close();
  `);
  expect(result).toEqual({ first: "goBack() still pending", url: "http://fake/b#section" });
});

// The entry's URL comes from the history reply and the commit's from the
// event. Chrome escapes a quote in both, so they have to be compared decoded.
test.concurrent("goBack() settles over a same-document entry whose URL needs a JSON escape", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    await view.navigate('http://fake/page#"quoted"');
    await view.navigate("http://fake/page#two");
    print(await outcome(view.goBack()));
    view.close();
  `);
  expect(result).toEqual({});
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

// Chrome's reply to Page.navigate says same-document when it plans no load,
// but the renderer can still load a document for it: a <frameset> page, or a
// pushState() that races the request. The commit that arrives is the
// navigation's, and its load ends it.
test.concurrent("a same-document navigate() that the renderer turns into a load settles on that load", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/restarts");
    await view.navigate("http://fake/restarts#x");
    print({ url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({ url: "http://fake/restarts#x", loading: false });
});

// A page whose Navigation API handler calls preventDefault() cancels the
// navigation: Chrome answers it, never commits it, and reports the frame idle.
test.concurrent("a same-document navigate() that the page cancels rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/cancelled");
    const failed = [];
    view.onNavigationFailed = e => failed.push(e.message);
    const cancelled = await outcome(view.navigate("http://fake/cancelled#x"));
    const after = { url: view.url, loading: view.loading };
    await view.navigate("http://fake/page");
    print({ cancelled, failed, after, next: view.url });
    view.close();
  `);
  expect(result).toEqual({
    cancelled: { rejected: "navigation cancelled by the page" },
    failed: ["navigation cancelled by the page"],
    after: { url: "http://fake/cancelled", loading: false },
    next: "http://fake/page",
  });
});

// A #fragment navigate() while the document still loads: if the page cancels
// it, the frame reports no stop of its own, so the document's load ends the
// navigation. If the commit comes after the load, it still updates view.url.
test.concurrent("a #fragment navigate() issued while the document loads ends with that load", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const started = view.navigate("http://fake/page#never-load");
    // The document's own load ends: Page.loadEventFired, then the frame stops.
    await view.evaluate("__fake_load_event()");
    await view.evaluate("__fake_frame_stopped_loading()");
    print(await outcome(started.then(() => ({ url: view.url, loading: view.loading }))));
    view.close();
  `);
  expect(result).toEqual({ resolved: { url: "http://fake/page", loading: false } });
});

// A traversal can end on either commit kind, but once its document has
// committed only that document's load ends it. A page that changes its hash
// as it boots commits a same-document navigation before its load event.
test.concurrent("goBack() onto a page that changes its hash as it loads waits for the load", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/boot-hash");
    await view.navigate("http://fake/b");
    const before = await view.evaluate("__fake_title_fetches()");
    const urls = [];
    view.onNavigated = url => urls.push(url);
    await view.goBack();
    const titleFetches = (await view.evaluate("__fake_title_fetches()")) - before;
    print({ url: view.url, urls, titleFetches });
    view.close();
  `);
  expect(result).toEqual({
    url: "http://fake/boot-hash#booted",
    urls: ["http://fake/boot-hash", "http://fake/boot-hash#booted"],
    titleFetches: 1,
  });
});

// A page whose Navigation API intercepts its navigations reports "other" for
// the view's own #fragment navigate() and traversal, the same as for its own.
// Only "historyApi" is known to be the page's own.
test.concurrent("a same-document navigation the page's Navigation API intercepted settles", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/intercepted");
    await view.navigate("http://fake/intercepted#x");
    const afterFragment = view.url;
    await view.goBack();
    print({ afterFragment, afterBack: view.url });
    view.close();
  `);
  expect(result).toEqual({ afterFragment: "http://fake/intercepted#x", afterBack: "http://fake/intercepted" });
});

// navigationType arrived in Chrome 129. Without it every same-document commit
// ends the pending navigation, so an older Chrome never hangs.
test.concurrent("a Chrome that sends no navigationType still settles same-document navigations", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/no-navigation-type");
    await view.navigate("http://fake/no-navigation-type#x");
    await view.goBack();
    print({ url: view.url });
    view.close();
  `);
  expect(result).toEqual({ url: "http://fake/no-navigation-type" });
});

// An <iframe>'s own same-document navigation arrives on the same session.
// It is not the view's.
test.concurrent("an iframe's #fragment change settles nothing", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const urls = [];
    view.onNavigated = url => urls.push(url);
    const started = view.navigate("http://fake/page#never-load");
    await view.evaluate("__fake_subframe_hash_change('http://fake/subframe#in')");
    const first = await Promise.race([
      started.then(() => "navigate() settled", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ first, loading: view.loading, url: view.url, urls });
    view.close();
  `);
  expect(result).toEqual({ first: "navigate() still pending", loading: true, url: "http://fake/page", urls: [] });
});

// The title fetch after a load the view did not ask for can fail (the
// document is gone by the time the renderer runs it). That failure is not
// the pending navigation's.
test.concurrent("a failed title refresh neither rejects nor ends a pending navigate()", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const failed = [];
    view.onNavigationFailed = e => failed.push(e.message);
    const started = view.navigate("http://fake/never-load");
    await view.evaluate("__fake_fail_next_title_fetch()");
    await view.evaluate("__fake_load_event()");
    const first = await Promise.race([
      started.then(() => "navigate() settled", () => "navigate() rejected"),
      view.evaluate("'navigate() still pending'"),
    ]);
    print({ first, failed, loading: view.loading, title: view.title });
    view.close();
  `);
  expect(result).toEqual({ first: "navigate() still pending", failed: [], loading: true, title: "fake chrome" });
});

// Page.navigatedWithinDocument was never intercepted, so a listener for it has
// always heard it. The view's own bookkeeping on it must not end that.
test.concurrent("Page.navigatedWithinDocument still reaches addEventListener()", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const heard = [];
    view.addEventListener("Page.navigatedWithinDocument", event => heard.push(event.data.url));
    await view.navigate("http://fake/page#one");
    await view.evaluate("__fake_replace_state('http://fake/page#spa')");
    print(heard);
    view.close();
  `);
  expect(result).toEqual(["http://fake/page#one", "http://fake/page#spa"]);
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

test.concurrent("navigate() rejects with a generic message when errorText isn't valid UTF-8", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--malformed=navigate-bad-utf8"] },
      width: 100,
      height: 100,
    });
    let failedMessage;
    view.onNavigationFailed = e => { failedMessage = e.message; };
    const held = await outcome(view.navigate("http://fake/"));
    const loadingAfterFail = view.loading;
    view.close();
    print({ held, failedMessage, loadingAfterFail });
  `);
  expect(result).toEqual({
    held: { rejected: "navigation failed" },
    failedMessage: "navigation failed",
    loadingAfterFail: false,
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

// After a load fails, Chrome commits its own error page
// (chrome-error://chromewebdata/, with frame.unreachableUrl naming the page it
// stands in for) and fires that page's load event. Neither is a navigation of
// the view's: navigate() already rejected with the errorText of its reply, so
// the error page reports nothing more. view.url and view.title stay as they
// were when it committed, and its own title is never asked for.
test.concurrent("a failed navigate() reports one failure and Chrome's error page changes nothing", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const before = await view.evaluate("__fake_title_fetches()");
    const failed = await outcome(view.navigate("http://fake/unreachable"));
    // The fake sent the error page's commit and load event behind the reply,
    // and it answers in order, so both are handled once this resolves.
    await view.evaluate("1");
    const titleFetches = (await view.evaluate("__fake_title_fetches()")) - before;
    print({ failed, events, url: view.url, title: view.title, loading: view.loading, titleFetches });
    view.close();
  `);
  expect(result).toEqual({
    failed: { rejected: "net::ERR_CONNECTION_REFUSED" },
    events: ["failed:net::ERR_CONNECTION_REFUSED"],
    url: "http://fake/before",
    title: "fake chrome",
    loading: false,
    titleFetches: 0,
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

// The retry can fail as well, and Chrome can answer it before the first error
// page has committed. Then two error pages are due, one per failure that
// navigate() reported, and neither is a third failure.
test.concurrent("two failed navigate() calls in a row report two failures, not three", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    let retry;
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => {
      events.push("failed:" + error.message);
      retry ??= outcome(view.navigate("http://fake/unreachable-late-2"));
    };
    await outcome(view.navigate("http://fake/unreachable-late-1"));
    const retried = await retry;
    // Both replies are in. Now the two error pages commit and load, in order.
    await view.evaluate("__fake_error_page('http://fake/unreachable-late-1')");
    await view.evaluate("__fake_error_page('http://fake/unreachable-late-2')");
    print({ retried, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    retried: { rejected: "net::ERR_CONNECTION_REFUSED" },
    events: ["failed:net::ERR_CONNECTION_REFUSED", "failed:net::ERR_CONNECTION_REFUSED"],
    url: "http://fake/before",
    loading: false,
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
    const before = await view.evaluate("__fake_title_fetches()");
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    const afterLink = { events: [...events], url: view.url };
    const reloaded = await outcome(view.reload());
    const titleFetches = (await view.evaluate("__fake_title_fetches()")) - before;
    print({ afterLink, reloaded, events, url: view.url, title: view.title, loading: view.loading, titleFetches });
    view.close();
  `);
  expect(result).toEqual({
    afterLink: { events: ["failed:Navigation to 'http://fake/unreachable-link' failed"], url: "http://fake/start" },
    reloaded: { rejected: "Navigation to 'http://fake/unreachable-link' failed" },
    events: [
      "failed:Navigation to 'http://fake/unreachable-link' failed",
      "failed:Navigation to 'http://fake/unreachable-link' failed",
    ],
    url: "http://fake/start",
    title: "fake chrome",
    loading: false,
    titleFetches: 0,
  });
});

// The failure is reported by the URL the error page names. Bytes in it that
// aren't UTF-8 must not lose the report: the navigation that waits for it
// would never settle.
test.concurrent("an error page whose unreachableUrl isn't valid UTF-8 still fails the navigation", async () => {
  const result = await runScenario(`
    const view = new Bun.WebView({
      backend: { ...backend, argv: [...backend.argv, "--malformed=error-page-bad-utf8"] },
      width: 100,
      height: 100,
    });
    await view.navigate("http://fake/start");
    const failures = [];
    view.onNavigationFailed = error => failures.push(error.message);
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    const reloaded = await outcome(view.reload());
    print({ reloaded, failures, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    reloaded: { rejected: "Navigation to '\uFFFDot-utf8' failed" },
    failures: ["Navigation to '\uFFFDot-utf8' failed", "Navigation to '\uFFFDot-utf8' failed"],
    url: "http://fake/start",
  });
});

// The failure names the URL that Chrome gave, with its JSON escapes decoded
// and without credentials, the way fetch() and WebSocket name a URL in an
// error.
test.concurrent("the failure names the URL without its credentials", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/start");
    const failures = [];
    view.onNavigationFailed = error => failures.push(error.message);
    // A backslash is a character Chrome has to escape in the JSON it sends.
    const failing = "http://user:secret@fake/unreachable?path=C:" + String.fromCharCode(92) + "dir";
    await view.evaluate("__fake_error_page(" + JSON.stringify(failing) + ")");
    print(failures);
    view.close();
  `);
  expect(result).toEqual(["Navigation to 'http://fake/unreachable?path=C:\\dir' failed"]);
});

// Between the error page's commit and its load event Chrome is still swapping
// the page in, and answers a command with "Not attached to an active page".
// So the failure is reported when the error page has loaded, and a retry from
// the callback reaches a tab that takes commands.
test.concurrent("a failed load the page started is reported when its error page has loaded", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/start");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    // The reply to this evaluate is behind the commit in the pipe.
    await view.evaluate("__fake_error_page_commit('http://fake/unreachable-link')");
    const atCommit = [...events];
    await view.evaluate("__fake_load_event()");
    print({ atCommit, atLoad: events, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    atCommit: [],
    atLoad: ["failed:Navigation to 'http://fake/unreachable-link' failed"],
    url: "http://fake/start",
  });
});

test.concurrent("reload() of a page that fails rejects when the error page has loaded", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/start");
    // The page follows a link that fails: the entry to reload.
    await view.evaluate("__fake_error_page('http://fake/unreachable-slow')");
    const events = [];
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const reloading = outcome(view.reload());
    // The fake answered Page.reload and committed the error page, without its
    // load event. This evaluate is behind both. A rejection fires
    // onNavigationFailed first, so the callback says whether reload() settled.
    await view.evaluate("1");
    const atCommit = [...events];
    await view.evaluate("__fake_load_event()");
    print({ atCommit, reloaded: await reloading, events, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    atCommit: [],
    reloaded: { rejected: "Navigation to 'http://fake/unreachable-slow' failed" },
    events: ["failed:Navigation to 'http://fake/unreachable-slow' failed"],
    loading: false,
  });
});

// Chrome 143 and 153 commit the first error page before they answer a retry
// from onNavigationFailed, and a retry that fails too replaces that page
// before its load event. Each error page takes one reported failure as it
// commits, so a load the page starts afterwards and that fails is reported.
test.concurrent("an error page that never loads still takes the failure navigate() reported", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    let retry;
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => {
      events.push("failed:" + error.message);
      retry ??= outcome(view.navigate("http://fake/unreachable-late-2"));
    };
    // The first error page commits as the fake reads the retry, before it
    // answers the retry.
    await pageDoesOnNext(
      view,
      "Page.navigate",
      "__fake_on_next('Page.navigate', \\"__fake_error_page_commit('http://fake/unreachable-late-1')\\")",
    );
    await outcome(view.navigate("http://fake/unreachable-late-1"));
    const retried = await retry;
    await view.evaluate("__fake_error_page('http://fake/unreachable-late-2')");
    const afterRetry = [...events];
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    print({ retried, afterRetry, pageStarted: events.slice(afterRetry.length), url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    retried: { rejected: "net::ERR_CONNECTION_REFUSED" },
    afterRetry: ["failed:net::ERR_CONNECTION_REFUSED", "failed:net::ERR_CONNECTION_REFUSED"],
    pageStarted: ["failed:Navigation to 'http://fake/unreachable-link' failed"],
    url: "http://fake/before",
    loading: false,
  });
});

// Chrome does not always commit an error page for a failure that navigate()
// reported, or does not announce the commit. Chrome 153: the next navigate()
// is aborted (a 204, a download), and the first failure's error page then
// commits with no Page.frameNavigated, only its load event. One error page
// stays counted as due. reload() fails on an error page of its own, and no
// reply of reload() carries an errorText: if that page were taken for the one
// navigate() reported, the promise would never settle.
test.concurrent("reload() rejects on its own error page when one from a failed navigate() never came", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const failed = await outcome(view.navigate("http://fake/unreachable-late"));
    const aborted = await outcome(view.navigate("http://fake/no-content"));
    await view.evaluate("__fake_load_event()");
    const reloaded = await outcome(view.reload());
    const next = await outcome(view.navigate("http://fake/after"));
    print({ failed, aborted, reloaded, next, events, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    failed: { rejected: "net::ERR_CONNECTION_REFUSED" },
    aborted: { rejected: "net::ERR_ABORTED" },
    reloaded: { rejected: "Navigation to 'http://fake/unreachable-late' failed" },
    next: {},
    events: [
      "failed:net::ERR_CONNECTION_REFUSED",
      "failed:net::ERR_ABORTED",
      "failed:Navigation to 'http://fake/unreachable-late' failed",
      "navigated:http://fake/after",
    ],
    url: "http://fake/after",
  });
});

// Chromium 122 and older: a second navigate() that fails replaces the first
// failure's error page before it commits, so two failures are followed by one
// error page. reload() of the page that is still down has to settle, and a
// failure the page starts after it is reported.
test.concurrent("reload() rejects after two failed navigate() calls that share one error page", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await outcome(view.navigate("http://fake/unreachable-late-1"));
    await outcome(view.navigate("http://fake/unreachable-late-2"));
    await view.evaluate("__fake_error_page('http://fake/unreachable-late-2')");
    const afterBoth = [...events];
    const reloaded = await outcome(view.reload());
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    const next = await outcome(view.navigate("http://fake/after"));
    print({ afterBoth, reloaded, next, events: events.slice(afterBoth.length), url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    afterBoth: ["failed:net::ERR_CONNECTION_REFUSED", "failed:net::ERR_CONNECTION_REFUSED"],
    reloaded: { rejected: "Navigation to 'http://fake/unreachable-late-2' failed" },
    next: {},
    events: [
      "failed:Navigation to 'http://fake/unreachable-late-2' failed",
      "failed:Navigation to 'http://fake/unreachable-link' failed",
      "navigated:http://fake/after",
    ],
    url: "http://fake/after",
  });
});

// The same for a traversal: goBack() onto an entry that no longer loads
// rejects on the error page it lands on, also while an error page from a
// failed navigate() is still counted as due.
test.concurrent("goBack() onto an entry that fails to load rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/a");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    // The page follows a link that fails: the entry to go back to.
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    await outcome(view.navigate("http://fake/unreachable-late"));
    const back = await outcome(view.goBack());
    const next = await outcome(view.navigate("http://fake/after"));
    print({ back, next, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    back: { rejected: "Navigation to 'http://fake/unreachable-link' failed" },
    next: {},
    events: [
      "failed:Navigation to 'http://fake/unreachable-link' failed",
      "failed:net::ERR_CONNECTION_REFUSED",
      "failed:Navigation to 'http://fake/unreachable-link' failed",
      "navigated:http://fake/after",
    ],
    url: "http://fake/after",
    loading: false,
  });
});

// reload() sent while Chrome swaps in the error page of a failed navigate()
// is answered "Not attached to an active page". That error page is then
// neither a second failure of reload() nor a failure of its own, whether it
// commits before Chrome answers reload() or after.
for (const order of ["before", "after"]) {
  test.concurrent(
    `reload() that Chrome refuses is one failure when the error page commits ${order} the refusal`,
    async () => {
      const result = await runScenario(`
      const view = new Bun.WebView({
        backend: {
          ...backend,
          argv: [...backend.argv, "--cdp-error-on=Page.reload", "--cdp-error-message=Not attached to an active page"],
        },
        width: 100,
        height: 100,
      });
      await view.navigate("http://fake/before");
      const events = [];
      view.onNavigated = url => events.push("navigated:" + url);
      view.onNavigationFailed = error => events.push("failed:" + error.message);
      await outcome(view.navigate("http://fake/unreachable-late"));
      if (${order === "before"}) {
        // The error page commits as the fake reads Page.reload, before it
        // answers, and loads after.
        await pageDoesOnNext(view, "Page.reload", "__fake_error_page_commit('http://fake/unreachable-late')");
      }
      const reloaded = await outcome(view.reload());
      await view.evaluate(${order === "before"} ? "__fake_load_event()" : "__fake_error_page('http://fake/unreachable-late')");
      print({ reloaded, events, url: view.url, loading: view.loading });
      view.close();
    `);
      expect(result).toEqual({
        reloaded: { rejected: "Not attached to an active page" },
        events: ["failed:net::ERR_CONNECTION_REFUSED", "failed:Not attached to an active page"],
        url: "http://fake/before",
        loading: false,
      });
    },
  );
}

// An <iframe> that fails to load gets an error page of its own. It is not the
// view's: it takes no failure that navigate() reported, and it does not stand
// in for the main frame's document.
test.concurrent("an iframe's error page takes no failure that navigate() reported", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await outcome(view.navigate("http://fake/unreachable-late"));
    await view.evaluate("__fake_subframe_error_page('http://fake/dead-iframe')");
    await view.evaluate("__fake_error_page('http://fake/unreachable-late')");
    print({ events, url: view.url });
    view.close();
  `);
  expect(result).toEqual({ events: ["failed:net::ERR_CONNECTION_REFUSED"], url: "http://fake/before" });
});

test.concurrent("an iframe's error page does not fail the navigation of the page around it", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const started = outcome(view.navigate("http://fake/never-load"));
    await view.evaluate("__fake_page_commit('http://fake/own')");
    await view.evaluate("__fake_subframe_error_page('http://fake/dead-iframe')");
    await view.evaluate("__fake_load_event()");
    print({ started: await started, events, url: view.url, title: view.title, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    started: {},
    events: ["navigated:http://fake/own"],
    url: "http://fake/own",
    title: "page's own",
    loading: false,
  });
});

// The view leaves the error page the way it leaves any page. A page restored
// from the back-forward cache commits with no load event of its own, and a
// document that loads has its title read again.
test.concurrent("goBack() from Chrome's error page onto a page in the back-forward cache settles", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/bfcached");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await outcome(view.navigate("http://fake/unreachable"));
    await view.evaluate("1");
    const back = await outcome(view.goBack());
    print({ back, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    back: {},
    events: ["failed:net::ERR_CONNECTION_REFUSED", "navigated:http://fake/bfcached"],
    url: "http://fake/bfcached",
    loading: false,
  });
});

test.concurrent("the view navigates on after each of Chrome's error pages", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/a");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await outcome(view.navigate("http://fake/unreachable-1"));
    await view.evaluate("1");
    const back = await outcome(view.goBack());
    await outcome(view.navigate("http://fake/unreachable-2"));
    await view.evaluate("1");
    // The page navigates itself, so the title that is read has to be its own.
    await view.evaluate("__fake_page_commit('http://fake/own')");
    await view.evaluate("__fake_load_event()");
    // The title fetch went out behind the load event; its reply is in by now.
    await view.evaluate("1");
    const title = view.title;
    const next = await outcome(view.navigate("http://fake/b"));
    print({ back, title, next, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    back: {},
    title: "page's own",
    next: {},
    events: [
      "failed:net::ERR_CONNECTION_REFUSED",
      "navigated:http://fake/a",
      "failed:net::ERR_CONNECTION_REFUSED",
      "navigated:http://fake/own",
      "navigated:http://fake/b",
    ],
    url: "http://fake/b",
    loading: false,
  });
});

// navigate() resolves on its page's load event. A page that sends itself to a
// URL that fails before that event (an inline redirect, an auto-submitted
// login form) never fires it: Chrome's error page replaces the document. The
// error page is then the navigation's last commit, and navigate() rejects.
// view.url stays on the document that committed. Its title was never read, so
// view.title is still the one read last, from the page before.
test.concurrent("navigate() rejects when its page goes to a URL that fails before it has loaded", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    const started = outcome(view.navigate("http://fake/never-load"));
    await view.evaluate("__fake_page_commit('http://fake/redirector')");
    await view.evaluate("__fake_error_page('http://fake/unreachable-login')");
    print({ started: await started, events, url: view.url, title: view.title, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    started: { rejected: "Navigation to 'http://fake/unreachable-login' failed" },
    events: ["navigated:http://fake/redirector", "failed:Navigation to 'http://fake/unreachable-login' failed"],
    url: "http://fake/redirector",
    title: "fake chrome",
    loading: false,
  });
});

// A page that goes to a failing URL from its load handler has loaded, so
// navigate() resolves. Chrome holds the title fetch that follows the load
// event until the new navigation is over, and the error page answers it. That
// answer is not the view's title.
test.concurrent("a title fetch that Chrome's error page answers does not change view.title", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    // The next Runtime.evaluate the fake reads is the navigation's title fetch.
    await pageDoesOnNext(view, "Runtime.evaluate", "__fake_error_page('http://fake/unreachable-from-onload')");
    const navigated = await outcome(view.navigate("http://fake/redirects-on-load"));
    await view.evaluate("1");
    print({ navigated, events, url: view.url, title: view.title, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    navigated: {},
    events: [
      "navigated:http://fake/redirects-on-load",
      "failed:Navigation to 'http://fake/unreachable-from-onload' failed",
    ],
    url: "http://fake/redirects-on-load",
    title: "fake chrome",
    loading: false,
  });
});

// That navigate() resolves as the error page commits, not when its title
// fetch is answered, so the slot is free when onNavigationFailed runs for the
// failed load and a retry from the callback is accepted.
test.concurrent("onNavigationFailed can navigate() when the failed load interrupted a title fetch", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    let retry;
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => {
      events.push("failed:" + error.message);
      try {
        retry = outcome(view.navigate("http://fake/retry"));
      } catch (e) {
        retry = "threw " + e.code;
      }
    };
    await pageDoesOnNext(view, "Runtime.evaluate", "__fake_error_page('http://fake/unreachable-from-onload')");
    const navigated = await outcome(view.navigate("http://fake/redirects-on-load"));
    await view.evaluate("1");
    print({ navigated, retry: await retry, events, url: view.url, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    navigated: {},
    retry: {},
    events: [
      "navigated:http://fake/redirects-on-load",
      "failed:Navigation to 'http://fake/unreachable-from-onload' failed",
      "navigated:http://fake/retry",
    ],
    url: "http://fake/retry",
    loading: false,
  });
});

// A load the page starts can fail while a navigation of the view's is still
// pending. onNavigationFailed reports it at once, and the slot is still
// taken: a navigate() from the callback throws, as it does from onNavigated
// for a commit of the page's own. The pending navigation then ends normally.
for (const { call, method, lands } of [
  { call: "navigate('http://fake/c')", method: "Page.navigate", lands: "http://fake/c" },
  { call: "goBack()", method: "Page.getNavigationHistory", lands: "http://fake/b" },
]) {
  test.concurrent(`a failed load the page started is reported while ${call} is pending`, async () => {
    const result = await runScenario(`
      const view = newView();
      await view.navigate("http://fake/a");
      await view.navigate("http://fake/b");
      const events = [];
      view.onNavigated = url => events.push("navigated:" + url);
      view.onNavigationFailed = error => {
        events.push("failed:" + error.message);
        try {
          view.navigate("http://fake/retry").catch(() => {});
          events.push("retry accepted");
        } catch (e) {
          events.push("retry threw " + e.code);
        }
      };
      // The error page commits and loads as the fake reads the command,
      // before it answers.
      await pageDoesOnNext(view, ${JSON.stringify(method)}, "__fake_error_page('http://fake/unreachable-link')");
      const settled = await outcome(view.${call});
      print({ settled, events, url: view.url, loading: view.loading });
      view.close();
    `);
    expect(result).toEqual({
      settled: {},
      events: [
        "failed:Navigation to 'http://fake/unreachable-link' failed",
        "retry threw ERR_INVALID_STATE",
        "navigated:" + lands,
      ],
      url: lands,
      loading: false,
    });
  });
}

// Chrome's error page can make history entries of itself (a #fragment link
// on it, history.pushState() through evaluate()). They are not pages of the
// view's either: no onNavigated, and view.url stays. A listener for the raw
// event still hears it.
test.concurrent("a same-document navigation of Chrome's error page is not a navigation of the view's", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    const heard = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    view.addEventListener("Page.navigatedWithinDocument", event => heard.push(event.data.url));
    await outcome(view.navigate("http://fake/unreachable"));
    await view.evaluate("__fake_replace_state('chrome-error://chromewebdata/#details')");
    print({ events, heard, url: view.url });
    view.close();
  `);
  expect(result).toEqual({
    events: ["failed:net::ERR_CONNECTION_REFUSED"],
    heard: ["chrome-error://chromewebdata/#details"],
    url: "http://fake/before",
  });
});

// goBack() over such an entry is a same-document traversal: it settles, and
// the title fetch that follows it is answered by the error page.
test.concurrent("goBack() inside Chrome's error page settles and leaves view.url and view.title alone", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/before");
    const events = [];
    view.onNavigated = url => events.push("navigated:" + url);
    view.onNavigationFailed = error => events.push("failed:" + error.message);
    await view.evaluate("__fake_error_page('http://fake/unreachable-link')");
    await view.evaluate("__fake_hash_change('http://fake/unreachable-link#details')");
    const back = await outcome(view.goBack());
    print({ back, events, url: view.url, title: view.title, loading: view.loading });
    view.close();
  `);
  expect(result).toEqual({
    back: {},
    events: ["failed:Navigation to 'http://fake/unreachable-link' failed"],
    url: "http://fake/before",
    title: "fake chrome",
    loading: false,
  });
});

// Commands are routed to a page by the sessionId that Target.attachToTarget returns. CDP session ids are ASCII.
for (const kind of ["attach-no-session-id", "attach-bad-utf8", "attach-non-ascii"]) {
  test.concurrent(`an attach reply without a usable sessionId fails the navigation (${kind})`, async () => {
    const result = await runScenario(`
      const view = new Bun.WebView({
        backend: { ...backend, argv: [...backend.argv, "--malformed=${kind}"] },
        width: 100,
        height: 100,
      });
      const held = await outcome(view.navigate("http://fake/"));
      const loadingAfterFail = view.loading;
      view.close();
      print({ held, loadingAfterFail });
    `);
    expect(result).toEqual({ held: { rejected: "malformed attach response" }, loadingAfterFail: false });
  });
}

for (const kind of ["detach-no-session-id", "event-bad-utf8"]) {
  test.concurrent(`ignores an event without a usable sessionId (${kind})`, async () => {
    const result = await runScenario(`
      const view = new Bun.WebView({
        backend: { ...backend, argv: [...backend.argv, "--malformed=${kind}"] },
        width: 100,
        height: 100,
      });
      await view.navigate("http://fake/");
      print({ url: view.url, value: await view.evaluate("6 * 7") });
      view.close();
    `);
    expect(result).toEqual({ url: "http://fake/", value: 42 });
  });
}

// click(selector) waits for the element in the page, which returns the element's center as [cx, cy].
test.concurrent("click(selector) clicks at the position the page reported", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    await view.click("#target", { timeout: 100 });
    print(await view.evaluate("__fake_mouse_events()"));
    view.close();
  `);
  expect(result).toEqual([
    { type: "mousePressed", x: 12, y: 34 },
    { type: "mouseReleased", x: 12, y: 34 },
  ]);
});

for (const kind of ["click-no-value", "click-huge-value"]) {
  test.concurrent(`click() rejects when the reply has no usable position (${kind})`, async () => {
    const result = await runScenario(`
      const view = new Bun.WebView({
        backend: { ...backend, argv: [...backend.argv, "--malformed=${kind}"] },
        width: 100,
        height: 100,
      });
      await view.navigate("http://fake/");
      print(await outcome(view.click("#target", { timeout: 100 })));
      view.close();
    `);
    expect(result).toEqual({ rejected: "malformed click response" });
  });
}

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
