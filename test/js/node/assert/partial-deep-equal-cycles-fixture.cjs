// What Node.js answers for `assert.partialDeepStrictEqual(actual, expected)` when the operands have cycles, as the
// first comparison of a new process. assert.test.cjs holds Bun to these answers. They are those of Node.js v26.12.1,
// the version that Bun reports.
//
// Node.js compares with no cycle check until one comparison of the process throws, a stack overflow included. From
// then on it looks for cycles in every comparison, and some of its answers change (`detectCycles` in
// lib/internal/util/comparisons.js). So one Node.js process cannot give these answers for more than one pair. To
// check every answer, run this file with Node.js. It starts a new process for each row, and for the generated pairs
// whenever a pair has changed the process:
//
//   node test/js/node/assert/partial-deep-equal-cycles-fixture.cjs
//
// With `--write` it prints `generated.node` again.
"use strict";

const assert = require("node:assert");

// An Error as the message is thrown as it is, so no text is made of the operands.
const unequal = new Error("unequal");
function answerOf(actual, expected) {
  try {
    assert.partialDeepStrictEqual(actual, expected, unequal);
    return "pass";
  } catch (error) {
    return error === unequal ? "fail" : error.name;
  }
}

const ring = (length, value = 1) => {
  const nodes = Array.from({ length }, () => ({ v: value }));
  nodes.forEach((node, i) => (node.next = nodes[(i + 1) % length]));
  return nodes[0];
};
const tree = () => {
  const ast = { type: "Program", body: [] };
  ast.body.push({ type: "Return", parent: ast });
  return ast;
};
const partOfTree = type => ({ body: [{ type: "Return", parent: { type } }] });
// A pair of rings is inside its own comparison: Node.js compares again, and its memos then decide for `value` too.
const besideRings = (actual, expected) => [
  { loop: ring(1), value: actual },
  { loop: ring(1), value: expected },
];
const collectGarbage = () => (typeof Bun !== "undefined" ? Bun.gc(true) : globalThis.gc?.());

// name, the answer of Node.js, the operands. A fourth argument says that Bun answers something else: `bun` is an
// answer that Bun means to give, `bug` says what Bun does for now.
const rows = [];
const row = (name, node, pair, difference) => rows.push({ name, node, pair, ...difference });

// test/parallel/test-assert-deep.js of Node.js, "GH-14441. Circular structures should be consistent". That test
// expects a throw from each line of its first block, and gets one because earlier tests of its file have thrown.
{
  const firstBlock = () => {
    const a = {};
    a.a = a;
    return [a, { a: { a } }];
  };
  row("GH-14441, first block, (a, b)", "pass", firstBlock);
  row("GH-14441, first block, (b, a)", "pass", () => firstBlock().reverse());
  const secondBlock = () => {
    const a = {};
    a.a = a;
    const b = {};
    b.a = b;
    return [b, { a }];
  };
  row("GH-14441, second block, (b, c)", "fail", secondBlock);
  row("GH-14441, second block, (c, b)", "fail", () => secondBlock().reverse());
  const thirdBlock = () => {
    const a = new Set();
    a.add(a);
    const b = new Set();
    b.add(b);
    return [b, new Set([a])];
  };
  row("GH-14441, third block, (b, c)", "fail", thirdBlock);
  row("GH-14441, third block, (c, b)", "fail", () => thirdBlock().reverse());
}

// No pair comes twice here, so there is one run, with no memos.
row("new objects of getters, twenty levels deep, and a collection at the last level", "pass", () => {
  const nested = depth => ({
    get next() {
      if (depth) return nested(depth - 1);
      collectGarbage();
      return Array.from({ length: 100 }, () => ({ v: 1 }));
    },
  });
  return [nested(20), nested(20)];
});

