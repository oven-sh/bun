"use strict";
// Worker body for the "terminate() during allocating FFI wrapper" leak test.
// `new Response(body, { headers: {plain object} })` drives the Rust
// `FetchHeaders::create_from_js` wrapper, whose C++ side allocates a
// `WebCore::FetchHeaders` on the heap and then runs `fill()` over every entry.
// The final C++ guard is a bare `throwScope.exception()` (no trap handling),
// so a termination trap set during `fill()` is only observed by Rust's
// post-call check, which (before the fix) dropped the raw pointer and leaked
// the allocation. Many headers keep `fill()` running long enough for the
// parent's terminate() to land inside it; the "go" message goes out first so
// termination arrives while the very first call is in flight.
const { parentPort } = require("worker_threads");

const hdrs = {};
for (let i = 0; i < 200; i++) hdrs["x-h-" + i] = "v" + i;

parentPort.postMessage("go");
function go() {
  new Response("", { headers: hdrs });
  setImmediate(go);
}
go();
