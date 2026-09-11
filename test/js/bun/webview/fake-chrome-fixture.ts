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
// One script per CDP method, run once as the next command of that method is
// read and before it is handled (see __fake_on_next).
const onNext = new Map<string, string>();
// How many document.title fetches the runtime has sent: one per navigation.
let titleFetches = 0;
Object.assign(globalThis, {
  __fake_exit(code: number): never {
    process.exit(code);
  },
  // The page does something of its own while a command of the runtime's is on
  // its way: `script` runs as the next `method` command is read, before the
  // fake handles or answers it. That is how an event that was already in the
  // pipe reaches the runtime after it wrote the command.
  __fake_on_next(method: string, script: string) {
    onNext.set(method, script);
  },
  // The page commits a same-document navigation of its own, the way
  // history.pushState() and history.replaceState() do:
  // Page.navigatedWithinDocument with nothing before it, no new history entry.
  __fake_replace_state(url: string) {
    if (historyIndex >= 0) history[historyIndex].url = url;
    event("Page.navigatedWithinDocument", { frameId: "F", url, navigationType: "historyApi" });
  },
  // The page navigates itself to a new document (a link, `location.href = ...`):
  // it commits, and only __fake_load_event() finishes it.
  __fake_page_commit(url: string) {
    loads++;
    pushEntry(url);
    event("Page.frameNavigated", {
      frame: { id: "F", loaderId: "P" + loads, url, mimeType: "text/html" },
      type: "Navigation",
    });
  },
  // The load event of the document that is live, the way one arrives for a
  // document the page itself navigated to. It names no frame and no loader.
  __fake_load_event() {
    event("Page.loadEventFired", { timestamp: ++loads });
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
const history: { id: number; url: string }[] = [];
let historyIndex = -1;
const documentOf = (url: string) => url.split("#")[0];
const fragmentOf = (url: string) => (url.includes("#") ? url.slice(url.indexOf("#")) : "");
// A URL with "never-load" in it starts loading and never commits, the way a
// server that accepts the connection and then says nothing looks. One with
// "stall-on-return" loads when navigated to, but a history traversal back to
// it starts and never commits. One with "bfcached" in it comes back whole
// from the back-forward cache when a history traversal returns to it.
const neverLoads = (url: string) => url.includes("never-load");
const stallsOnReturn = (url: string) => url.includes("stall-on-return");
const bfcached = (url: string) => url.includes("bfcached");

function pushEntry(url: string) {
  history.length = historyIndex + 1;
  history.push({ id: ++entries, url });
  historyIndex = history.length - 1;
}

// A document commits: Page.frameNavigated, with the fragment split off into
// frame.urlFragment. A fresh load ("Navigation") ends with the load event. A
// page restored from the back-forward cache is whole as it commits, so
// nothing follows.
function commitDocument(url: string, type: "Navigation" | "BackForwardCacheRestore") {
  const fragment = fragmentOf(url);
  const frame = { id: "F", loaderId: "L" + loads, url: documentOf(url), mimeType: "text/html" };
  event("Page.frameNavigated", { frame: fragment ? { ...frame, urlFragment: fragment } : frame, type });
  if (type === "BackForwardCacheRestore") return;
  if (subframeNavigation) {
    const subframe = { id: "SUB", parentId: "F", loaderId: "S" + loads, url: "http://fake/subframe" };
    event("Page.frameNavigated", { frame: { ...subframe, mimeType: "text/html" }, type });
  }
  event("Page.loadEventFired", { timestamp: loads });
}

// A same-document navigation of the runtime's commits: a #fragment target and
// a history traversal both report "fragment". No load event follows.
function commitSameDocument(url: string) {
  event("Page.navigatedWithinDocument", { frameId: "F", url, navigationType: "fragment" });
}

async function handle(command: { id: number; method: string; params?: any; sessionId?: string }) {
  const { id, method, params = {}, sessionId } = command;
  currentSessionId = sessionId;
  const reply = (result: unknown) => send(sessionId ? { id, result, sessionId } : { id, result });

  const script = onNext.get(method);
  if (script !== undefined) {
    onNext.delete(method);
    (0, eval)(script);
  }

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
      // A #fragment target of the current document keeps that document.
      const current = history[historyIndex]?.url;
      const sameDocument = current !== undefined && documentOf(current) === documentOf(url) && fragmentOf(url) !== "";
      if (!sameDocument) loads++;
      // The reply names a loaderId only for a navigation that loads a document.
      reply(sameDocument ? { frameId: "F" } : { frameId: "F", loaderId: "L" + loads });
      if (neverLoads(url)) return;
      pushEntry(url);
      return sameDocument ? commitSameDocument(url) : commitDocument(url, "Navigation");
    }
    case "Page.getNavigationHistory":
      return reply({ currentIndex: historyIndex, entries: history });
    case "Page.navigateToHistoryEntry": {
      const target = history.findIndex(entry => entry.id === params.entryId);
      if (target === -1) return reply({});
      const url = history[target].url;
      const sameDocument = documentOf(history[historyIndex].url) === documentOf(url);
      reply({});
      if (neverLoads(url) || stallsOnReturn(url)) return;
      historyIndex = target;
      if (sameDocument) return commitSameDocument(url);
      if (bfcached(url)) return commitDocument(url, "BackForwardCacheRestore");
      loads++;
      return commitDocument(url, "Navigation");
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
