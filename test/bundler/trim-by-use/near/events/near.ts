const target = new EventTarget();
target.addEventListener("ping", () => {});
target.removeEventListener("ping", () => {});
try {
  target.dispatchEvent({ type: "ping" } as any);
} catch (error: any) {
  console.log(error.name);
}
addEventListener("nothing", () => {});
removeEventListener("nothing", () => {});
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.once("x", value => console.log(value));
emitter.emit("x", 1);
console.log(typeof performance.addEventListener, new DOMException("d").name);
