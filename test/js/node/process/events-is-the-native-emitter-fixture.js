// Preloaded in front of one of node's tests: its require("events") answers with the class of `process`,
// which gets the statics of node:events that it lacks.
const Module = require("node:module");
const path = require("node:path");
const events = require("node:events");

const NativeEventEmitter = Object.getPrototypeOf(process).constructor;
for (const key of Reflect.ownKeys(events)) {
  if (!(key in NativeEventEmitter)) {
    Object.defineProperty(NativeEventEmitter, key, Object.getOwnPropertyDescriptor(events, key));
  }
}
NativeEventEmitter.EventEmitter = NativeEventEmitter;

const test = path.basename(process.argv[1]);
const { require: requireOfModule } = Module.prototype;
let answered = false;
Module.prototype.require = function (id) {
  if ((id === "events" || id === "node:events") && path.basename(this.filename ?? "") === test) {
    answered = true;
    return NativeEventEmitter;
  }
  return requireOfModule.apply(this, arguments);
};
process.on("exit", () => {
  if (!answered) {
    console.error("the test never asked for events");
    process.exitCode = 1;
  }
});
