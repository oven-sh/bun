import { makeProps, copyOf, copyWithSize, copyBehindSize, setSize, setOn, makePair, copyOfPair } from "./shapes.ts";

const mark = Symbol("mark");

function describe(o) {
  const descriptors = Object.getOwnPropertyDescriptors(o);
  return Reflect.ownKeys(o).map(key => {
    const d = descriptors[key];
    return String(key) + ":" + ("value" in d ? JSON.stringify(d.value) : "accessor") + (d.writable === false ? "!w" : "") + (d.enumerable ? "" : "!e") + (d.configurable ? "" : "!c");
  }).join() + (Object.isExtensible(o) ? "" : " not extensible");
}

const givers = {
  nothing(o) {},
  one(o) { o.tag = 1; },
  three(o) { o.a = 1; o.b = { deep: true }; o.c = "c"; },
  ten(o) { for (let i = 0; i < 10; i++) o["n" + i] = i; },
  betweenFields(o) { o.before = 1; setSize(o, 2); o.between = 3; setOn(o, true); o.after = 4; },
  symbol(o) { o.tag = 1; o[mark] = 2; },
  index(o) { o[3] = "three"; o.tag = 1; o[1] = "one"; },
  hidden(o) { o.tag = 1; Object.defineProperty(o, "hidden", { value: 2, enumerable: false, configurable: true, writable: true }); o.last = 3; },
  getter(o) { o.tag = 1; Object.defineProperty(o, "computed", { get() { return this.tag + 100; }, enumerable: true, configurable: true }); },
  readOnly(o) { Object.defineProperty(o, "fixed", { value: 1, enumerable: true, configurable: true, writable: false }); o.tag = 2; },
  notConfigurable(o) { Object.defineProperty(o, "stuck", { value: 1, enumerable: true, configurable: false, writable: true }); },
  deleted(o) { o.a = 1; o.b = 2; o.c = 3; delete o.b; },
  frozen(o) { o.tag = 1; Object.freeze(o); },
  sealed(o) { o.tag = 1; Object.seal(o); },
  notExtensible(o) { o.tag = 1; Object.preventExtensions(o); },
  proto(o) { Object.defineProperty(o, "__proto__", { value: 5, enumerable: true, configurable: true, writable: true }); },
};

export function run() {
  for (const giver in givers) {
    for (const [name, copy] of [["copyOf", copyOf], ["copyWithSize", copyWithSize], ["copyBehindSize", copyBehindSize]]) {
      const said = new Set();
      for (let i = 0; i < 5; i++) {
        const source = makeProps(7);
        givers[giver](source);
        const before = describe(source);
        const made = copy(source);
        const first = describe(made);
        made.tag = "changed";
        made.added = true;
        made.label = "changed";
        if (made.b && typeof made.b === "object") made.b.deep = "shared";
        said.add(first + " || the source afterwards " + (describe(source) === before ? "as before" : describe(source)) + " || again " + describe(copy(made)) + " || " + (made === source));
      }
      console.log(giver, name, said.size, [...said][0]);
    }
  }
  for (let i = 0; i < 4; i++) {
    const pair = makePair(i, "s");
    pair.tag = i;
    pair.more = [i];
    const made = copyOfPair(pair);
    const again = copyOfPair(made);
    again.tag = -1;
    console.log("pair", describe(pair), "|", describe(made), "|", describe(again), made.more === pair.more);
  }
  const kept = [];
  for (let i = 0; i < 20000; i++) {
    const source = makeProps(i);
    source.tag = { i };
    source["k" + (i & 7)] = i;
    kept.push(copyOf(source));
    if (kept.length > 500) kept.shift();
  }
  let sum = 0;
  for (const o of kept) sum += o.tag.i + Object.keys(o).length;
  console.log("many", sum);
}