// handleCycles remembers the first pair (a, b) and the pair below it (c, d). From the third pair on it has one Set
// for the objects of both sides. https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/comparisons.js#L536-L591
row("a ring of two against a ring of one", "fail", () => [ring(2), ring(1)]);
row("the first actual again, against another array", "fail", () => {
  const actual = [];
  actual.push(actual, actual);
  const expected = [];
  expected.push(expected, [5]);
  return [actual, expected];
});
row("the first actual again, against another Map", "fail", () => {
  const actual = new Map([["k", 1]]);
  actual.set("loop", actual).set("self", actual);
  const expected = new Map();
  expected.set("loop", expected).set("self", new Map([["k", 2]]));
  return [actual, expected];
});
row("the second pair is taken out again when its comparison is over", "fail", () => {
  const first = {};
  const second = { a: first, c: first };
  first.a = first.c = second;
  const expected = { a: {} };
  expected.c = expected;
  return [first, expected];
});
row("the Set starts with the first two pairs", "pass", () => {
  const shared = { a: 1, b: 2 };
  const first = { b: 1, c: shared };
  const second = { b: shared, c: 1, a: first };
  first.a = second;
  const loop = {};
  loop.a = loop;
  return [first, { a: loop, b: 1 }];
});
row("a third pair with one known object, before there is a Set", "fail", () => {
  const actual = [];
  actual.push(actual, actual);
  const inner = [];
  inner.push(inner);
  return [actual, [inner]];
});
row("a pair is taken out of the Set when its comparison is over", "fail", () => {
  const list = [2, 1];
  const a0 = { b: list };
  const a1 = { b: list, a: a0 };
  const a3 = {};
  const a4 = { a: a3, c: a1 };
  a0.a = a1;
  a0.c = a3;
  a3.a = a4;
  return [a0, a4];
});
row("both objects are in the Set, from other pairs", "pass", () => {
  const actual = [];
  actual.push(actual, actual);
  const outer = [];
  const inner = [outer];
  inner.push(inner);
  outer.push(inner);
  return [[actual, actual], [outer]];
});
row("both objects are in the Set, and their values differ", "pass", () => {
  const x2 = { m: "m2" };
  x2.next = x2;
  const y1 = { m: "m1" };
  y1.next = { m: "m2", next: y1 };
  return besideRings({ m: "m1", next: x2 }, y1);
});

// Node.js leaves the new object of a pair in its Set when the other object of the pair was there (L578-L583). A
// later pair can then find an object there that is not inside the comparison.
{
  const lateRing = () => {
    const late = {};
    late.next = late;
    const expected = {};
    expected.next = expected;
    return [{ next: late }, late, expected];
  };
  row("an object that was left in the Set fails the candidate that comes back to it", "fail", () => {
    const [early, late, expected] = lateRing();
    return [[early, late], [expected]];
  });
  row("the same candidates in the other order", "pass", () => {
    const [early, late, expected] = lateRing();
    return [[late, early], [expected]];
  });
  row("the object that is left is a new one of a getter", "fail", () => {
    const expected = {};
    expected.next = expected;
    const late = {};
    late.next = late;
    return [
      [
        {
          get next() {
            return late;
          },
        },
        late,
      ],
      [expected],
    ];
  });
  row("objects that are left stay alive while the Set has them", "pass", () => {
    // No candidate but the last matches, and each of the others leaves a new object of its getter in the Set. Then
    // the memory is collected, and later pairs of new objects must not be taken for objects of the Set.
    const getterOf = key => Object.defineProperty({}, key, { enumerable: true, get: () => ({ v: 1 }) });
    const actual = { loop: ring(1) };
    const expected = { loop: ring(1) };
    actual.left = Array.from({ length: 500 }, () => getterOf("x"));
    actual.left.push({ x: actual });
    expected.left = [{ x: expected }];
    Object.defineProperty(actual, "collect", { enumerable: true, get: () => (collectGarbage(), 1) });
    expected.collect = 1;
    actual.later = Array.from({ length: 500 }, () => getterOf("y"));
    expected.later = Array.from({ length: 500 }, () => ({ y: { v: 1 } }));
    return [actual, expected];
  });
}

