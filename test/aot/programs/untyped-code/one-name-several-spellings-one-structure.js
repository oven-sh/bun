// One name on objects of one Structure is written through sites of different kinds in turn: a plain store, a class field,
// a function that captures the object it is stored on, Reflect.set, Object.assign. What one kind of write has learned about
// the Structure and the name must not be taken for what another kind does.
const lines = [];
function describe(o) {
  const d = Object.getOwnPropertyDescriptor(o, "x");
  let own = "absent";
  if (d) {
    const flags = (d.writable ? "W" : "-") + (d.enumerable ? "E" : "-") + (d.configurable ? "C" : "-");
    own = "value" in d ? (typeof d.value === "function" ? "function" : String(d.value)) + flags : "accessor" + flags;
  }
  let read;
  try { read = o.x; } catch (error) { read = error.constructor.name; }
  if (typeof read === "function") read = read() === o ? "returns its holder" : "returns another";
  return own + " " + String(read) + " " + Object.keys(o).join();
}

const seen = [];
const states = {
  absent: o => o,
  plain: o => { o.x = "was"; return o; },
  hidden: o => Object.defineProperty(o, "x", { value: "was", writable: true, enumerable: false, configurable: true }),
  readOnly: o => Object.defineProperty(o, "x", { value: "was", writable: false, enumerable: true, configurable: true }),
  fixed: o => Object.defineProperty(o, "x", { value: "was", writable: true, enumerable: true, configurable: false }),
  accessor: o => Object.defineProperty(o, "x", { get() { return "got"; }, set(v) { seen.push(typeof v); }, enumerable: true, configurable: true }),
  setterAbove: o => Object.setPrototypeOf(o, { set x(v) { seen.push("above " + typeof v); }, get x() { return "above"; } }),
  readOnlyAbove: o => Object.setPrototypeOf(o, Object.defineProperty({}, "x", { value: "above", writable: false })),
};

class ReturnsArgument { constructor(o) { return o; } }
class DefinesField extends ReturnsArgument { x = "field"; }
const writes = {
  store(o) { "use strict"; o.x = "stored"; },
  field(o) { new DefinesField(o); },
  closure(o) { o.x = () => o; },
  reflect(o) { Reflect.set(o, "x", "reflected"); },
  assign(o) { Object.assign(o, { x: "assigned" }); },
};

let number = 0;
for (const state of Object.keys(states)) {
  for (const first of Object.keys(writes)) {
    for (const second of Object.keys(writes)) {
      if (first === second) continue;
      const key = "combination" + number++;
      const results = [];
      for (let round = 0; round < 4; round++) {
        for (const write of [first, second]) {
          const o = states[state]({ [key]: 0 });
          let outcome;
          try { writes[write](o); outcome = describe(o); } catch (error) { outcome = error.constructor.name + " " + describe(o); }
          results.push(outcome);
        }
      }
      const distinct = [...new Set(results)];
      lines.push(state + " " + first + " " + second + ": " + distinct.join(" | ") + " (" + results.map(r => distinct.indexOf(r)).join("") + ")");
    }
  }
}
lines.push("setters saw " + seen.length);
console.log(lines.join("\n"));
