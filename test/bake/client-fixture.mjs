// This script is JS so that it can run in Node.js due to issues with happy dom and Bun
// - https://github.com/oven-sh/bun/issues/16363
// - https://github.com/oven-sh/bun/issues/6044
import { Window } from "happy-dom";
import util from "node:util";
import { exitCodeMap } from "./exit-code-map.mjs";

const args = process.argv.slice(2);
let url = args.find(arg => !arg.startsWith("-"));
if (!url) {
  console.error("Usage: node client-fixture.mjs <url> [...]");
  process.exit(exitCodeMap.usage);
}
url = new URL(url, "http://localhost:3000");

const storeHotChunks = args.includes("--store-hot-chunks");
const expectErrors = args.includes("--expect-errors");

// Create a new window instance
let window;
let nativeEval;
let expectingReload = false;
let webSockets = [];
let pendingReload = null;
let pendingReloadTimer = null;

function reset() {
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

  window.fetch = async function (url, options) {
    if (typeof url === "string") {
      url = new URL(url, windowUrl).href;
    }
    return fetch(url, options);
  };

  // Provide WebSocket
  window.WebSocket = class extends WebSocket {
    constructor(url, protocols, options) {
      url = new URL(url, window.location.origin).href;
      super(url, protocols, options);
      webSockets.push(this);
      this.addEventListener("message", event => {
        if (!allowWebSocketMessages) {
          const data = new Uint8Array(event.data);
          console.error(
            "[E] WebSocket message received while messages are not allowed. Event type",
            JSON.stringify(String.fromCharCode(data[0])),
          );
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
          process.exit(exitCodeMap.websocketMessagesAreBanned);
        }
      });
    }
    close() {
      super.close();
      webSockets = webSockets.filter(ws => ws !== this);
    }
  };

  // Intercept console messages
  const originalConsole = window.console;
  window.console = {
    log: (...args) => {
      process?.send({ type: "message", args: args });
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
  };

  window.location.reload = async () => {
    reset();
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
  const response = await fetch(url);
  if (response.status >= 400 && response.status <= 499) {
    console.error("Failed to load page:", response.statusText);
    process.exit(exitCodeMap.reloadFailed);
  }
  if (!response.headers.get("content-type").match(/^text\/html;?/)) {
    console.error("Invalid content type:", response.headers.get("content-type"));
    process.exit(exitCodeMap.reloadFailed);
  }
  const html = await response.text();
  if (!html.includes("<script")) {
    console.error("missing <script>");
    process.exit(exitCodeMap.reloadFailed);
  }
  window.document.write(html);
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
await loadPage(window);
