// Stands in for Chrome in webview-chrome-pipe.test.ts. The runtime spawns
// `bun <chrome switches> fake-chrome-fixture.ts` (bun ignores the switches)
// and this file speaks the --remote-debugging-pipe protocol back to it:
// NUL-delimited CDP JSON, commands arriving on fd 3, replies and events
// leaving on fd 4. It implements just enough of CDP for navigate(),
// evaluate() and screenshot(). evaluate() runs the expression in this
// process, which is how the tests move chosen payloads across the pipes and
// how they make the fake browser misbehave on cue (the __fake_* globals).
import { closeSync, readSync, writeSync } from "node:fs";

const COMMANDS = 3;
const REPLIES = 4;

// Same bytes as SCREENSHOT_BYTES in the test file.
const screenshot = Buffer.alloc(100_000);
for (let i = 0; i < screenshot.length; i++) screenshot[i] = (i * 7) & 0xff;
const screenshotBase64 = screenshot.toString("base64");

// `--exit-delay=<ms>`: how long the process outlives the command pipe, the way
// a real browser takes a moment to shut down after the pipe closes. Default 0.
const exitDelay = Number(process.argv.find(a => a.startsWith("--exit-delay="))?.slice("--exit-delay=".length) ?? 0);

// `--no-title-reply`: never answer the document.title fetch that follows
// Page.loadEventFired, so the runtime's Navigate slot stays pending forever.
const noTitleReply = process.argv.includes("--no-title-reply");

// `--navigate-error=<errorText>`: Page.navigate answers with errorText, the
// way real Chrome reports e.g. net::ERR_NAME_NOT_RESOLVED, instead of
// navigating.
const navigateError = process.argv.find(a => a.startsWith("--navigate-error="))?.slice("--navigate-error=".length);

// `--cdp-error-on=<method>`: that method's reply is a CDP protocol error
// ({"error":{"code":-32000,...}}), the way real Chrome rejects e.g.
// Page.navigate for a URL it cannot parse.
const cdpErrorOn = process.argv.find(a => a.startsWith("--cdp-error-on="))?.slice("--cdp-error-on=".length);

// `--subframe-navigation`: every document load commits a subframe navigation
// too, the way a page holding an <iframe> does.
const subframeNavigation = process.argv.includes("--subframe-navigation");

