import callable, { count, helper, touch } from "./callable.cjs";
import * as counterNamespace from "./counter.cjs";
import { bump, define, label, later, remove, set, value } from "./counter.cjs";
import { change, name0, name119, name60 } from "./many.cjs";
import { advance, read } from "./requires-esm.cjs";
import * as twinA from "./twin-a.cjs";
import * as twinB from "./twin-b.cjs";

const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try {
    text = String(f());
  } catch (e: any) {
    text = "threw " + e?.name + ": " + e?.message;
  }
  out.push(name + " = " + text);
};
const times = (n: number, f: (i: number) => unknown) => {
  const seen: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const next = f(i);
    if (!seen.length || seen[seen.length - 1] !== next) seen.push(next);
  }
  return seen.join();
};

function readValue() {
  return value;
}
function readLabel() {
  return label;
}
function readLater() {
  return later;
}
function readThroughNamespace(ns: any) {
  return ns.first + ns.second;
}

say("a value that changes", () => times(300, i => (bump(), readValue() === i + 1)));
say("a value that does not", () => times(300, readLabel));
say("through the namespace", () => times(300, () => counterNamespace.value === value));
say("another type", () => (set("value", "text"), times(100, readValue)));
say("after an export is added", () => (set("added", 1), set("value", 5), times(100, readValue)));
say("an export that was undefined", () => times(100, readLater));
say("an export that is assigned later", () => (set("later", "now"), times(100, readLater)));
say("after another export is deleted", () => (remove("added"), times(100, readValue)));
say("after the export is deleted", () => (remove("label"), times(100, readLabel)));
say("after the export comes back", () => (set("label", "again"), times(100, readLabel)));
let calls = 0;
say("after the export becomes a getter", () => {
  define("label", { get: () => "got " + (++calls > 2 ? "many" : calls), configurable: true, enumerable: true });
  return times(100, readLabel);
});
say("after the export becomes a value again", () => {
  define("label", { value: "plain", writable: true, configurable: true, enumerable: true });
  return times(100, readLabel);
});

say("two modules with the same names", () =>
  times(300, i => readThroughNamespace(i & 1 ? twinA : twinB)),
);

say("exports that are a function", () => times(100, () => callable(helper)));
say("a counter on a function", () => times(100, i => (touch(), count === i + 1)));

say("many exports", () => times(100, () => name0 + ":" + name60 + ":" + name119));
say("many exports, changed", () => (change(60, "sixty"), change(119, "last"), times(100, () => name0 + ":" + name60 + ":" + name119)));

say("a module required from CommonJS", () => times(100, read));
say("a module required from CommonJS, changed", () => (advance(), advance(), times(100, read)));

console.log(out.join("\n"));
