import { EventEmitter, once } from "../../../../src/bun.js/events.exports.js";

// const FakeEmitter = function FakeEmitter() {
//   EventEmitter.call(this);
// };
// Object.assign(FakeEmitter.prototype, EventEmitter.prototype);
// Object.assign(FakeEmitter, EventEmitter);
const x = new EventEmitter();
x.on("foo", y => console.log("foo", y));
x.emit("foo", 12);
setTimeout(() => {
  x.emit("foo", 12);
}, 100);

console.log(await once(x, "foo"));
x.emit("foo", 12);
