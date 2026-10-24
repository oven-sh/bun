function make() {
  return new Proxy(function () { return 1; }, {});
}
const p = make();
console.log(typeof p);
console.log(typeof p === "function");
if (typeof p === "function") console.log("callable", p());
else console.log("not callable");
const q = new Proxy(class A {}, {});
console.log(typeof q, typeof q === "function" ? new q().constructor.name : "no");
function kind(x: unknown): string {
  return typeof x === "function" ? "f" : typeof x === "object" ? "o" : "p";
}
console.log(kind(p), kind(new Proxy({}, {})), kind(new Proxy([], {})));
function call(f: Function | string): unknown {
  return typeof f === "function" ? f() : f;
}
console.log(call(p), call("text"));
import { inspect, types } from "node:util";
console.log(types.isProxy(p), inspect(p, { showProxy: true }), inspect(p));
function shown(f: () => number): string {
  return inspect(f, { showProxy: true });
}
console.log(shown(p), shown(() => 2));