// Before it asks its memos, Node.js answers false for an `expected` array that is longer than `actual` (L295), and
// true for an `expected` with nothing to compare (L523-L528).
row("an expected with no key, actual is in the Set", "pass", () => [
  { loop: ring(1), ast: tree() },
  { loop: ring(1), ast: { body: [{ parent: {} }] } },
]);
row("an expected with no key, actual is the second pair", "pass", () => {
  const inner = {};
  inner.self = inner.loop = inner;
  const expected = { self: {} };
  expected.loop = expected;
  return [{ k: inner }, { k: expected }];
});
row("an expected with no key that was left in the Set", "pass", () => {
  const left = {};
  const actual = { loop: ring(1), q: { z: 1 } };
  actual.list = [left, actual];
  const expected = { loop: ring(1), q: left };
  expected.list = [expected];
  return [actual, expected];
});
row("a longer expected array, both arrays are in the Set", "fail", () => {
  const inner = [];
  inner.push(inner);
  const outer = [];
  const pair = [outer, outer];
  outer.push(pair);
  return besideRings([inner, inner], pair);
});
row("a typed array has its elements compared before, and only named keys after", "pass", () => {
  const actual = new Uint8Array([1, 2]);
  actual.p = { back: actual };
  const expected = new Uint8Array([1, 2]);
  expected.p = { back: new Uint8Array([1, 2]) };
  return besideRings(actual, expected);
});
row("a Map with entries and no key is compared", "fail", () => {
  const actual = new Map([["k", 1]]);
  actual.loop = ring(1);
  actual.self = actual;
  const expected = new Map([["k", 1]]);
  expected.loop = ring(1);
  expected.self = new Map([["k", 2]]);
  return [actual, expected];
});
row("a Set with members and no key is compared", "fail", () => {
  const actual = new Set();
  actual.add({ up: actual });
  return besideRings(actual, new Set([{ up: new Set([2]) }]));
});

// Own keys come before elements, entries and members (objEquiv). The key `p` of the first candidate differs, so
// what it holds, which comes back to it, is not compared. The second candidate ends at `expected` itself.
for (const [kind, make, add] of [
  ["an array", () => [], (list, value) => list.push(value)],
  ["a Map", () => new Map(), (map, value) => map.set("k", value)],
  ["a Set", () => new Set(), (set, value) => set.add(value)],
]) {
  row(`the own keys of ${kind} come first`, "pass", () => {
    const holding = (value, p) => {
      const holder = make();
      add(holder, value ?? holder);
      holder.p = p;
      return holder;
    };
    const expected = holding(undefined, 2);
    return [
      { list: [holding(undefined, 1), holding(expected, 2)], ast: tree() },
      { list: [expected], ast: partOfTree("Program") },
    ];
  });
}