const NO_REPLY = Symbol("no reply");
let commandsClosed = false;
// The session of the command being handled, so a __fake_* global that an
// evaluate() runs can emit events on it.
let currentSessionId: string | undefined;
// One URL the page will "replaceState" to while the next
// Page.getNavigationHistory is being answered (see __fake_replace_state_on_history_lookup).
let replaceStateOnHistoryLookup: string | undefined;
// One URL the page navigates itself to while the next Page.getNavigationHistory
// is being answered: that document commits during the lookup, and only
// __fake_load_event() finishes it (see __fake_page_load_on_history_lookup).
let pageLoadOnHistoryLookup: string | undefined;
// One #fragment the page follows as the next navigation command is read,
// before its reply: the way events already in the pipe reach the runtime
// after it wrote the command (see __fake_fragment_link_on_next_navigate).
let fragmentLinkOnNextNavigate: string | undefined;
// One URL the page loads whole as the next Page.reload is read, before its
// reply; that reload then never commits (see __fake_page_load_on_next_reload).
let pageLoadOnNextReload: string | undefined;
// One URL the page "replaceState"s to right after the next same-document
// commit, the way a hashchange handler canonicalizing the URL does.
let replaceStateAfterNextCommit: string | undefined;
// How many document.title fetches the runtime has sent: one per navigation.
let titleFetches = 0;
Object.assign(globalThis, {
  __fake_exit(code: number): never {
    process.exit(code);
  },
  // The page commits a same-document navigation of its own, the way
  // history.replaceState() or a scroll-driven `location.hash = ...` does:
  // Page.navigatedWithinDocument with nothing before it, no new history entry.
  __fake_replace_state(url: string) {
    replaceState(url);
  },
  // The same, but timed to land while the runtime waits for the history
  // lookup that goBack()/goForward() start with.
  __fake_replace_state_on_history_lookup(url: string) {
    replaceStateOnHistoryLookup = url;
  },
  // The load event of the document that is live, the way one arrives for a
  // document the page itself navigated to. It names no frame and no loader.
  __fake_load_event() {
    send({ method: "Page.loadEventFired", params: { timestamp: ++loads }, sessionId: currentSessionId });
  },
  // The page navigates itself to `url` while the runtime's next history
  // lookup is in flight: a new document, committed but not finished.
  __fake_page_load_on_history_lookup(url: string) {
    pageLoadOnHistoryLookup = url;
  },
  // The page navigates itself to `url` and that document commits and loads,
  // the way a `location.href = ...` that wins the frame does.
  __fake_page_load(url: string) {
    pageLoad(url);
    event("Page.loadEventFired", { timestamp: loads });
  },
  // The page navigates itself to `url` (a link, `location.href = ...`) and
  // the load fails: Chrome's error page commits in its place and loads.
  __fake_page_load_fails(url: string) {
    loads++;
    event("Page.frameStartedNavigating", { frameId: "F", url, loaderId: "P" + loads, navigationType: "differentDocument" });
    pushEntry(url, "P" + loads);
    commitErrorPage(url, "P" + loads);
  },
  // The page follows a #fragment link of its own, which Chrome starts and
  // commits after the runtime wrote the next navigation command and before
  // Chrome answers it. Chrome calls that start "sameDocument".
  __fake_fragment_link_on_next_navigate(url: string) {
    fragmentLinkOnNextNavigate = url;
  },
  // The page's own same-document commit lands right behind the next one,
  // the way a hashchange handler that rewrites the URL produces.
  __fake_replace_state_after_next_commit(url: string) {
    replaceStateAfterNextCommit = url;
  },
  // The page finishes a load of its own after the runtime wrote the next
  // Page.reload and before Chrome answered it. That reload never commits.
  __fake_page_load_on_next_reload(url: string) {
    pageLoadOnNextReload = url;
  },
  // How many document.title fetches the runtime has sent so far.
  __fake_title_fetches() {
    return titleFetches;
  },
  // The command gets no reply, ever.
  __fake_no_reply() {
    return NO_REPLY;
  },
  // The process stays alive; only the reply pipe goes away.
  __fake_close_replies() {
    closeSync(REPLIES);
    return NO_REPLY;
  },
  // The process stays alive and keeps the reply pipe open, but stops reading
  // commands and closes its end of that pipe, so the parent's next write fails.
  __fake_close_commands() {
    commandsClosed = true;
    closeSync(COMMANDS);
    setInterval(() => {}, 2 ** 30);
  },
});

function send(message: unknown) {
  const bytes = Buffer.from(JSON.stringify(message) + "\0");
  let written = 0;
  while (written < bytes.length) written += writeSync(REPLIES, bytes, written, bytes.length - written);
}

// An event on the session of the command being handled.
function event(method: string, params: unknown) {
  send({ method, params, sessionId: currentSessionId });
}

let targets = 0;
let loads = 0;
let entries = 0;

// Session history, the way the browser keeps it: Page.navigate appends,
// Page.getNavigationHistory reports it, Page.navigateToHistoryEntry moves
// inside it. Two URLs that differ only after the '#' are the same document.
// Each entry remembers the loader its document committed under.
const history: { id: number; url: string; loaderId: string }[] = [];
let historyIndex = -1;
const documentOf = (url: string) => url.split("#")[0];
const fragmentOf = (url: string) => (url.includes("#") ? url.slice(url.indexOf("#")) : "");
// A URL with "never-load" in it starts loading and never commits, the way a
// server that accepts the connection and then says nothing looks. One with
// "stall-on-return" loads when navigated to, but a history traversal back to
// it starts and never commits. One with "unreachable" in it fails to load,
// the way a refused connection does: Chrome commits its error page instead.
// One with "bfcached" in it comes back whole from the back-forward cache when
// a history traversal returns to it.
const neverLoads = (url: string) => url.includes("never-load");
const stallsOnReturn = (url: string) => url.includes("stall-on-return");
const failsToLoad = (url: string) => url.includes("unreachable");
const bfcached = (url: string) => url.includes("bfcached");

function pushEntry(url: string, loaderId: string) {
  history.length = historyIndex + 1;
  history.push({ id: ++entries, url, loaderId });
  historyIndex = history.length - 1;
}

