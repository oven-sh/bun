// This script is JS so that it can run in Node.js due to issues with happy dom and Bun
// - https://github.com/oven-sh/bun/issues/16363
// - https://github.com/oven-sh/bun/issues/6044
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import util from "node:util";
import { exitCodeMap } from "./exit-code-map.mjs";

// Prevent silent crashes from unhandled promise rejections
process.on("unhandledRejection", reason => {
  console.error("[E] Unhandled rejection:", reason);
  process.exit(exitCodeMap.reloadFailed);
});

const args = process.argv.slice(2);
let url = args.find(arg => !arg.startsWith("-"));
if (!url) {
  console.error("Usage: node client-fixture.mjs <url> [...]");
  process.exit(exitCodeMap.usage);
}
url = new URL(url, "http://localhost:3000");

const storeHotChunks = args.includes("--store-hot-chunks");
const expectErrors = args.includes("--expect-errors");
const verboseWebSockets = args.includes("--verbose-web-sockets");
const allowUnlimitedReloads = args.includes("--allow-unlimited-reloads");

// Create a new window instance
let window;
let nativeEval;
let expectingReload = false;
let webSockets = [];
let pendingReload = null;
let pendingReloadTimer = null;
// Bumped when the current window is abandoned; acks captured by an older window are dropped.
let windowGeneration = 0;
// Acks the current window still owes the harness: builds it received and its page load.
let pendingAcks = () => 0;
// Every ack sent so far; with `pendingAcks()` it tells the harness how many acks to expect in total.
let acksSent = 0;
// Settles once every stylesheet the current page links has loaded or failed.
let stylesheetsSettled = Promise.resolve();
let objectURLRegistry = new Map();
let internalAPIs;

function reset() {
  windowGeneration++;
  for (const ws of webSockets) {
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.onmessage = () => {};
    ws.onopen = () => {};
    ws.close();
  }
  webSockets = [];
  if (window) {
    window.location.reload = () => {};
    window.console = {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      assert: () => {},
      trace: () => {},
    };
  }
}

let allowWebSocketMessages = true;