// An Error has `message`, `name`, `cause` and `errors` compared before its pair reaches the memos (L391-L404).
{
  const hiddenCause = (error, cause) =>
    Object.defineProperty(error, "cause", { value: cause, writable: true, configurable: true });
  row("Errors that are in the Set still have their messages compared", "fail", () => {
    const actual = new Error("a");
    actual.loop = ring(1);
    actual.self = actual;
    const expected = new Error("a");
    expected.loop = ring(1);
    expected.self = new Error("b");
    return [actual, expected];
  });
  row("Errors that are both in the Set, from other pairs, with other messages", "fail", () => {
    const x2 = new Error("m2");
    x2.next = x2;
    const x1 = new Error("m1");
    x1.next = x2;
    const y1 = new Error("m1");
    y1.next = new Error("m2");
    y1.next.next = y1;
    return besideRings(x1, y1);
  });
  row("an Error comes back to itself through a key of its cause", "pass", () => {
    const actual = new Error("boom");
    actual.cause = { back: actual };
    return besideRings(actual, new Error("boom", { cause: { back: new Error("boom") } }));
  });
  row("the same, and the message of the last Error differs", "fail", () => {
    const actual = new Error("boom");
    actual.cause = { back: actual };
    return besideRings(actual, new Error("boom", { cause: { back: new Error("other") } }));
  });
  row("a pair of Errors that was never compared is not taken for a known pair", "fail", () => {
    const outer = new Error("outer");
    hiddenCause(outer, new Error("inner", { cause: outer }));
    const inner = new Error("inner");
    hiddenCause(inner, inner);
    return besideRings(outer, new Error("outer", { cause: inner }));
  });
  row("one graph of Errors and objects on both sides", "fail", () => {
    const context = {};
    const outer = new Error("m", { cause: context });
    outer.a = 1;
    const inner = new Error("m", { cause: { a: outer } });
    context.a = inner;
    context.b = context;
    context.c = outer;
    return [outer, inner];
  });
  row("the cause of an AggregateError comes before its errors", "pass", () => {
    const holding = (cause, error) => {
      const aggregate = new AggregateError([], "m", { cause });
      aggregate.errors.push(error ?? aggregate);
      return aggregate;
    };
    const expected = holding(2);
    return [
      { list: [holding(1), holding(2, expected)], ast: tree() },
      { list: [expected], ast: partOfTree("Program") },
    ];
  });
  row("no error of an AggregateError has the cause that expected asks for", "fail", () => {
    const actual = new AggregateError([], "m", { cause: 2 });
    actual.errors.push(actual, actual);
    const inner = new AggregateError([], "m", { cause: 1 });
    inner.errors.push(inner);
    return [actual, new AggregateError([inner], "m", { cause: 2 })];
  });
  // A `cause` that is not enumerable is compared ahead of the memos only, so nothing ends the comparison.
  const selfCaused = setCause => {
    const error = new Error("x");
    setCause(error, error);
    return error;
  };
  const assign = (error, cause) => (error.cause = cause);
  row("each Error is its own cause, and the cause is enumerable", "pass", () => [
    selfCaused(assign),
    selfCaused(assign),
  ]);
  row("each Error is its own cause, and the cause is not enumerable", "RangeError", () => [
    selfCaused(hiddenCause),
    selfCaused(hiddenCause),
  ]);
}

// A Map key that both Maps hold. Bun asks for its entry once, by lookup.
{
  const key = { k: 1 };
  const backToRoot = (actualEntries, expectedKey = key) => {
    const expected = { loop: ring(1) };
    expected.map = new Map([[expectedKey, expected]]);
    return [{ loop: ring(1), map: new Map(actualEntries) }, expected];
  };
  row("the value of a shared Map key differs from an expected that comes back", "fail", () =>
    backToRoot([[key, { v: 2 }]]),
  );
  row("the same, with another entry in actual", "fail", () =>
    backToRoot([
      [key, { v: 2 }],
      ["other", 1],
    ]),
  );
  row("the same, with a key that is equal and not shared", "fail", () => backToRoot([[{ k: 1 }, { v: 2 }]], { k: 1 }));
  row("the same, with a string key", "fail", () => backToRoot([["k", { v: 2 }]], "k"));
  row("the value of a shared Map key differs from an expected that holds itself", "fail", () => {
    const expectedNode = { name: "kid" };
    expectedNode.links = new Map([[key, expectedNode]]);
    return besideRings({ name: "kid", links: new Map([[key, { name: "other" }]]) }, expectedNode);
  });
}

// A Set of `expected` with more than one member to find.
row("the second member of an expected Set has no match", "fail", () => {
  const actual = new Set([ring(1), { v: 2 }, { v: 3 }]);
  return [actual, new Set([ring(1), { v: 4 }])];
});
row("both members of an expected Set have a match", "pass", () => {
  const actual = new Set([{ v: 2 }, ring(1), { v: 3 }]);
  return [actual, new Set([ring(1), { v: 3 }])];
});

// Where Bun does not answer as Node.js, and does not mean to.
row(
  "a getter that throws only the first time",
  "pass",
  () => {
    let thrown = false;
    const actual = {
      get v() {
        if (thrown) return 1;
        thrown = true;
        throw new TypeError("from a getter");
      },
    };
    return [actual, { v: 1 }];
  },
  // Node.js compares again after any throw.
  { bun: "TypeError" },
);
row(
  "a Map key that both Maps hold, beside rings",
  "fail",
  () => {
    const key = { k: 1 };
    return besideRings(
      new Map([
        [key, 1],
        ["other", 1],
      ]),
      new Map([[key, 1]]),
    );
  },
  // Under its memos Node.js compares such a key with itself as two objects, and takes the second for a known one.
  { bun: "pass" },
);

