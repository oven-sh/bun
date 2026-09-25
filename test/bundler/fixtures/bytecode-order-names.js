#!/usr/bin/env bun
// Every kind of function JavaScriptCore compiles, each one run: see "what an order file calls code" and
// "every function JavaScriptCore runs has a name" in bun-build-compile.test.ts.
import { bytecodeOrderStats } from "bun:jsc";
var hoisted = 1,
  { a: renamed = 2, ...others } = { a: undefined, b: 3 },
  [first, , third = 4, ...more] = [5, 6];
let count = 0n + 10n;
const text = `head ${count} middle ${hoisted} tail`,
  tagged = String.raw`raw\n${first}`,
  pattern = /a+b/giu;
function declared(p, { q = 1, r: [s] = [2] } = {}, ...rest) {
  if (p > q) return p - q;
  else if (p < q) return q - p;
  else if ((p == q && s != 2) || rest.length === 0) {
    label: for (let i = 0, j = 10; i < j; i++, j--) {
      for (const key in { x: 1 }) {
        if (key !== "x") continue label;
        break label;
      }
    }
    for (const item of rest) count += BigInt(item);
    while (p-- > 0) {
      do {
        q **= 2;
        q++;
      } while (q < 100);
    }
    switch (typeof s) {
      case "number":
        s <<= 1;
        s >>= 1;
        s >>>= 0;
        break;
      case "string":
      default:
        s = +s;
    }
    try {
      throw new Error("x", { cause: p });
    } catch ({ message }) {
      q = message.length;
    } finally {
      q |= 1;
      q &= 3;
      q ^= 2;
    }
    try {
      void 0;
    } catch {
      debugger;
    }
    return ~q % 7;
  }
  return -p;
}
const expression = function named(n) {
  return n <= 1 ? 1 : n * named(n - 1);
};
const arrow = x => x ?? hoisted,
  block = (x, y) => {
    x ||= y;
    x &&= y;
    x ??= y;
    return [x, y, ...more];
  };
const asyncArrow = async x => await x,
  asyncBlock = async x => {
    for await (const y of [x]) return y;
  },
  asyncPlain = async () => 1;
async function asyncDeclared(x) {
  return (await x)?.value?.[0]?.(1) ?? null;
}
async function asyncWithoutAwait(x) {
  return x;
}
async function awaitsInAFieldName() {
  class Keyed {
    [await Promise.resolve("key")] = 1;
  }
  return new Keyed().key;
}
function* generator(n) {
  const got = yield n;
  yield* [got, n];
}
async function* asyncGenerator(n) {
  yield await n;
}
class Base {
  static #count = 0;
  static shared = new Map();
  static {
    Base.#count = declared(1);
  }
  #secret = 1;
  plain = this.#secret + 1;
  ["comp" + "uted"] = () => this.plain;
  static [Symbol.iterator] = null;
  static [(1, "parenthesized") + ""] = 1;
  constructor(v) {
    this.v = v;
    new.target;
  }
  method() {
    return super.toString();
  }
  get value() {
    return this.#secret;
  }
  set value(v) {
    this.#secret = v;
  }
  static create() {
    return new Base(Base.#count++);
  }
  async load() {
    await null;
    return import.meta.url;
  }
  *items() {
    yield this.v;
  }
  async *stream() {
    yield this.v;
  }
  #hidden() {
    return #secret in this;
  }
  hidden() {
    return this.#hidden();
  }
}
class Derived extends Base {
  extra = 1;
}
// The name of a class element may start with an async arrow.
class Keyed {
  [async () => 1] = 2;
  static [(async x => x)(3)] = 4;
}
class Empty {}
const Anonymous = class extends Empty {
  static nested = class Inner {};
};
const object = {
  hoisted,
  "quoted key": 1,
  2: true,
  [text]: false,
  ...others,
  method() {
    return this;
  },
  get accessor() {
    return null;
  },
  set accessor(v) {},
  async am() {},
  *gen() {},
  async *agen() {},
  arrow: () => ({}),
  fn: function () {
    return arguments.length;
  },
};
delete object[2];
typeof object;
!object;
-count;
hoisted++;
--hoisted;
hoisted in object;
object instanceof Base;
export default async function main() {
  const base = Base.create();
  base.value = base.value + 1;
  const ran = [
    declared(1),
    declared(1, { q: 1 }),
    expression(3),
    arrow(),
    block(1, 2),
    await asyncArrow(1),
    await asyncBlock(1),
    await asyncPlain(),
    await asyncDeclared({ value: [() => 1] }),
    await asyncWithoutAwait(1),
    await awaitsInAFieldName(),
    [...generator(1)],
    (await asyncGenerator(1).next()).value,
    base.computed(),
    base.method(),
    base.hidden(),
    await base.load(),
    [...base.items()],
    (await base.stream().next()).value,
    new Derived(1).method?.(),
    new Keyed(),
    new Empty(),
    new Anonymous(),
    new Anonymous.nested(),
    object.method(),
    object.accessor,
    (object.accessor = 1),
    await object.am(),
    [...object.gen()],
    await object.agen().next(),
    object?.arrow(),
    object.fn?.call(object, 1, ...[2, 3]),
    tagged,
    pattern,
    renamed,
    third,
    // A chunk that has no bytecode: what it says is not JavaScript.
    (await import("./data.json")).default.answer,
  ];
  return ran.length;
}
console.log(await main());
if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
