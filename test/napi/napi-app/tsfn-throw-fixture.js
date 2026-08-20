// A throw from a threadsafe function's JS callback must be a fatal uncaught
// exception (node 26 default policy). No uncaughtException handler here on
// purpose: main.js installs one, which would mask keep-alive vs fatal.
const native = require("./build/Debug/napitests.node");
let n = 0;
native.test_napi_threadsafe_function_microtask_order(null, () => {
  n++;
  if (n === 1) throw new Error("tsfn-boom");
  console.log("callback", n);
});
// Holds the loop open so a keep-alive (non-fatal) report would hang here.
setInterval(() => {}, 100);