// Where Bun does not answer as Node.js yet. Node.js looks for each member of an expected Set in `actual` by lookup
// before it compares members. Bun compares the members in their order.
row(
  "a member of an expected Set is also a member of a Set of actual",
  "pass",
  () => {
    const expected = new Set();
    expected.add(expected);
    const inner = new Set();
    inner.add(inner).add(expected);
    return [new Set([inner]), expected];
  },
  { bug: "fails it" },
);
row(
  "the expected Set is a member of actual",
  "fail",
  () => {
    const actual = new Set();
    const expected = new Set();
    const third = new Set();
    actual.add(actual).add(expected);
    expected.add(expected).add(third);
    third.add(third).add(expected);
    return [actual, expected];
  },
  { bug: "passes it" },
);

// A seed and a set of kinds make one pair of small object graphs. A value of a graph is a number or another object of
// that graph, so most graphs have cycles. One value in twenty is an object of the other graph.
//   o objects    a arrays    m Maps    s Sets    e Errors and AggregateErrors
//   k Map keys that are objects of both graphs    p named keys on arrays, Maps and Sets
function build(seed, kinds) {
  // mulberry32
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = n => Math.floor(random() * n);
  const types = ["object", "object", "object", "object", "array"];
  if (kinds.includes("m")) types.push("map");
  if (kinds.includes("s")) types.push("set");
  if (kinds.includes("e")) types.push("error", "aggregate");
  const message = () => (random() < 0.85 ? "m" : "n");
  const make = {
    object: () => ({}),
    array: () => [],
    map: () => new Map(),
    set: () => new Set(),
    error: () => new Error(message()),
    aggregate: () => new AggregateError([], message()),
  };
  const mapKeys = kinds.includes("k") ? ["k1", { k: 1 }, { k: 2 }] : ["k1", "k2"];

  const actualCount = 1 + pick(4);
  const expectedCount = 1 + pick(3);
  const actualTypes = Array.from({ length: actualCount }, () => types[pick(types.length)]);
  const expectedTypes = Array.from({ length: expectedCount }, (_, i) =>
    random() < 0.8 ? actualTypes[i % actualCount] : types[pick(types.length)],
  );
  const actualNodes = actualTypes.map(type => make[type]());
  const expectedNodes = expectedTypes.map(type => make[type]());

  const value = (own, other) => {
    const r = random();
    if (r < 0.3) return [1, 1, 1, 2][pick(4)];
    if (r < 0.95) return own[pick(own.length)];
    return other[pick(other.length)];
  };
  const fill = (node, type, own, other, isActual) => {
    if (type === "object") {
      for (const key of ["a", "b", "c"]) if (random() < (isActual ? 0.85 : 0.5)) node[key] = value(own, other);
    } else if (type === "array") {
      for (let i = 0, length = 1 + pick(isActual ? 3 : 2); i < length; i++) node.push(value(own, other));
    } else if (type === "map") {
      for (const key of mapKeys) if (random() < (isActual ? 0.85 : 0.5)) node.set(key, value(own, other));
    } else if (type === "set") {
      for (let i = 0, size = 1 + pick(isActual ? 3 : 2); i < size; i++) node.add(value(own, other));
    } else {
      for (const key of ["a", "b"]) if (random() < (isActual ? 0.6 : 0.3)) node[key] = value(own, other);
      if (random() < 0.6) {
        // As `new Error(message, { cause })` makes it, or as an assignment does.
        const cause = value(own, other);
        if (random() < 0.5) Object.defineProperty(node, "cause", { value: cause, writable: true, configurable: true });
        else node.cause = cause;
      }
      if (type === "aggregate") {
        for (let i = 0, length = isActual ? 1 + pick(2) : pick(2); i < length; i++) node.errors.push(value(own, other));
      }
    }
  };
  actualNodes.forEach((node, i) => fill(node, actualTypes[i], actualNodes, expectedNodes, true));
  expectedNodes.forEach((node, i) => fill(node, expectedTypes[i], expectedNodes, actualNodes, false));
  if (kinds.includes("p")) {
    const named = (node, type, own, other, isActual) => {
      if (type !== "object" && random() < (isActual ? 0.6 : 0.4)) node.p = value(own, other);
    };
    actualNodes.forEach((node, i) => named(node, actualTypes[i], actualNodes, expectedNodes, true));
    expectedNodes.forEach((node, i) => named(node, expectedTypes[i], expectedNodes, actualNodes, false));
  }
  return [actualNodes[0], expectedNodes[0]];
}

