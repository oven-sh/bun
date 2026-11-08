// Writes test/aot/parallel/key-order-roads/: one program for each road by which somebody sees in which order an object got its keys.
// A layout of which the compiler has proven that nobody lists its keys keeps no order, and its objects would then list their fields as the layout declares them. A false proof is silent: only the answer shows it.
// A deed is ONE road, and it is the only thing in its program that lists the keys of the subject: it answers with a text that spells them in the order it met them. What it prints never comes from another lister.
// The subject gets `x` and `y` in either order, so one of the two is not the order of the layout, whichever that is.
// To add a road: one more entry in `cases`, name > the body of `function deed(o)`. Run: bun test/aot/tools/generate-key-order-roads.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const folder = join(dirname(import.meta.dirname), "parallel", "key-order-roads");

const head = (road: string) => `// The keys of an object that got them in another order than its layout declares are seen by ${road}.
// Under: --aot-testing=CheckProofsAtRunTime: a proof that nobody sees the order of these keys would be false
function make(flip) {
  const o = { kind: "point" };
  if (flip) {
    o.y = 2;
    o.x = 1;
  } else {
    o.x = 1;
    o.y = 2;
  }
  return o;
}
`;

const tail = `console.log(deed(make(true)));
console.log(deed(make(false)));
function through(o) {
  return deed(o);
}
console.log(through(make(true)), through(make(false)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(make(i % 2 === 0)) + "|" + deed(make(i % 2 === 1));
console.log(last);
`;

const listed = `function listed(o) {
  let text = "";
  for (const key in o) text += key + ",";
  return text;
}
`;

// name > [what the first line says, what stands in front of the deed, the body of the deed]
const cases: Record<string, [string, string, string]> = {
  "for-in": ["a loop over its names", "", `let text = "";\n  for (const key in o) text += key + ",";\n  return text;`],
  "object-keys": ["Object.keys", "", `return Object.keys(o).join();`],
  "object-values": ["Object.values", "", `return Object.values(o).join();`],
  "object-entries": ["Object.entries", "", `return Object.entries(o).join(";");`],
  "object-assign": ["Object.assign, which gives its target the keys in that order", listed, `return listed(Object.assign(Object.create(null), o));`],
  "own-property-names": ["Object.getOwnPropertyNames", "", `return Object.getOwnPropertyNames(o).join();`],
  "own-property-descriptors": ["Object.getOwnPropertyDescriptors", listed, `return listed(Object.getOwnPropertyDescriptors(o));`],
  "reflect-own-keys": ["Reflect.ownKeys", "", `return Reflect.ownKeys(o).join();`],
  "json-stringify": ["JSON.stringify", "", `return JSON.stringify(o);`],
  "json-stringify-of-a-holder": ["JSON.stringify of an object that holds it", "", `return JSON.stringify({ held: [o] });`],
  "spread": ["a spread, which gives the copy the keys in that order", "", `return Reflect.ownKeys({ first: 0, ...o }).join();`],
  "rest": ["the rest of a pattern", listed, `const { kind, ...others } = o;\n  return kind + listed(Object.assign(Object.create(null), others));`],
  "structured-clone": ["structuredClone", listed, `return listed(Object.assign(Object.create(null), structuredClone(o)));`],
  "console-log": ["console.log, which prints it", "", `console.log(o);\n  return "printed";`],
  "proxy": ["Object.keys of a proxy whose target it is", "", `return Object.keys(new Proxy(o, {})).join();`],
  "heir": ["a loop over the names of an object that stands below it", "", `let text = "";\n  for (const key in Object.create(o)) text += key + ",";\n  return text;`],
  "prototype-of-a-constructor-function": ["a loop over the names of what a function makes whose prototype property it is", "", `function Heir() {}\n  Heir.prototype = o;\n  let text = "";\n  for (const key in new Heir()) text += key + ",";\n  return text;`],
  "set-prototype-of": ["a loop over the names of an object that Object.setPrototypeOf has laid below it", "", `let text = "";\n  for (const key in Object.setPrototypeOf({}, o)) text += key + ",";\n  return text;`],
  "another-name": ["Object.keys under another name", `const namesOf = Object.keys;\n`, `return namesOf(o).join();`],
  "call-of-the-builtin": ["Object.keys through Function.prototype.call", "", `return Object.keys.call(null, o).join();`],
  "out-of-a-map": ["Object.keys of what comes out of a Map", `const held = new Map();\n`, `held.set("it", o);\n  return Object.keys(held.get("it")).join();`],
  "out-of-a-list": ["Object.keys of what comes out of a list", "", `const list = [0, o];\n  return Object.keys(list[list.length - 1]).join();`],
  "beside-a-stranger": ["Object.keys of what has met an object of another kind in a list", "", `const either = [o, { other: 1, more: 2 }];\n  return Object.keys(either[either.length - 2]).join();`],
  "out-of-a-closure": ["Object.keys of what a closure has captured", "", `const later = () => Object.keys(o).join();\n  return later();`],
  "out-of-a-field": ["Object.keys of what lies in a field of another object", "", `const holder = { inner: o };\n  return Object.keys(holder.inner).join();`],
  "out-of-a-global": ["Object.keys of what comes back out of a property of the global object", "", `globalThis.held = o;\n  return Object.keys(globalThis.held).join();`],
  "callback-of-a-builtin": ["Object.keys in a callback that a built-in calls", "", `return [o].map(each => Object.keys(each).join()).join();`],
  "object-from-entries": ["Object.entries on its way into Object.fromEntries", listed, `return listed(Object.fromEntries(Object.entries(o)));`],
  "define-properties": ["Object.defineProperties, which goes through the keys of its descriptors", listed, `const target = Object.create(null);\n  Object.defineProperties(target, { ...Object.getOwnPropertyDescriptors(o) });\n  return listed(target);`],
  "freeze": ["nothing: Object.freeze goes through the keys and shows no order", "", `Object.freeze(o);\n  return String(o.x) + String(o.y) + String(Object.isFrozen(o));`],
};

mkdirSync(folder, { recursive: true });
for (const [name, [road, inFront, body]] of Object.entries(cases))
  writeFileSync(join(folder, `${name}.js`), `${head(road)}${inFront}function deed(o) {\n  ${body}\n}\n${tail}`);

// An object of a class below, and one of a class above: the road comes to one of them, and both are objects of the family.
const classes = (which: string, made: string) => `// The keys of an instance that got them in another order than its class declares are seen by Object.keys of ${which}.
// Under: --aot-testing=CheckProofsAtRunTime: a proof that nobody sees the order of these keys would be false
class Base {
  constructor(flip) {
    if (flip) {
      this.y = 2;
      this.x = 1;
    } else {
      this.x = 1;
      this.y = 2;
    }
  }
}
class Derived extends Base {
  constructor(flip) {
    super(flip);
    this.z = 3;
  }
}
function sum(o) {
  return o.x + o.y;
}
function deed(o) {
  return Object.keys(o).join();
}
console.log(sum(new Base(true)) + sum(new Derived(false)));
console.log(deed(new ${made}(true)));
console.log(deed(new ${made}(false)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(new ${made}(i % 2 === 0)) + "|" + deed(new ${made}(i % 2 === 1));
console.log(last);
`;
writeFileSync(join(folder, "class-below.js"), classes("an instance of the class below", "Derived"));
writeFileSync(join(folder, "class-above.js"), classes("an instance of the class above", "Base"));
