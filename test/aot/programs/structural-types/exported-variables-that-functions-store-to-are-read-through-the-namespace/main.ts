import * as state from "./state";
import { bump, count, faster, fill, grow, label, later, list, maybe, move, old, origin, rename, Setter, step } from "./state";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function report(when: string): void {
  console.log(when + ", by name: " + show([count + 1, label + "!", origin.x + origin.y, step(1), list.length, maybe, old]));
  console.log(when + ", through the namespace: " + show([state.count + 1, state.label + "!", state.origin.x + state.origin.y, state.step(1), state.list.length, state.maybe, state.old]));
  console.log(when + ", by a key in brackets: " + show([state["count"] + 1, state["label"] + "!", state["origin"].x, state["step"](1), state["list"].length]));
  const { count: c, label: l, origin: o, step: s, list: all } = state;
  console.log(when + ", taken apart: " + show([c + 1, l + "!", o.x + o.y, s(1), all.length]));
  const copy = { ...state };
  console.log(when + ", copied: " + show([copy.count + 1, copy.label + "!", copy.origin.x, copy.step(1), copy.list.length]));
  console.log(when + ", listed: " + show(Object.entries(state).filter(([, value]) => typeof value !== "function").map(([name, value]) => name + "=" + JSON.stringify(value)).sort()));
}

report("at the start");
bump();
rename("renamed");
move();
faster();
grow();
fill();
report("after the functions ran");
new Setter().set(50);
report("after a method stored");
later();
await Promise.resolve();
report("after a job stored");

let warm = 0;
for (let i = 0; i < 2000; i++) {
  bump();
  warm += count + state.count + state["count"];
}
console.log("2000 rounds: " + warm);