// The answers for the seeds 0 to `seeds` of each set of kinds. A hex digit holds four seeds, the first seed in its
// high bit: 1 is a pass. `rangeError` lists the seeds that end in a RangeError.
const generated = {
  seeds: 2000,
  node: {
    oa: {
      pass: [
        "00882401501400011030822a01c22b2040060a87000068000a9800d0830852005010aa904c0650800000e361a08519000e02",
        "1a04832080a00383448c28128a150231200110416080225800a0e400ca081000000034034080d1800216280900262080dc81",
        "60401701110028e207c1400100058702010064c08800088210620005080100909140020205c828001014072a02400b000004",
        "07118308827b6d0000c010a40000700248c484c424a9811201269840080801048c50409100009100440740fa110920048501",
        "309a0554c141238100110b124008102dac03288c012080820200a4818040001aa193480000000c84001240e680880b90111e",
      ].join(""),
      rangeError: [],
    },
    oap: {
      pass: [
        "00882401501400011010822a01c22b2040060887000068000a9800d0830810005010aa904c0650800000e361a08511000e02",
        "1a04832080a00383448c28028a150231200110416080225800a0e400ca001000000034014080d1800216280900262080dc81",
        "60401701010028a205c1400100058702010064c088000882106200050801009081400202044828001010072a02400b000004",
        "03118308827b6d0000c010a40000700248c484c424a9011201269840080801048c50409000009100440740ba110900048501",
        "309a01544141238100110b124008102d8c01088c010080820200a4818040001aa193480000000c84001240e680880390111e",
      ].join(""),
      rangeError: [],
    },
    oams: {
      pass: [
        "01802c000010400990342426014003046010029100806200029800d0104451884042e2a04008422800107141184956600b01",
        "1a44120000e0028742802c808b1502b0040080406281705022a46482ca1a00044822802a0200e0c0921028c9113221204881",
        "404006801a003ac205e04021020d8702032044c09200028b00628026ac2100500340000205442800100103a200500b080041",
        "060302080040298100c318a4000052e058c48040060284228020198808080008e9000091000051000403005a100924148302",
        "209e0540c1500323000001530e48102ea201a88e0021948200002e8161000490a096282081000a40041290f680a40b18111c",
      ].join(""),
      rangeError: [],
    },
    oamsp: {
      pass: [
        "018024000010400990102426014003046000009100006200029800d0100411884042e2a04000402800107141184954600b01",
        "1a44020000e00287408024008a1502b0040080406280605002a46482ca0200040802802a0200c080921028c9110221204881",
        "404006801a003a8205c04020020d8702032044c09200028a006280242c0100100140000204442800100003a200400b080040",
        "020102080040298000c218a4000050a058c08040040284228020198008080000e8000090000011000403001a100904048302",
        "2092014041500301000001530808102a8201888e0001948200002c8160000490a096282080000840041210f680840318111c",
      ].join(""),
      rangeError: [],
    },
    oae: {
      pass: [
        "20a02c40021800098004242401490f406402008100804280228801d1010003004000a8204a804108100041c1180140000300",
        "5a08020200a202234080ac4081150291800080602080005622a46402c2000c06082200080000c08082102a69050200804880",
        "504006840102522201c0402102098783112046808102088309600000a021021001800203044020001402030a005000000800",
        "020902100420288000d810a00000122042c08060048004220028090008080388a90000b8001099010403814ac40040048142",
        "2091010001102302000001330a49002e0000080c20009002000c0c800200001081140c00800008142012006682e419081115",
      ].join(""),
      rangeError: [187, 214, 250, 638, 874, 963, 982, 1373, 1910, 1947],
    },
    oamk: {
      pass: [
        "0180a400401000010045003200422a2060140c81c0284a04128803d2010440105800a0104a004080000072e0208d09000200",
        "1a18028001a013e3468028008b1502d000001c406084805a02a42400da180004080210014000e0808514284900220000c883",
        "42401601010808a205e14001100087a309006480a01008820060010408080110010022020540200014400302024083000000",
        "0213030800426e0001e859a48000124640cc80e024ac05068122196002080286884040a1080001004207418a000000140301",
        "20b4015400013102000141124c08802c1a00088c210880038000648420c0088a80944820800204800012416680cc03001115",
      ].join(""),
      rangeError: [],
    },
  },
  // Where Bun does not answer as Node.js: the seed, and what Bun answers. Seed 1948 has a Map key that both Maps hold
  // (the row "a Map key that both Maps hold, beside rings").
  bun: { oamk: { 1948: "pass" } },
};
const answerOfNode = (kinds, seed) => {
  const { pass, rangeError } = generated.node[kinds];
  if (rangeError.includes(seed)) return "RangeError";
  return (parseInt(pass[seed >> 2], 16) >> (3 - (seed & 3))) & 1 ? "pass" : "fail";
};