function createWindow(windowUrl) {
  window = new Window({
    url: windowUrl,
    width: 1024,
    height: 768,
  });

  // The harness counts one `received-hmr-event` per build per page. A page
  // that reloads before its ack fires is abandoned, so the ack is dropped and
  // the new window acks once it has loaded (see the socket-connected handler).
  const generation = ++windowGeneration;
  const ackToHarness = () => {
    if (generation !== windowGeneration) return;
    acksSent++;
    process.send({ type: "received-hmr-event", args: [] });
  };
  let pageLoadAcked = false;
  const ackPageLoad = () => {
    if (pageLoadAcked) return;
    pageLoadAcked = true;
    ackToHarness();
  };

  // The HMR runtime reads this symbol-keyed callback off `globalThis` (which is
  // `window` inside happy-dom's script context) and passes its internal hooks.
  let hmrEventHookInstalled = false;
  let pendingBuildAcks = 0;
  // The update frame whose handlers are running. The HMR runtime appends a
  // frame's script synchronously from its handler, so the flag lands on it.
  let currentFrame = null;
  const ackBuild = () => {
    if (pendingBuildAcks === 0) return;
    pendingBuildAcks--;
    ackToHarness();
  };
  pendingAcks = () => pendingBuildAcks + (pageLoadAcked ? 0 : 1);
  window[Symbol.for("bun testing api, may change at any time")] = internal => {
    window.internal = internal;
    if (typeof internal.onEvent === "function") {
      hmrEventHookInstalled = true;
      // Ack a hot update only once the new module code has actually run. Node's
      // Blob.arrayBuffer() resolves on a later macrotask than the WS listener's
      // setImmediate, so acking from the WS listener would race the eval.
      internal.onEvent("bun:afterUpdate", ackBuild);
    }
  };

  const original_window_fetch = window.fetch;
  window.fetch = async function (url, options) {
    if (typeof url === "string") {
      url = new URL(url, windowUrl).href;
    }
    return await original_window_fetch(url, options);
  };

  // Provide WebSocket
  window.WebSocket = class extends WebSocket {
    constructor(url, protocols, options) {
      url = new URL(url, window.location.origin).href;
      super(url, protocols, options);
      webSockets.push(this);
      this.addEventListener("message", event => {
        const data = new Uint8Array(event.data);
        const kind = String.fromCharCode(data[0]);
        // One ack per build, on the last frame the server sends this page for
        // it: "u" for an HMR page (an "e" with the build's errors precedes it),
        // "e" for the error page, which only subscribes to errors.
        if (hmrEventHookInstalled ? kind === "u" : kind === "e" || kind === "u") {
          // JS updates queue a script tag and ack via bun:afterUpdate once it
          // evals; everything else (CSS, reloads, route reloads) acks here on
          // the next tick when this frame queued no script.
          pendingBuildAcks++;
          const frame = (currentFrame = { scriptQueued: false });
          setImmediate(() => {
            if (!frame.scriptQueued) ackBuild();
          });
        }
        if (!allowWebSocketMessages) {
          const allowedTypes = ["n", "r"];
          if (allowedTypes.includes(kind)) {
            return;
          }
          dumpWebSocketMessage("[E] WebSocket message received while messages are not allowed", data);
          process.exit(exitCodeMap.websocketMessagesAreBanned);
        } else {
          verboseWebSockets && dumpWebSocketMessage("[I] WebSocket", data);
        }
      });
    }
    close() {
      super.close();
      webSockets = webSockets.filter(ws => ws !== this);
    }
  };

  // The method of loading code via object URLs is not supported by happy-dom.
  // Instead, it is emulated.
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (blob) {
    const url = originalCreateObjectURL.call(URL, blob);
    objectURLRegistry.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    originalRevokeObjectURL.call(URL, url);
    objectURLRegistry.delete(url);
  };
  const originalDocumentCreateElement = window.document.createElement;
  const originalElementAppendChild = window.document.head.appendChild;
  class ScriptTag {
    src;
    constructor() {}
    remove() {}
  }
  window.document.createElement = function (tagName) {
    if (tagName === "script") {
      return new ScriptTag();
    }
    return originalDocumentCreateElement.call(window.document, tagName);
  };
  Object.defineProperty(window.document.head.__proto__, "appendChild", {
    configurable: true,
    enumerable: true,
    value: function (element) {
      if (element instanceof ScriptTag) {
        assert(element.src.startsWith("blob:"));
        if (currentFrame) currentFrame.scriptQueued = true;
        const blob = objectURLRegistry.get(element.src);
        assert(blob);
        // Capture the window this script was appended to. Rapid HMR reloads
        // can swap the module-level `window` before `arrayBuffer()` resolves,
        // which would otherwise eval an HMR chunk against a freshly-created
        // window whose runtime has not loaded yet.
        const owningWindow = window;
        blob.arrayBuffer().then(buffer => {
          if (window !== owningWindow) return;
          const code = new TextDecoder().decode(buffer);
          (0, owningWindow.eval)(code);
        });
        return;
      }
      return originalElementAppendChild.call(document.head, element);
    },
  });

  // Intercept console messages
  const originalConsole = window.console;
  window.console = {
    log: (...args) => {
      process.send({ type: "message", args: args });
    },
    error: (...args) => {
      console.error("[E]", ...args);
      originalConsole.error(...args);
      if (!expectErrors) {
        process.exit(exitCodeMap.consoleError);
      }
    },
    warn: (...args) => {
      console.warn("[W]", ...args);
      originalConsole.warn(...args);
    },
    info: (...args) => {
      if (args[0]?.startsWith("[Bun] Hot-module-reloading socket connected")) {
        // Ack the page load once every stylesheet it links has loaded or failed.
        stylesheetsSettled.then(() => process.nextTick(ackPageLoad));
      }
      if (args[0]?.startsWith("[WS] receive message")) return;
      if (args[0]?.startsWith("Updated modules:")) return;
      console.info("[I]", ...args);
      originalConsole.info(...args);
    },
    assert: (value, ...args) => {
      if (value) return;
      console.trace(...args);
      process.exit(exitCodeMap.assertionFailed);
    },
    trace: console.trace,
  };

  window.location.reload = async () => {
    reset();
    if (allowUnlimitedReloads) {
      handleReload();
      return;
    }
    if (expectingReload) {
      // Permission already granted, proceed with reload
      handleReload();
    } else {
      // Store the reload request and set a timer
      pendingReload = () => handleReload();
      if (pendingReloadTimer) clearTimeout(pendingReloadTimer);
      pendingReloadTimer = setTimeout(() => {
        // If we get here, permission never came
        console.error("[E] location.reload() called unexpectedly");
        process.exit(exitCodeMap.unexpectedReload);
      }, 500);
    }
  };

  let hasHadCssReplace = false;
  const originalCSSStyleSheetReplace = window.CSSStyleSheet.prototype.replaceSync;
  window.CSSStyleSheet.prototype.replace = function (newContent) {
    const result = originalCSSStyleSheetReplace.apply(this, [newContent]);
    hasHadCssReplace = true;
    return result;
  };

  nativeEval = window.eval;
  if (storeHotChunks) {
    window.eval = code => {
      process.send({ type: "hmr-chunk", args: [code] });
      return nativeEval.call(window, code);
    };
  }
}