function replaceState(url: string) {
  if (historyIndex >= 0) history[historyIndex].url = url;
  event("Page.navigatedWithinDocument", { frameId: "F", url, navigationType: "historyApi" });
}

// Chrome names a navigation's kind before it starts. The runtime ignores it.
function startNavigating(url: string, navigationType: string) {
  event("Page.frameStartedNavigating", { frameId: "F", url, navigationType });
}

// A document commits: Page.frameNavigated, with the fragment split off into
// frame.urlFragment. A fresh load ("Navigation") ends with the load event; a
// page restored from the back-forward cache is complete as it commits, so
// nothing follows.
function commitDocument(url: string, loaderId: string, type: "Navigation" | "BackForwardCacheRestore") {
  const fragment = fragmentOf(url);
  const frame = { id: "F", loaderId, url: documentOf(url), mimeType: "text/html" };
  event("Page.frameNavigated", { frame: fragment ? { ...frame, urlFragment: fragment } : frame, type });
  if (type === "BackForwardCacheRestore") return;
  if (subframeNavigation) {
    const subframe = { id: "SUB", parentId: "F", loaderId: "S" + loads, url: "http://fake/subframe" };
    event("Page.frameNavigated", { frame: { ...subframe, mimeType: "text/html" }, type });
  }
  event("Page.loadEventFired", { timestamp: loads });
}

// A same-document navigation commits: Page.navigatedWithinDocument, and never
// a load event.
function commitSameDocument(url: string) {
  event("Page.navigatedWithinDocument", { frameId: "F", url, navigationType: "fragment" });
  if (replaceStateAfterNextCommit !== undefined) {
    replaceState(replaceStateAfterNextCommit);
    replaceStateAfterNextCommit = undefined;
  }
}

// Chrome's error page standing in for a document that failed to load: it
// commits under the failed loader, names the URL it replaces, and loads.
function commitErrorPage(unreachableUrl: string, loaderId: string) {
  const frame = { id: "F", loaderId, url: "chrome-error://chromewebdata/", unreachableUrl, mimeType: "text/html" };
  event("Page.frameNavigated", { frame, type: "Navigation" });
  event("Page.loadEventFired", { timestamp: loads });
}

// The page navigates itself to a new document (a link, `location.href = ...`):
// its own loader and commit. __fake_load_event() finishes it.
function pageLoad(url: string) {
  loads++;
  event("Page.frameStartedNavigating", { frameId: "F", url, loaderId: "P" + loads, navigationType: "differentDocument" });
  pushEntry(url, "P" + loads);
  event("Page.frameNavigated", { frame: { id: "F", loaderId: "P" + loads, url, mimeType: "text/html" }, type: "Navigation" });
}

