// User code runs inside assert.deepEqual: a `==` coercion or a getter. Here it changes or empties the operands
// while the comparison still holds them. Each line of the output is the verdict node gives.
import assert from "node:assert";

function verdict(name: string, compare: () => void, passes = "equal") {
  try {
    compare();
    console.log(`${name}: ${passes}`);
  } catch (error) {
    console.log(`${name}: ${(error as { code?: string }).code ?? (error as Error).name}`);
  }
}

// A function whose `==` coercion runs `hook` once and answers `answer`.
function coercing(hook: () => void, answer = "x") {
  let fired = false;
  return Object.assign(function () {}, {
    [Symbol.toPrimitive]: () => {
      if (!fired) {
        fired = true;
        hook();
        Bun.gc(true);
      }
      return answer;
    },
  });
}

// Enough added properties to cross several PropertyTable capacity doublings.
function addMany(object: Record<string, unknown>) {
  for (let i = 0; i < 100; i++) object["n" + i] = i;
}

// Object-valued siblings that compare after the hook ran.
function addSiblings(first: Record<string, unknown>, second: Record<string, unknown>) {
  for (let i = 0; i < 10; i++) {
    first["s" + i] = { v: i };
    second["s" + i] = { v: i };
  }
}

{
  const first: Record<string, unknown> = {};
  const second: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) {
    first["k" + i] = i;
    second["k" + i] = i;
  }
  first.a = coercing(() => addMany(first));
  second.a = "x";
  addSiblings(first, second);
  verdict("same structure", () => assert.deepEqual(first, second));
}
{
  const first: Record<string, unknown> = {};
  const second: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) first["k" + i] = i;
  for (let i = 7; i >= 0; i--) second["k" + i] = i;
  first.a = coercing(() => addMany(second));
  second.a = "x";
  addSiblings(first, second);
  verdict("mixed structures", () => assert.deepEqual(first, second));
}
{
  const first: Record<string, unknown> = { 0: 0 };
  const second: Record<string, unknown> = { 0: 0 };
  first.a = coercing(() => {
    addMany(first);
    addMany(second);
  });
  second.a = "x";
  addSiblings(first, second);
  verdict("index keys", () => assert.deepEqual(first, second));
}
{
  const first: unknown[] = [null];
  const second: unknown[] = ["x"];
  for (let i = 0; i < 100; i++) {
    first.push({ i });
    second.push({ i });
  }
  first[0] = coercing(() => {
    first.length = 1;
    second.length = 1;
  });
  verdict("array", () => assert.deepEqual(first, second));
}
{
  // The expected array has a hole, so the element counts of both arrays compare before the elements do.
  const first: unknown[] = [null, , "x"];
  const second: unknown[] = [null, , "x"];
  for (let i = 0; i < 50; i++) {
    first.push({ i });
    second.push({ i });
  }
  first[2] = coercing(() => {
    for (let i = 0; i < 200; i++) {
      first.push(i);
      second.push(-i);
    }
  });
  verdict("sparse array", () => assert.deepEqual(first, second));
}
{
  const first = new Uint8Array(64) as Uint8Array<ArrayBuffer> & Record<string, unknown>;
  const second = Object.assign(new Uint8Array(64), { p: "x", q: { v: 1 } });
  first.p = coercing(() => {
    first.buffer.transfer();
    second.buffer.transfer();
  });
  first.q = { v: 1 };
  verdict("typed array", () => assert.deepEqual(first, second));
}
{
  // The expected Set is emptied while 7 of its members are still to pair off.
  const first = new Set<unknown>();
  const second = new Set<unknown>();
  let fired = false;
  const clearing = {
    id: 0,
    get x() {
      if (!fired) {
        fired = true;
        second.clear();
        Bun.gc(true);
      }
      return 1;
    },
  };
  for (let i = 0; i < 8; i++) {
    first.add(i ? { id: i, x: 1 } : clearing);
    second.add({ id: 7 - i, x: 1 });
  }
  verdict("set, expected side cleared", () => assert.deepEqual(first, second));
}
{
  const first = new Set<unknown>([1]);
  const second = new Set<unknown>([
    coercing(() => {
      first.clear();
      second.clear();
    }, "1"),
  ]);
  for (let i = 1; i < 8; i++) {
    first.add({ id: i });
    second.add({ id: 8 - i });
  }
  verdict("set, function member", () => assert.deepEqual(first, second));
}
{
  const first = new Map<unknown, unknown>([["k", 1]]);
  const second = new Map<unknown, unknown>();
  second.set(
    "k",
    coercing(() => {
      for (let k = 0; k < 100; k++) {
        first.set("p" + k, k);
        second.set("p" + k, k);
      }
    }, "1"),
  );
  for (let i = 1; i < 8; i++) {
    first.set({ id: i }, { id: i });
    second.set({ id: 8 - i }, { id: 8 - i });
  }
  verdict("map, function value", () => assert.deepEqual(first, second));
}
{
  const first = new Map<unknown, unknown>();
  const second = new Map<unknown, unknown>();
  let fired = false;
  const clearing = {
    id: 0,
    get x() {
      if (!fired) {
        fired = true;
        second.clear();
        Bun.gc(true);
      }
      return 1;
    },
  };
  for (let i = 0; i < 8; i++) {
    first.set(i ? { id: i, x: 1 } : clearing, { v: i });
    second.set({ id: 7 - i, x: 1 }, { v: 7 - i });
  }
  // notDeepEqual passes, so no AssertionError renders the two Maps.
  verdict("map, expected side cleared", () => assert.notDeepEqual(first, second), "not equal");
}
{
  // Both Maps hold the same key objects, so a lookup of each key settles its entry.
  const first = new Map<unknown, unknown>();
  const second = new Map<unknown, unknown>();
  let fired = false;
  const clearing = {
    get x() {
      if (!fired) {
        fired = true;
        first.clear();
        second.clear();
        Bun.gc(true);
      }
      return 1;
    },
  };
  for (let i = 0; i < 8; i++) {
    const key = { id: i };
    first.set(key, i ? { x: 1 } : clearing);
    second.set(key, { x: 1 });
  }
  verdict("map, shared keys, both sides cleared", () => assert.deepEqual(first, second));
}
{
  const throwing = Object.assign(function () {}, {
    [Symbol.toPrimitive]: () => {
      throw new RangeError("boom");
    },
  });
  verdict("throwing coercion, array", () => assert.deepEqual([1, throwing], [1, "x"]));
  verdict("throwing coercion, set", () =>
    assert.deepEqual(new Set([{ a: 1 }, { b: 1 }, "x"]), new Set([{ b: 1 }, throwing, { a: 1 }])),
  );
  verdict("throwing coercion, map value", () =>
    assert.deepEqual(new Map([[{ k: 1 }, throwing]]), new Map([[{ k: 1 }, "x"]])),
  );
  verdict("throwing coercion, notDeepEqual", () => assert.notDeepEqual({ a: throwing }, { a: "x" }));
}
