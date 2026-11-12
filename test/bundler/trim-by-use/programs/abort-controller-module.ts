const { AbortController: Controller, AbortSignal: Signal } = require("abort-controller");
const controller = new Controller();
controller.abort();
console.log(controller.signal.aborted, controller.signal instanceof Signal);
