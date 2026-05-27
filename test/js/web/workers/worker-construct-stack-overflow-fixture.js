// Construct a Worker while the JS stack is nearly exhausted. The Worker
// constructor emits the "worker" event on the next tick, which lazily
// initializes process.nextTick by calling a JS function. With no stack budget
// left that inner call throws a stack-overflow RangeError, which used to crash
// the process instead of surfacing cleanly.
let spawned = false;
function recurse() {
  try {
    recurse();
  } catch (e) {
    if (!spawned) {
      spawned = true;
      const w = new Worker("data:text/javascript,", { type: "module" });
      w.terminate();
    }
  }
}
recurse();
console.log("ok");
