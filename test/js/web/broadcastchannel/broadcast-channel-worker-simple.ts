var bc = new BroadcastChannel("sleep");
bc.onmessage = function (e) {
  bc.postMessage("done!");
};
// An unref'd immediate runs only if something else keeps the event loop alive. Here only the open channel can,
// so "ready" tells the parent that the channel exists and that it keeps this worker alive.
setImmediate(() => postMessage("ready")).unref();
