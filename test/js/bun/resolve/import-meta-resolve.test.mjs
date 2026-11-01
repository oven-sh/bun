// You can run this test in Node.js/Deno
import assert from "node:assert";
import process from "node:process";

const { test } = process?.versions?.bun ? Bun.jest(import.meta.path) : {};

function wrapped(name, f) {
  if (test) {
    test(name, f);
  } else {
    f();
    console.log("✅", name);
  }
}

function fileUrlRelTo(actual, expected_rel) {
  try {
    var compareTo;
    wrapped(expected_rel, () => {
      actual = actual();
      if (actual instanceof URL) actual = actual.toString();

      compareTo = new URL(expected_rel, import.meta.url).toString();
      assert.strictEqual(actual, compareTo);
    });
  } catch (error) {
    if (typeof actual == "function") {
      console.log("  ", error.message);
      return;
    }
    console.log("❌", expected_rel);
    console.log("   want: \x1b[32m%s\x1b[0m", compareTo);
    console.log("   got:  \x1b[31m%s\x1b[0m", actual);
    return;
  }
}

function exact(actual, expected) {
  try {
    wrapped(expected, () => {
      actual = actual();
      if (actual instanceof URL) actual = actual.toString();
      assert.strictEqual(actual, expected);
    });
  } catch (error) {
    console.log("❌", expected);
    if (typeof actual == "function") {
      console.log("  ", error.message);
      return;
    }
    console.log("   want: \x1b[32m%s\x1b[0m", expected);
    console.log("   got:  \x1b[31m%s\x1b[0m", actual);
    return;
  }
}

function throws(compute, label) {
  if (test) {
  }
  try {
    wrapped(label, () => {
      try {
        compute();
      } catch (error) {
        return;
      }
      throw new Error("Test failed");
    });
  } catch {
    console.log("❌", label);
  }
}

fileUrlRelTo(() => import.meta.resolve("./haha.mjs"), "./haha.mjs");
fileUrlRelTo(() => import.meta.resolve("../haha.mjs"), "../haha.mjs");
fileUrlRelTo(() => import.meta.resolve("/haha.mjs"), "/haha.mjs");
fileUrlRelTo(() => import.meta.resolve("/haha"), "/haha");
fileUrlRelTo(() => import.meta.resolve("/~"), "/~");
fileUrlRelTo(() => import.meta.resolve("./🅱️un"), "./🅱️un");

if (process.platform !== "win32") {
  exact(() => import.meta.resolve("file:///oh/haha"), "file:///oh/haha");
} else {
  exact(() => import.meta.resolve("file:///C:/oh/haha"), "file:///C:/oh/haha");
}

// will fail on deno because it is `npm:*` specifier not a file path
// fileUrlRelTo(() => import.meta.resolve("lodash"), "../../../node_modules/lodash/lodash.js");
// will fail on isolated installs
// + 'file:///src/bun/test/node_modules/.bun/lodash@4.17.21/node_modules/lodash/lodash.js'
// - 'file:///src/bun/test/node_modules/lodash/lodash.js'

exact(() => import.meta.resolve("node:path"), "node:path");
exact(() => import.meta.resolve("path"), "node:path");
exact(() => import.meta.resolve("node:doesnotexist"), "node:doesnotexist");

if (process?.versions?.bun) {
  exact(() => import.meta.resolve("bun:sqlite"), "bun:sqlite");
  exact(() => import.meta.resolve("bun:doesnotexist"), "bun:doesnotexist");
}

fileUrlRelTo(() => import.meta.resolve("./something.node"), "./something.node");

throws(() => import.meta.resolve("adsjfdasdf"), "nonexistant package");
throws(() => import.meta.resolve(""), "empty specifier");

wrapped("detached import.meta.resolve retains its module", () => {
  const { resolve } = import.meta;
  const receiver = {
    get path() {
      throw new Error("resolve must not inspect the receiver");
    },
  };
  for (const specifier of ["./missing.mjs", "./with space/🅱️un.mjs", "node:path", "path"]) {
    const expected = specifier.startsWith(".") ? new URL(specifier, import.meta.url).href : "node:path";
    assert.strictEqual(resolve(specifier), expected);
    for (const value of [undefined, null, receiver, import.meta]) {
      assert.strictEqual(resolve.call(value, specifier), expected);
      assert.strictEqual(resolve.apply(value, [specifier]), expected);
      assert.strictEqual(resolve.bind(value)(specifier), expected);
    }
  }
  assert.strictEqual(import.meta.resolve, resolve);
  assert.strictEqual(resolve.name, "resolve");
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(resolve, "name"), {
    value: "resolve",
    writable: false,
    enumerable: false,
    configurable: true,
  });
  assert.strictEqual(resolve.bind(null).name, "bound resolve");
  assert.strictEqual(resolve.length, 1);
});

wrapped("import.meta.resolve retains its origin after visible path changes", () => {
  const { resolve } = import.meta;
  const descriptor = Object.getOwnPropertyDescriptor(import.meta, "path");
  Object.defineProperty(import.meta, "path", { value: "ignored", configurable: true });
  try {
    assert.strictEqual(resolve("./missing.mjs"), new URL("./missing.mjs", import.meta.url).href);
  } finally {
    if (descriptor) Object.defineProperty(import.meta, "path", descriptor);
    else delete import.meta.path;
  }
});

wrapped("import.meta.resolve is a writable configurable data property", () => {
  const { resolve } = import.meta;
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(import.meta, "resolve"), {
    value: resolve,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  try {
    import.meta.resolve = null;
    assert.strictEqual(import.meta.resolve, null);
    assert.strictEqual(delete import.meta.resolve, true);
    assert.strictEqual(import.meta.resolve, undefined);
  } finally {
    import.meta.resolve = resolve;
  }
});