function dumpWebSocketMessage(message, data) {
  console.error(`${message}. Event type`, JSON.stringify(String.fromCharCode(data[0])));
  let hexDump = "";
  for (let i = 0; i < data.length; i += 16) {
    // Print offset
    hexDump += "\x1b[2m" + i.toString(16).padStart(4, "0") + "\x1b[0m ";
    // Print hex values
    const chunk = data.slice(i, i + 16);
    const hexValues = Array.from(chunk)
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");
    hexDump += hexValues.padEnd(48, " ");
    // Print ASCII
    hexDump += "\x1b[2m| \x1b[0m";
    for (const byte of chunk) {
      hexDump += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "\x1b[2m.\x1b[0m";
    }
    hexDump += "\n";
  }
  console.error(hexDump);
}

async function handleReload() {
  expectingReload = false;
  pendingReload = null;
  if (pendingReloadTimer) {
    clearTimeout(pendingReloadTimer);
    pendingReloadTimer = null;
  }

  process.send({ type: "reload", args: [] });

  // Destroy the old window
  reset();
  window.close();

  // Create a new window instance
  createWindow(url);

  // Reload the page content
  try {
    await loadPage(window);
  } catch (error) {
    console.error("Failed to reload page:", error);
    process.exit(exitCodeMap.reloadFailed);
  }
}

// Extract page loading logic to a reusable function
async function loadPage() {
  let response;
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      response = await fetch(url);
      break;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        // Retry after a short delay for transient connection errors (e.g. Windows port not ready)
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      console.error("Failed to fetch page after retries:", err.message);
      process.exit(exitCodeMap.reloadFailed);
    }
  }
  if (response.status >= 400 && response.status <= 499) {
    console.error("Failed to load page:", response.statusText);
    process.exit(exitCodeMap.reloadFailed);
  }
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.match(/^text\/html;?/)) {
    console.error("Invalid content type:", contentType);
    process.exit(exitCodeMap.reloadFailed);
  }
  const html = await response.text();
  if (!html.includes("<script")) {
    console.error("missing <script>");
    process.exit(exitCodeMap.reloadFailed);
  }
  window.document.write(html);
  stylesheetsSettled = settleStylesheets(window);
}

/**
 * Resolves once every stylesheet `<link>` in the document has loaded or
 * failed. happy-dom fetches each one after `document.write` returns, so the
 * listeners miss no event: a load sets `link.sheet` and fires "load", a
 * response that is not ok fires "error" (a 404 for a source tag the dev
 * server left in a recovered page, for example) and leaves `sheet` null.
 */
function settleStylesheets(window) {
  const links = [...window.document.querySelectorAll('link[rel="stylesheet"]')];
  const pending = new Set(links.filter(link => !link.sheet));
  // Only a diagnostic: the harness times out the page load on its own.
  const diagnostic = setTimeout(() => {
    const hrefs = [...pending].map(link => link.getAttribute("href"));
    console.warn(`[W] Still waiting for ${pending.size} stylesheets to load or fail: ${hrefs.join(", ")}`);
  }, 1000);
  return Promise.all(
    [...pending].map(
      link =>
        new Promise(resolve => {
          const settle = () => {
            pending.delete(link);
            resolve();
          };
          link.addEventListener("load", settle);
          link.addEventListener("error", settle);
        }),
    ),
  ).finally(() => clearTimeout(diagnostic));
}

