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

async function handle(command: { id: number; method: string; params?: any; sessionId?: string }) {
  const { id, method, params = {}, sessionId } = command;
  const reply = (result: unknown) => send(sessionId ? { id, result, sessionId } : { id, result });
  const event = (name: string, eventParams: unknown) => send({ method: name, params: eventParams, sessionId });

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
      if (navigateError) return reply({ frameId: "F", errorText: navigateError });
      const loaderId = "L" + ++loads;
      reply({ frameId: "F", loaderId });
      event("Page.frameNavigated", { frame: { id: "F", loaderId, url: params.url, mimeType: "text/html" } });
      event("Page.loadEventFired", { timestamp: loads });
      return;
    }
    case "Page.captureScreenshot":
      return reply({ data: screenshotBase64 });
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
