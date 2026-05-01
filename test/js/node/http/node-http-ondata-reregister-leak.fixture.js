// NodeHTTPResponse.setOnData used to take an unbalanced `this.ref()` and re-acquire the
// `body_read_ref` event-loop keep-alive when JS re-assigned `ondata` after the request
// body had already completed (body_read_state == .done). No code path released either
// ref, so the native NodeHTTPResponse leaked and vm.active_tasks was inflated.
//
// This fixture re-assigns ondata after the body has been fully consumed and asserts
// that activeTasks does not increase.
const http = require("node:http");
const { getEventLoopStats } = require("bun:internal-for-testing");

process.exitCode = 1;

const server = http.createServer(async (req, res) => {
  // Locate the internal NodeHTTPResponse handle (stored under a private Symbol("handle"))
  // before anything can clear it.
  let handle;
  for (const sym of Object.getOwnPropertySymbols(req)) {
    if (sym.description !== "handle") continue;
    const val = req[sym];
    if (val && typeof val === "object" && "hasBody" in val && "hasCustomOnData" in val) {
      handle = val;
      break;
    }
  }
  if (!handle) {
    console.error("FAIL: could not find internal handle");
    process.exit(1);
  }

  // Consume the full body so body_read_state becomes .done and body_read_ref is released.
  await new Promise(resolve => {
    req.on("data", () => {});
    req.on("end", resolve);
  });

  const before = getEventLoopStats().activeTasks;

  // Clearing then re-assigning ondata after the body is done used to call
  // `this.ref()` + `body_read_ref.ref(vm)` with no balancing deref/unref anywhere.
  handle.ondata = undefined;
  handle.ondata = () => {};

  const after = getEventLoopStats().activeTasks;
  if (after !== before) {
    console.error(`FAIL: activeTasks leaked: before=${before} after=${after}`);
    process.exit(1);
  }

  // Do it a few more times; the unbalanced `this.ref()` would accumulate one
  // extra ref on the NodeHTTPResponse per round even though activeTasks
  // oscillates (body_read_ref is a boolean).
  for (let i = 0; i < 8; i++) {
    handle.ondata = undefined;
    handle.ondata = () => {};
  }

  const afterLoop = getEventLoopStats().activeTasks;
  if (afterLoop !== before) {
    console.error(`FAIL: activeTasks leaked after loop: before=${before} after=${afterLoop}`);
    process.exit(1);
  }

  res.end("ok");
  process.exitCode = 0;
});

server.listen(0, async () => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    body: "hello world",
    headers: { connection: "close" },
  });
  await response.text();
  server.close(() => {
    console.log("CLOSED");
  });
});
