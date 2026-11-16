import util from "node:util";
import { getEventListeners, listenerCount } from "node:events";
console.log(
  util.inspect({ a: [1, 2, { b: "multi\nline" }], e: new Error("x").message }),
  util.getSystemErrorName(-2),
  util.types.isNativeError(new Error("e")),
  util.parseEnv("A=1\nB=two").B,
  (util as any).getSystemErrorMap().size > 10,
);
const target = new EventTarget();
target.addEventListener("ping", () => {});
console.log(
  getEventListeners(target, "ping").length,
  (listenerCount as any)(target, "ping"),
  util.inspect(Object.assign([1, 2], { extra: true })),
);
