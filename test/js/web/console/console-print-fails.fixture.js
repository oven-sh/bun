// Each row makes one console call. Its formatting throws, or it runs a hook
// that prints a message of its own. After the call, the row prints a marker
// line on stdout and one on stderr. Bytes that the call left on a stream show
// up in front of that stream's marker.
//
// Node prints the same two streams for this file.
const custom = Symbol.for("nodejs.util.inspect.custom");
const thrower = {
  [custom]() {
    throw new Error("hook");
  },
};
const prints = (print, result) => ({
  [custom]() {
    print();
    return result;
  },
});

function row(name, call) {
  let outcome = "returned";
  try {
    call();
  } catch (e) {
    outcome = "threw " + e.message;
  }
  console.log(`-- ${name}: ${outcome}`);
  console.error(`-- ${name}`);
}

// A hook that throws, reached from each method that formats its arguments.
row("log", () => console.log([1, thrower]));
row("info", () => console.info({ a: 1, b: thrower }));
row("debug", () => console.debug("first", thrower));
row("warn", () => console.warn([1, thrower]));
row("error", () => console.error("first", thrower));
row("dir", () => console.dir([1, thrower], { customInspect: true }));
row("dirxml", () => console.dirxml([1, thrower]));
row("trace", () => console.trace("first", thrower));
row("assert", () => console.assert(false, "first", thrower));
row("table", () => console.table([{ a: 1 }, { a: thrower }]));
// Whether the group starts is not the subject here: end it if it did.
row("group", () => {
  try {
    console.group("first", thrower);
  } finally {
    console.groupEnd();
  }
});
row("groupCollapsed", () => {
  try {
    console.groupCollapsed("first", thrower);
  } finally {
    console.groupEnd();
  }
});

// Other code that the formatter runs.
row("Map value", () =>
  console.log(
    new Map([
      ["k", 1],
      ["j", thrower],
    ]),
  ),
);
row("Set value", () => console.log(new Set([1, thrower])));
row("class field", () =>
  console.log(
    new (class Foo {
      a = 1;
      b = thrower;
    })(),
  ),
);
// prettier-ignore
row("%s toString", () => console.log("a %s b", { toString() { throw new Error("toString"); } }));
// prettier-ignore
row("%d valueOf", () => console.log("a %d b", { valueOf() { throw new Error("valueOf"); } }));
// prettier-ignore
row("%j toJSON", () => console.log("a %j b", { toJSON() { throw new Error("toJSON"); } }));
row("%o", () => console.log("a %o b", thrower));
row("second hook", () =>
  console.log(
    prints(() => {}, "fine"),
    thrower,
  ),
);

// The line after a failed one, in a group.
console.group("group");
row("in a group", () => console.log([1, thrower]));
console.groupEnd();

// More bytes before the throw than the console buffers at once (4096).
for (const size of [4000, 4088, 4089, 5000, 100000]) {
  row(`${size} bytes, then a throw`, () => console.log([Buffer.alloc(size, "x").toString(), thrower]));
}
row("many lines, then a throw", () => console.log([...Array.from({ length: 99 }, (_, i) => i * 1e15), thrower]));

// A message that a hook prints comes out before the message that called it.
row("hook logs", () => console.log([1, prints(() => console.log("INNER"), "x"), 3]));
row("hook logs, %s", () => console.log("a %s b", { toString: () => (console.log("INNER"), "x") }));
row("hook logs on the other stream", () => console.log([1, prints(() => console.error("INNER"), "x"), 3]));
row("hook logs, other stream first", () => console.error([1, prints(() => console.log("INNER"), "x"), 3]));
row("hook logs twice", () => console.log([1, prints(() => (console.log("ONE"), console.log("TWO")), "x"), 3]));
row("two levels", () =>
  console.log([1, prints(() => console.log([2, prints(() => console.log("INNERMOST"), "b")]), "a")]),
);
row("hook logs, then throws", () =>
  console.log([
    1,
    prints(() => {
      console.log("INNER");
      throw new Error("after INNER");
    }),
  ]),
);
row("hook catches its own failed log", () =>
  console.log([
    1,
    prints(() => {
      try {
        console.log([9, thrower]);
      } catch {}
    }, "y"),
  ]),
);
row("hook calls log()", () => console.log([1, prints(() => console.log(), "x")]));
row("hook calls count()", () => console.log([1, prints(() => console.count("c"), "x")]));
row("hook writes to process.stdout", () => console.log([1, prints(() => process.stdout.write("INNER\n"), "x")]));
row("hook logs after 5000 bytes, then throws", () =>
  console.log([
    Buffer.alloc(5000, "x").toString(),
    prints(() => {
      console.log("INNER");
      throw new Error("after INNER");
    }),
  ]),
);

console.log("done");
