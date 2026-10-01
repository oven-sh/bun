import { shared, Counter, table, describe, thrower } from "./lib.ts";
declare var self: Worker;
self.onmessage = (e: MessageEvent) => {
  let caught = ""; try { thrower(); } catch (x: any) { caught = x.message + "@" + String(x.stack).split("\n")[1]?.trim().replace(/\(.*[\\/]/, "(").slice(0, 40); }
  postMessage({ sum: shared(e.data.n), counter: new Counter(1).add(2).add(3).value, table: table.get("b"), text: describe({ a: 7, b: "x" }), caught });
};
