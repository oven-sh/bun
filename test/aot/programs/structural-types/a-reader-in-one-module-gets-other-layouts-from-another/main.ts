import readByDefault, { Holder, honest, listing, read, store } from "./reader.ts";
import * as reader from "./reader.ts";
import { log, makers } from "./makers.ts";

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join() + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join() + "]");
  }
  log.length = 0;
}

for (const [label, make] of makers) attempt("before any honest use, " + label, () => read(make()));

console.log("the reader's own honest uses: " + honest());

for (const [label, make] of makers) {
  attempt(label + ", read", () => read(make()));
  attempt(label + ", the default export", () => readByDefault(make()));
  attempt(label + ", through the namespace", () => reader.read(make()));
  attempt(label + ", listing", () => listing(make()));
  attempt(label + ", stored", () => {
    const p = make();
    store(p, 50);
    return read(p) + " " + JSON.stringify(p);
  });
  attempt(label + ", in the other module's class", () => new Holder(make()).read());
}

const late = await import("./reader.ts");
for (const [label, make] of makers) attempt(label + ", through a dynamic import", () => late.read(make()));

console.log("honest again: " + honest());
