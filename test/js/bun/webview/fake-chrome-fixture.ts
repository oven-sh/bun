// Stands in for Chrome in webview-chrome-pipe.test.ts. The runtime spawns
// `bun <chrome switches> fake-chrome-fixture.ts` (bun ignores the switches)
// and this file speaks the --remote-debugging-pipe protocol back to it:
// NUL-delimited CDP JSON, commands arriving on fd 3, replies and events
// leaving on fd 4. It implements just enough of CDP for navigate(),
// reload(), goBack()/goForward(), evaluate(), screenshot() and a renderer
// crash (Page.crash). evaluate() runs the expression in this process, which
// is how the tests move chosen payloads across the pipes and how they make
// the fake browser misbehave on cue (the __fake_* globals).
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

const NO_REPLY = Symbol("no reply");
let commandsClosed = false;
Object.assign(globalThis, {
  __fake_exit(code: number): never {
    process.exit(code);
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

let targets = 0;
let loads = 0;
let entryIds = 0;
// Session history for Page.reload and the Page.getNavigationHistory +
// Page.navigateToHistoryEntry pair behind goBack()/goForward(). A new tab
// starts at about:blank, as in Chrome.
type History = { entries: { id: number; url: string }[]; index: number };
const histories = new Map<string, History>();
function historyOf(sessionId: string): History {
  let h = histories.get(sessionId);
  if (!h) histories.set(sessionId, (h = { entries: [{ id: ++entryIds, url: "about:blank" }], index: 0 }));
  return h;
}

// Sessions whose renderer Page.crash killed, with the ids of the commands
// Chrome would be holding for the dead renderer. What real Chrome (153) does:
// the session stays attached; Target.* and the navigation commands are the
// browser's and keep working, and a navigation gives the tab a new renderer;
// until then, commands the renderer answers get no reply, and once it exists
// again they are failed with "Target crashed"; Page.captureScreenshot and
// Input.* fail at once. (Emulation.* hangs the whole browser connection for
// good there; here it is only held.)
const crashedSessions = new Map<string, number[]>();
const browserHandled = /^(Target\.|Page\.(navigate|reload|getNavigationHistory|navigateToHistoryEntry|crash)$)/;

async function handle(command: { id: number; method: string; params?: any; sessionId?: string }) {
  const { id, method, params = {}, sessionId } = command;
  const reply = (result: unknown) => send(sessionId ? { id, result, sessionId } : { id, result });
  const fail = (failedId: number, code: number, message: string) =>
    send(
      sessionId ? { id: failedId, error: { code, message }, sessionId } : { id: failedId, error: { code, message } },
    );
  const event = (name: string, eventParams: unknown) => send({ method: name, params: eventParams, sessionId });
  // A document commits and finishes loading. If the renderer was dead, this
  // is also where the new one takes over and the held commands are failed.
  const load = (url: string) => {
    const loaderId = "L" + ++loads;
    const held = crashedSessions.get(sessionId!);
    if (held) {
      crashedSessions.delete(sessionId!);
      for (const heldId of held) fail(heldId, -32000, "Target crashed");
      event("Inspector.targetReloadedAfterCrash", {});
    }
    event("Page.frameNavigated", { frame: { id: "F", loaderId, url, mimeType: "text/html" } });
    event("Page.loadEventFired", { timestamp: loads });
    return loaderId;
  };

  if (method === cdpErrorOn) return fail(id, -32000, "Cannot navigate to invalid URL");

  const held = sessionId === undefined ? undefined : crashedSessions.get(sessionId);
  if (held && !browserHandled.test(method)) {
    if (method === "Page.captureScreenshot" || method.startsWith("Input.")) return fail(id, -32603, "Internal error");
    held.push(id);
    return;
  }

  switch (method) {
    case "Target.createTarget":
      return reply({ targetId: "T" + ++targets });
    case "Target.attachToTarget":
      return reply({ sessionId: "S" + params.targetId.slice(1) });
    case "Page.navigate": {
      if (navigateError) return reply({ frameId: "F", errorText: navigateError });
      const h = historyOf(sessionId!);
      h.entries.splice(h.index + 1, Infinity, { id: ++entryIds, url: params.url });
      h.index = h.entries.length - 1;
      reply({ frameId: "F", loaderId: "L" + (loads + 1) });
      load(params.url);
      return;
    }
    case "Page.reload": {
      const h = historyOf(sessionId!);
      reply({});
      load(h.entries[h.index].url);
      return;
    }
    case "Page.getNavigationHistory": {
      const h = historyOf(sessionId!);
      return reply({ currentIndex: h.index, entries: h.entries });
    }
    case "Page.navigateToHistoryEntry": {
      const h = historyOf(sessionId!);
      const index = h.entries.findIndex(e => e.id === params.entryId);
      if (index === -1) return fail(id, -32000, "No entry with passed id");
      h.index = index;
      reply({});
      load(h.entries[index].url);
      return;
    }
    case "Page.captureScreenshot":
      return reply({ data: screenshotBase64 });
    case "Page.crash":
      // The renderer dies before it could answer this.
      crashedSessions.set(sessionId!, [id]);
      event("Inspector.targetCrashed", {});
      return;
    case "Runtime.evaluate": {
      if (params.expression === "document.title") {
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
      // Input.* is recorded where a later evaluate("__fake_last_input") finds it.
      if (method.startsWith("Input.")) Object.assign(globalThis, { __fake_last_input: { method, ...params } });
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
