function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function half(n: number): number {
  return n / 2;
}

function size(s: string): number {
  return s.length;
}

function passOn(value) {
  return half(value);
}

function passOnText(value) {
  return size(value);
}

function add(a, b) {
  return a + b;
}

function firstOf(list) {
  return list[0];
}

function callIt(f, value) {
  return f(value);
}

function messageSize(run: () => void): number {
  try {
    run();
    return -1;
  } catch (e) {
    return size(e.message);
  }
}

function codePlusOne(run: () => void): number {
  try {
    run();
    return -1;
  } catch (e) {
    const code: number = e.code;
    return code + 1;
  }
}

function whoAmI() {
  return this === undefined ? "undefined" : typeof this;
}

const holder = {
  n: 5,
  read() {
    return this.n + 1;
  },
  later: function () {
    return function () {
      return this === undefined ? "lost" : "kept";
    };
  },
};

let anything;
const bag = {};
let empty;

attempt("honest", () => [passOn(4), passOnText("ab"), add(1, 2), firstOf([7]), callIt(half, 4), messageSize(() => { throw new Error("abc"); }), whoAmI(), holder.read(), holder.later()()]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += passOn(i) + passOnText("ab") + add(i, 1) + firstOf([i]) + callIt(half, i);
console.log("2000 honest rounds", warm);

attempt("passOn", () => [passOn("8"), passOn(null), passOn(undefined), passOn([8]), passOn({ valueOf: () => 8 }), passOn(true)]);
attempt("passOn a bigint", () => passOn(8n));
attempt("passOnText", () => [passOnText([1, 2]), passOnText(5), passOnText({ length: "long" }), passOnText(() => {})]);
attempt("passOnText null", () => passOnText(null));
attempt("add", () => [add("a", 1), add(1, "a"), add(null, 1), add(undefined, 1), add([], {}), add(1n, 2n), add(-0, -0)]);
attempt("firstOf", () => [firstOf("ab"), firstOf({ 0: "zero" }), firstOf([]), firstOf(5), firstOf(new Uint8Array([9]))]);
attempt("callIt", () => [callIt(half, "8"), callIt(size, [1]), callIt(String, 5)]);
attempt("callIt something that is no function", () => callIt(5, 5));
attempt("caught: a string", () => messageSize(() => { throw "text"; }));
attempt("caught: null", () => messageSize(() => { throw null; }));
attempt("caught: a literal", () => messageSize(() => { throw { message: [1, 2, 3] }; }));
attempt("caught: a number for the message", () => messageSize(() => { throw { message: 5 }; }));
attempt("caught: codes", () => [codePlusOne(() => { throw { code: 1 }; }), codePlusOne(() => { throw { code: "1" }; }), codePlusOne(() => { throw new Error("none"); }), codePlusOne(() => { throw 5; })]);
attempt("this", () => [whoAmI.call(5), whoAmI.call("s"), whoAmI.call(null), whoAmI.call({}), whoAmI.bind(true)()]);
attempt("a method taken off", () => {
  const read = holder.read;
  return read();
});
attempt("a variable that takes every kind", () => {
  const seen: string[] = [typeof anything];
  anything = 1;
  seen.push(typeof anything, String(half(anything)));
  anything = "text";
  seen.push(typeof anything, String(size(anything)));
  anything = null;
  seen.push(typeof anything);
  return seen;
});
attempt("an empty literal and an empty list", () => {
  empty = [];
  empty.push(1);
  empty.push("two");
  return [Object.keys(bag), empty, empty.map(v => v + 1)];
});
attempt("honest again", () => [passOn(4), passOnText("ab"), add(1, 2), firstOf([7]), callIt(half, 4)]);