module.exports = { answerOf, answerOfNode, besideRings, build, generated, partOfTree, ring, rows, tree };

if (require.main === module) {
  const { spawnSync } = require("node:child_process");
  const [mode, ...args] = process.argv.slice(2);
  const inNewProcess = (...childArgs) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [__filename, ...childArgs], { encoding: "utf8" });
    if (status !== 0) throw new Error(`${childArgs.join(" ")}: ${stderr}`);
    return stdout;
  };
  // The process answers as a new one while this pair passes.
  const isNewProcess = () => answerOf(tree(), partOfTree("Program")) === "pass";

  if (mode === "--row") {
    process.stdout.write(answerOf(...rows[Number(args[0])].pair()));
  } else if (mode === "--seeds") {
    const [kinds, from] = [args[0], Number(args[1])];
    for (let seed = from; seed < generated.seeds && isNewProcess(); seed++) {
      process.stdout.write(`${answerOf(...build(seed, kinds))}\n`);
    }
  } else {
    const answersOf = kinds => {
      const answers = [];
      while (answers.length < generated.seeds) {
        answers.push(...inNewProcess("--seeds", kinds, String(answers.length)).trim().split("\n"));
      }
      return answers;
    };
    if (mode === "--write") {
      const node = {};
      for (const kinds of args.length ? args : Object.keys(generated.node)) {
        const answers = answersOf(kinds);
        let pass = "";
        for (let seed = 0; seed < answers.length; seed += 4) {
          const bits = answers.slice(seed, seed + 4).map(answer => (answer === "pass" ? "1" : "0"));
          pass += parseInt(bits.join("").padEnd(4, "0"), 2).toString(16);
        }
        const rangeError = answers.flatMap((answer, seed) => (answer === "RangeError" ? [seed] : []));
        const other = answers.filter(answer => !["pass", "fail", "RangeError"].includes(answer));
        if (other.length) throw new Error(`${kinds}: ${other}`);
        node[kinds] = { pass: pass.match(/.{1,100}/g), rangeError };
      }
      console.log(JSON.stringify(node, null, 2));
    } else {
      const differences = [];
      rows.forEach(({ name, node }, index) => {
        const answer = inNewProcess("--row", String(index));
        if (answer !== node) differences.push(`${name}: ${answer}, and not ${node}`);
      });
      for (const kinds of Object.keys(generated.node)) {
        answersOf(kinds).forEach((answer, seed) => {
          if (answer !== answerOfNode(kinds, seed))
            differences.push(`${kinds} ${seed}: ${answer}, and not ${answerOfNode(kinds, seed)}`);
        });
      }
      console.log(`Node.js ${process.version}: ${differences.length} answers differ`);
      if (differences.length) {
        console.log(differences.join("\n"));
        process.exitCode = 1;
      }
    }
  }
}
