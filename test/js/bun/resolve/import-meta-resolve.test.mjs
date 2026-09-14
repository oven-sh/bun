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

  // A relative specifier is percent-encoded into a URL, which can be longer than a string can be (2 ** 31 - 1
  // characters). That returned "". U+00E9 is one character and "%C3%A9" is six, and 1 MiB stands in for 2 ** 31 - 1.
  const { setSyntheticAllocationLimitForTesting } = await import("bun:internal-for-testing");
  wrapped("a specifier whose URL does not fit in a string", () => {
    const specifier = "./" + Buffer.alloc(176_000, 0xe9).toString("latin1");
    const previous = setSyntheticAllocationLimitForTesting(1024 * 1024);
    try {
      assert.throws(() => import.meta.resolve(specifier), { name: "RangeError", message: "Out of memory" });
    } finally {
      setSyntheticAllocationLimitForTesting(previous);
    }
  });
}

fileUrlRelTo(() => import.meta.resolve("./something.node"), "./something.node");

throws(() => import.meta.resolve("adsjfdasdf"), "nonexistant package");
throws(() => import.meta.resolve(""), "empty specifier");