async function handle(command: { id: number; method: string; params?: any; sessionId?: string }) {
  const { id, method, params = {}, sessionId } = command;
  currentSessionId = sessionId;
  const reply = (result: unknown) => send(sessionId ? { id, result, sessionId } : { id, result });

  if (method === cdpErrorOn) {
    const error = { code: -32000, message: "Cannot navigate to invalid URL" };
    return send(sessionId ? { id, error, sessionId } : { id, error });
  }

  switch (method) {
    case "Target.createTarget":
      return reply({ targetId: "T" + ++targets });
    case "Target.attachToTarget":
      return reply({ sessionId: "S" + params.targetId.slice(1) });
    case "Page.navigate": {
      const url: string = params.url;
      if (navigateError) return reply({ frameId: "F", errorText: navigateError });
      if (fragmentLinkOnNextNavigate !== undefined) {
        startNavigating(fragmentLinkOnNextNavigate, "sameDocument");
        replaceState(fragmentLinkOnNextNavigate);
        fragmentLinkOnNextNavigate = undefined;
      }
      // A #fragment target of the current document keeps that document.
      const current = history[historyIndex];
      const sameDocument =
        current !== undefined && documentOf(current.url) === documentOf(url) && fragmentOf(url) !== "";
      startNavigating(url, sameDocument ? "sameDocument" : "differentDocument");
      if (sameDocument) {
        // The reply names a loaderId only for a navigation that loads a document.
        reply({ frameId: "F" });
        pushEntry(url, current.loaderId);
        commitSameDocument(url);
        return;
      }
      const loaderId = "L" + ++loads;
      if (failsToLoad(url)) {
        // The failure is known before anything commits: the reply carries it,
        // and the error page follows under the same loader.
        reply({ frameId: "F", loaderId, errorText: "net::ERR_CONNECTION_REFUSED" });
        pushEntry(url, loaderId);
        commitErrorPage(url, loaderId);
        return;
      }
      reply({ frameId: "F", loaderId });
      if (neverLoads(url)) return;
      pushEntry(url, loaderId);
      commitDocument(url, loaderId, "Navigation");
      return;
    }
    case "Page.reload": {
      const current = history[historyIndex];
      if (current === undefined) return reply({});
      if (pageLoadOnNextReload !== undefined) {
        pageLoad(pageLoadOnNextReload);
        event("Page.loadEventFired", { timestamp: loads });
        pageLoadOnNextReload = undefined;
        return reply({});
      }
      startNavigating(current.url, "reload");
      current.loaderId = "L" + ++loads;
      reply({});
      if (failsToLoad(current.url)) return commitErrorPage(current.url, current.loaderId);
      commitDocument(current.url, current.loaderId, "Navigation");
      return;
    }
    case "Page.getNavigationHistory": {
      if (replaceStateOnHistoryLookup !== undefined) {
        replaceState(replaceStateOnHistoryLookup);
        replaceStateOnHistoryLookup = undefined;
      }
      // The page's own navigation commits while the lookup is in flight: a
      // new document, still loading. The reply describes the history the
      // browser read before that commit.
      const snapshot = { currentIndex: historyIndex, entries: history.map(entry => ({ ...entry })) };
      if (pageLoadOnHistoryLookup !== undefined) {
        pageLoad(pageLoadOnHistoryLookup);
        pageLoadOnHistoryLookup = undefined;
      }
      return reply(snapshot);
    }
    case "Page.navigateToHistoryEntry": {
      const target = history.findIndex(entry => entry.id === params.entryId);
      if (target === -1) return reply({});
      const entry = history[target];
      const sameDocument = documentOf(history[historyIndex].url) === documentOf(entry.url);
      startNavigating(entry.url, sameDocument ? "historySameDocument" : "historyDifferentDocument");
      reply({});
      if (neverLoads(entry.url) || stallsOnReturn(entry.url)) return;
      historyIndex = target;
      if (sameDocument) return commitSameDocument(entry.url);
      // A restore commits the cached document again, under its original loader.
      if (bfcached(entry.url)) return commitDocument(entry.url, entry.loaderId, "BackForwardCacheRestore");
      entry.loaderId = "L" + ++loads;
      if (failsToLoad(entry.url)) return commitErrorPage(entry.url, entry.loaderId);
      commitDocument(entry.url, entry.loaderId, "Navigation");
      return;
    }
    case "Page.captureScreenshot":
      return reply({ data: screenshotBase64 });
    case "Runtime.evaluate": {
      if (params.expression === "document.title") {
        titleFetches++;
        if (noTitleReply) return;
        return reply({ result: { type: "string", value: "fake chrome" } });
      }
      let value: unknown;
      try {
        value = await (0, eval)(params.expression);
      } catch (e) {
        return reply({
          result: { type: "object", subtype: "error" },
          exceptionDetails: { text: "Uncaught", exception: { description: String(e) } },
        });
      }
      if (value === NO_REPLY) return;
      if (value === undefined) return reply({ result: { type: "undefined" } });
      return reply({ result: { type: typeof value, value } });
    }
    default:
      // Page.enable, Runtime.enable, Target.closeTarget, Input.*: nothing to say.
      return reply({});
  }
}

const chunk = Buffer.alloc(64 * 1024);
let pending = Buffer.alloc(0);
while (!commandsClosed) {
  let n: number;
  try {
    n = readSync(COMMANDS, chunk);
  } catch {
    break;
  }
  if (n === 0) {
    // The parent closed its end: it is gone or shutting down.
    if (exitDelay > 0) await Bun.sleep(exitDelay);
    process.exit(0);
  }
  pending = Buffer.concat([pending, chunk.subarray(0, n)]);
  let nul: number;
  while ((nul = pending.indexOf(0)) !== -1) {
    const message = pending.subarray(0, nul).toString();
    pending = pending.subarray(nul + 1);
    await handle(JSON.parse(message));
    if (commandsClosed) break;
  }
}
