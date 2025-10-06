// This script is JS so that it can run in Node.js due to issues with happy dom and Bun
// - https://github.com/oven-sh/bun/issues/16363
// - https://github.com/oven-sh/bun/issues/6044
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import util from "node:util";
import { Worker as NodeWorker } from "node:worker_threads";
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
const verboseWebSockets = args.includes("--verbose-web-sockets");
const allowUnlimitedReloads = args.includes("--allow-unlimited-reloads");

// Create a new window instance
let window;
let nativeEval;
let expectingReload = false;
let webSockets = [];
let pendingReload = null;
let pendingReloadTimer = null;
let isUpdating = null;
let objectURLRegistry = new Map();
let internalAPIs;

function reset() {
  if (isUpdating !== null) {
    clearImmediate(isUpdating);
    isUpdating = null;
  }
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

  window[globalThis[Symbol.for("bun testing api, may change at any time")]] = internal => {
    window.internal = internal;
  };

  // Make NodeWorker available in window scope for the Worker polyfill
  window.NodeWorker = NodeWorker;

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
        if (data[0] === "u".charCodeAt(0) || data[0] === "e".charCodeAt(0)) {
          isUpdating = setImmediate(() => {
            process.send({ type: "received-hmr-event", args: [] });
            isUpdating = null;
          });
        }
        if (!allowWebSocketMessages) {
          const allowedTypes = ["n", "r"];
          if (allowedTypes.includes(String.fromCharCode(data[0]))) {
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

  // Provide Worker using Node.js worker_threads
  window.Worker = class Worker {
    #worker;
    #messageHandlers = [];
    #errorHandlers = [];
    #messageQueue = []; // Queue messages sent before worker is ready
    #workerReady = false;
    #terminated = false;
    onmessage = null;
    onerror = null;

    constructor(scriptURL, options) {
      // Convert URL to absolute path if needed
      let workerPath;
      if (scriptURL instanceof URL) {
        workerPath = scriptURL.href;
      } else {
        workerPath = new URL(scriptURL, window.location.href).href;
      }

      // Fetch the worker script from the dev server
      window
        .fetch(workerPath)
        .then(response => {
          if (!response.ok) {
            const error = new Error(`Failed to load worker script: ${workerPath}`);
            this.#dispatchError(error);
            return;
          }
          return response.text();
        })
        .then(workerCode => {
          if (!workerCode) return;

          // Bail out if worker was terminated before fetch completed
          if (this.#terminated) {
            return;
          }

          // Create a worker that evaluates the fetched code
          // We use eval in the worker context to run the code
          this.#worker = new window.NodeWorker(
            `
            const { parentPort } = require('worker_threads');
            const EventEmitter = require('events');

            // Set up worker global scope with full event API
            const self = global;
            const eventEmitter = new EventEmitter();

            // Event listener management
            const listeners = new Map(); // type -> Set of handlers

            self.addEventListener = (type, handler) => {
              if (!listeners.has(type)) {
                listeners.set(type, new Set());
              }
              listeners.get(type).add(handler);
            };

            self.removeEventListener = (type, handler) => {
              const typeListeners = listeners.get(type);
              if (typeListeners) {
                typeListeners.delete(handler);
              }
            };

            self.dispatchEvent = (event) => {
              const typeListeners = listeners.get(event.type);
              if (typeListeners) {
                typeListeners.forEach(handler => handler(event));
              }
              // Also call onmessage/onerror if set
              if (event.type === 'message' && self.onmessage) {
                self.onmessage(event);
              } else if (event.type === 'error' && self.onerror) {
                self.onerror(event);
              }
              return true;
            };

            self.onmessage = null;
            self.onerror = null;

            // Override console.log to send messages to parent
            const originalLog = console.log;
            console.log = (...args) => {
              parentPort.postMessage({ __console: true, args });
              originalLog(...args);
            };

            // Handle postMessage from main thread
            parentPort.on('message', (data) => {
              const event = { type: 'message', data };
              self.dispatchEvent(event);
            });

            // Provide postMessage to worker code
            self.postMessage = (data) => {
              parentPort.postMessage({ __console: false, data });
            };

            // Support self.close() to shut down the worker
            self.close = () => {
              if (parentPort) {
                parentPort.close();
              }
              process.exit(0);
            };

            // Execute the worker code
            ${workerCode}
            `,
            { eval: true },
          );

          // Check again if terminated after creating worker
          if (this.#terminated) {
            this.#worker.terminate();
            this.#worker = null;
            return;
          }

          // Mark worker as ready and flush queued messages
          this.#workerReady = true;
          while (this.#messageQueue.length > 0) {
            const data = this.#messageQueue.shift();
            this.#worker.postMessage(data);
          }

          // Forward messages from worker to main thread
          this.#worker.on("message", msg => {
            if (msg.__console) {
              // Forward console.log to the main client
              process.send({ type: "message", args: msg.args });
            } else {
              // Regular postMessage
              const event = { type: "message", data: msg.data };
              if (this.onmessage) {
                this.onmessage(event);
              }
              this.#messageHandlers.forEach(handler => handler(event));
            }
          });

          // Forward errors from worker to main thread
          this.#worker.on("error", error => {
            this.#dispatchError(error);
          });

          this.#worker.on("exit", code => {
            if (code !== 0) {
              this.#dispatchError(new Error(`Worker stopped with exit code ${code}`));
            }
          });
        })
        .catch(error => {
          this.#dispatchError(error);
        });
    }

    #dispatchError(error) {
      const event = { type: "error", error, message: error.message };
      if (this.onerror) {
        this.onerror(event);
      }
      this.#errorHandlers.forEach(handler => handler(event));
    }

    postMessage(data) {
      if (this.#workerReady && this.#worker) {
        this.#worker.postMessage(data);
      } else if (!this.#terminated) {
        // Queue message until worker is ready (unless already terminated)
        this.#messageQueue.push(data);
      }
    }

    terminate() {
      this.#terminated = true;
      this.#messageQueue.length = 0;
      this.#workerReady = false;
      if (this.#worker) {
        this.#worker.terminate();
        this.#worker = null;
      }
    }

    addEventListener(type, handler) {
      if (type === "message") {
        this.#messageHandlers.push(handler);
      } else if (type === "error") {
        this.#errorHandlers.push(handler);
      }
    }

    removeEventListener(type, handler) {
      if (type === "message") {
        this.#messageHandlers = this.#messageHandlers.filter(h => h !== handler);
      } else if (type === "error") {
        this.#errorHandlers = this.#errorHandlers.filter(h => h !== handler);
      }
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
        const blob = objectURLRegistry.get(element.src);
        assert(blob);
        blob.arrayBuffer().then(buffer => {
          const code = new TextDecoder().decode(buffer);
          (0, window.eval)(code);
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
        // Wait for all CSS assets to be fully loaded before emitting the event
        let checkAttempts = 0;
        const MAX_CHECK_ATTEMPTS = 20; // Prevent infinite waiting

        const checkCSSLoaded = () => {
          checkAttempts++;

          // Get all link elements with rel="stylesheet"
          const styleLinks = window.document.querySelectorAll('link[rel="stylesheet"]');
          // Get all style elements
          const styleTags = window.document.querySelectorAll("style");
          // Check for adoptedStyleSheets
          const adoptedSheets = window.document.adoptedStyleSheets || [];

          // If no stylesheets of any kind, just emit the event
          if (styleLinks.length === 0 && styleTags.length === 0 && adoptedSheets.length === 0) {
            process.nextTick(() => {
              process.send({ type: "received-hmr-event", args: [] });
            });
            return;
          }

          // Check if all stylesheets are loaded
          let allLoaded = true;
          let pendingCount = 0;

          // Check link elements
          for (const link of styleLinks) {
            // If the stylesheet is not loaded yet
            if (!link.sheet) {
              allLoaded = false;
              pendingCount++;
            }
          }

          // Check style elements - these should be loaded immediately
          for (const style of styleTags) {
            if (!style.sheet) {
              allLoaded = false;
              pendingCount++;
            }
          }

          // Check adoptedStyleSheets - these should be loaded immediately
          for (const sheet of adoptedSheets) {
            if (!sheet.cssRules) {
              allLoaded = false;
              pendingCount++;
            }
          }

          if (allLoaded || checkAttempts >= MAX_CHECK_ATTEMPTS) {
            // All CSS is loaded or we've reached max attempts, emit the event
            if (checkAttempts >= MAX_CHECK_ATTEMPTS && !allLoaded) {
              console.warn("[W] Reached maximum CSS load check attempts, proceeding anyway");
            }
            process.nextTick(() => {
              process.send({ type: "received-hmr-event", args: [] });
            });
          } else {
            // Wait a bit and check again
            console.info(
              `[I] Waiting for ${pendingCount} CSS assets to load (attempt ${checkAttempts}/${MAX_CHECK_ATTEMPTS})...`,
            );
            setTimeout(checkCSSLoaded, 50);
          }
        };

        // Start checking for CSS loaded state
        checkCSSLoaded();
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
