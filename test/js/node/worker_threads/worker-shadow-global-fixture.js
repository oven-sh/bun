// Mimics the `web-worker` npm package: polyfills a WorkerGlobalScope by
// swapping globalThis' prototype to a user-defined EventTarget. That only
// works when globalThis has no own addEventListener/dispatchEvent, which is
// how Node.js worker_threads behave.
const { parentPort } = require("worker_threads");

const self = (global.self = global);

const dispatched = [];

class EventTarget {
  dispatchEvent(event) {
    dispatched.push(event.type + ":" + event.data);
  }
}
class WorkerGlobalScope extends EventTarget {}

Object.setPrototypeOf(global, new WorkerGlobalScope());

function Event(type) {
  this.type = type;
  this.data = null;
}

const event = new Event("message");
event.data = "hello";

let threw = false;
try {
  self.dispatchEvent(event);
} catch {
  threw = true;
}

parentPort.postMessage({ dispatched, threw });
