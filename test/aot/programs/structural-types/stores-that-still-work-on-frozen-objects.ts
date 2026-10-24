const log: string[] = [];

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join() + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join() + "]");
  }
  log.length = 0;
}

interface Dial {
  level: number;
}

function turn(d: Dial, level: number): number {
  d.level = level;
  return d.level;
}

let outside = 0;

class Remote {
  get level(): number {
    return outside;
  }
  set level(value: number) {
    log.push("setter of the class " + value);
    outside = value;
  }
}

class Hidden {
  #level = 0;
  get level(): number {
    return this.#level;
  }
  set level(value: number) {
    log.push("private store " + value);
    this.#level = value;
  }
  bump(): number {
    return ++this.#level;
  }
}

class Backed {
  backing = 0;
  get level(): number {
    return this.backing;
  }
  set level(value: number) {
    log.push("store to a field " + value);
    this.backing = value;
  }
}

const ownAccessor: Dial = Object.freeze({
  get level(): number {
    return outside;
  },
  set level(value: number) {
    log.push("own setter " + value);
    outside = value;
  },
});

attempt("a plain frozen member", () => turn(Object.freeze({ level: 0 }), 1));
attempt("a frozen object with its own accessor", () => turn(ownAccessor, 2));
attempt("a frozen instance, the class has a setter", () => turn(Object.freeze(new Remote()), 3));
attempt("a frozen instance, the setter stores to a private name", () => turn(Object.freeze(new Hidden()), 4));
attempt("a frozen instance, a method stores to a private name", () => Object.freeze(new Hidden()).bump());
attempt("a frozen instance, the setter stores to a field", () => turn(Object.freeze(new Backed()), 5));
attempt("a frozen child of an object with a setter", () => turn(Object.freeze(Object.create(new Remote())), 6));

interface Holder {
  list: number[];
  map: Map<string, number>;
  inner: Dial;
}

const holder: Holder = Object.freeze({ list: [1], map: new Map<string, number>(), inner: { level: 0 } });
attempt("what a frozen object points to: an array", () => holder.list.push(2));
attempt("a map", () => holder.map.set("a", 1).size);
attempt("an object", () => turn(holder.inner, 7));
attempt("the members themselves", () => {
  holder.list = [];
  return "replaced";
});
console.log("holds: " + JSON.stringify(holder) + " " + holder.map.size);

const notes = new WeakMap<object, string>();
const frozenKey = Object.freeze({ level: 0 });
notes.set(frozenKey, "noted");
console.log("a frozen object as a weak key: " + notes.get(frozenKey));

const frozenMap = Object.freeze(new Map<string, number>());
attempt("a frozen map still takes entries", () => frozenMap.set("k", 1).size);
const frozenSet = Object.freeze(new Set<number>());
attempt("a frozen set still takes values", () => frozenSet.add(1).size);
const frozenDate = Object.freeze(new Date(0));
attempt("a frozen date still moves", () => frozenDate.setTime(5));
attempt("a typed array with elements cannot be frozen", () => Object.freeze(new Uint8Array(2)).length);
attempt("an empty typed array can", () => Object.isFrozen(Object.freeze(new Uint8Array(0))));
attempt("a typed array with elements cannot be sealed", () => Object.seal(new Uint8Array(2)).length);
const closedBytes = Object.preventExtensions(new Uint8Array(2));
attempt("a typed array that is not extensible is stored to", () => ((closedBytes[0] = 7), closedBytes.join()));

const open: Dial = { level: 0 };
for (let i = 0; i < 2000; i++) turn(open, i);
console.log("2000 honest: " + open.level);
attempt("then frozen with a class setter", () => turn(Object.freeze(new Remote()), 8));
attempt("then frozen and plain", () => turn(Object.freeze({ level: 0 }), 9));
attempt("then frozen with a private name", () => turn(Object.freeze(new Hidden()), 10));
attempt("then open", () => turn(open, 11));

export {};
