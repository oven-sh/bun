import w2 from "./w2.ts" with { type: "file" };
declare var self: Worker;
self.onmessage = event => {
  const inner = new Worker(w2);
  inner.onmessage = e => {
    self.postMessage("w1 passes on: " + e.data);
    inner.terminate();
  };
  inner.postMessage(event.data);
};