// Listen for control messages from the test harness
process.on("message", async message => {
  if (message.type === "expect-reload") {
    expectingReload = true;
    // If there was a pending reload request, handle it now
    if (pendingReload) {
      pendingReload();
    }
  }
  if (message.type === "set-allow-websocket-messages") {
    allowWebSocketMessages = message.args[0];
  }
  if (message.type === "ping") {
    const [messageId] = message.args;
    // Reply from the check phase: a frame received before this ping has then
    // sent its ack, or is still counted in `pendingAcks`.
    setImmediate(() => {
      process.send({ type: `pong-${messageId}`, args: [{ value: acksSent + pendingAcks() }] });
    });
  }
  if (message.type === "hard-reload") {
    expectingReload = true;
    await handleReload();
  }
  if (message.type === "evaluate") {
    const [messageId, code, mode] = message.args;
    try {
      // Evaluate the code in the window context
      let result;
      try {
        result = await nativeEval(`(async () => ${code})()`);
      } catch (error) {
        if (error.message === "Illegal return statement" || error.message.includes("Unexpected token")) {
          result = await nativeEval(`(async () => { ${code} })()`);
        } else {
          throw error;
        }
      }

      if (mode === "interactive") {
        result = util.inspect(result, false, null, true);
      }

      // Send back the result
      process.send({
        type: `js-result-${messageId}`,
        args: [
          {
            value: result,
          },
        ],
      });
    } catch (error) {
      // Send back any errors
      process.send({
        type: `js-result-${messageId}`,
        args: [
          {
            error: error.message,
          },
        ],
      });
    }
  }
  if (message.type === "exit") {
    process.exit(0);
  }
  if (message.type === "get-style") {
    const [messageId, selector] = message.args;
    try {
      for (const sheet of [...window.document.styleSheets, ...window.document.adoptedStyleSheets]) {
        if (sheet.disabled) continue;
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === selector) {
            const style = {};
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              const camelCase = prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
              style[camelCase] = rule.style.getPropertyValue(prop);
            }
            process.send({
              type: `get-style-result-${messageId}`,
              args: [
                {
                  value: style,
                },
              ],
            });
            return;
          }
        }
      }

      process.send({
        type: `get-style-result-${messageId}`,
        args: [
          {
            value: undefined,
          },
        ],
      });
    } catch (error) {
      process.send({
        type: `get-style-result-${messageId}`,
        args: [
          {
            error: error.message,
          },
        ],
      });
    }
  }
  if (message.type === "get-errors") {
    const [messageId] = message.args;
    try {
      const overlay = window.document.querySelector("bun-hmr");
      if (!overlay) {
        process.send({
          type: `get-errors-result-${messageId}`,
          args: [{ value: [] }],
        });
        return;
      }

      const errors = [];
      const buildErrors = overlay.shadowRoot.querySelectorAll(".b-msg");
      for (const message of buildErrors) {
        const fileName = message.closest(".b-group").querySelector(".file-name").textContent;
        const label = message.querySelector(".log-label").textContent;
        const text = message.querySelector(".log-text").textContent;

        const lineNumElem = message.querySelector(".gutter");
        const spaceElem = message.querySelector(".highlight-wrap > .space");

        let formatted;
        if (lineNumElem && spaceElem) {
          const line = lineNumElem.textContent;
          const col = spaceElem.textContent.length + 1;
          formatted = `${fileName}:${line}:${col}: ${label}: ${text}`;
        } else {
          formatted = `${fileName}: ${label}: ${text}`;
        }

        errors.push(formatted);
      }
      const runtimeError = overlay.shadowRoot.querySelector(".r-error");
      if (runtimeError) {
        // TODO: line and column of this error
        errors.push(runtimeError.querySelector(".message-desc").textContent);
      }

      process.send({
        type: `get-errors-result-${messageId}`,
        args: [{ value: errors.sort() }],
      });
    } catch (error) {
      console.error(error);
      process.send({
        type: `get-errors-result-${messageId}`,
        args: [{ error: error.message }],
      });
    }
  }
});
process.on("disconnect", () => {
  process.exit(0);
});
process.on("exit", () => {
  if (window) {
    const message = window.sessionStorage.getItem("bun:hmr:message");
    if (message) {
      const decoded = JSON.parse(message);
      if (decoded.kind === "warn") {
        console.error(decoded.message);
      } else {
        console.error(decoded.message);
      }
    }
  }
  if (process.exitCode === 0 && expectingReload) {
    console.error("[E] location.reload() was not called");
    process.exit(exitCodeMap.reloadNotCalled);
  }
});

// Initial page load
createWindow(url);
try {
  await loadPage(window);
} catch (error) {
  console.error("Failed initial page load:", error);
  process.exit(exitCodeMap.reloadFailed);
}
