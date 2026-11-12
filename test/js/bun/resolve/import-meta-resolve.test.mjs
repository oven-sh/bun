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

// `import.meta.resolve` belongs to the module whose `import.meta` it was read from. It never looks at `this`.
// https://html.spec.whatwg.org/multipage/webappapis.html#hostgetimportmetaproperties
const relativeToThisFile = specifier => new URL(specifier, import.meta.url).href;

wrapped("import.meta.resolve works without its import.meta", () => {
  const { resolve } = import.meta;
  assert.strictEqual(resolve("./haha.mjs"), relativeToThisFile("./haha.mjs"));
  assert.deepStrictEqual(["./haha.mjs", "../haha.mjs", "node:path"].map(import.meta.resolve), [
    relativeToThisFile("./haha.mjs"),
    relativeToThisFile("../haha.mjs"),
    "node:path",
  ]);

  const readsNothing = new Proxy(
    {},
    {
      get(_, name) {
        throw new Error(`import.meta.resolve read ${String(name)} of its receiver`);
      },
    },
  );
  for (const receiver of [undefined, null, 1, "/elsewhere/file.mjs", { path: "/elsewhere/file.mjs" }, readsNothing]) {
    assert.strictEqual(resolve.call(receiver, "./haha.mjs"), relativeToThisFile("./haha.mjs"));
    assert.strictEqual(Reflect.apply(resolve, receiver, ["./haha.mjs"]), relativeToThisFile("./haha.mjs"));
    assert.strictEqual(resolve.bind(receiver)("./haha.mjs"), relativeToThisFile("./haha.mjs"));
  }
});

wrapped("import.meta.resolve does not read a variable named path where it is called", () => {
  // JavaScriptCore hands a native function the scope object as `this` when the function is called through a closure variable.
  const path = ["", "elsewhere", "file.mjs"].join("/");
  const { resolve } = import.meta;
  const call = specifier => [resolve(specifier), path];
  assert.deepStrictEqual(call("./haha.mjs"), [relativeToThisFile("./haha.mjs"), "/elsewhere/file.mjs"]);
});

wrapped("import.meta.resolve can be replaced, and the function works without the property", () => {
  const { resolve } = import.meta;
  assert.strictEqual(typeof resolve, "function");
  assert.strictEqual(resolve.name, "resolve");
  assert.strictEqual(import.meta.resolve, resolve);
  try {
    import.meta.resolve = null;
    assert.strictEqual(import.meta.resolve, null);
    assert.strictEqual(delete import.meta.resolve, true);
    assert.strictEqual(resolve("./haha.mjs"), relativeToThisFile("./haha.mjs"));
  } finally {
    if (import.meta.resolve !== resolve) import.meta.resolve = resolve;
  }
});

if (process?.versions?.bun) {
  wrapped("import.meta.resolve has length 1 and is not a constructor", () => {
    const { resolve } = import.meta;
    assert.strictEqual(resolve.length, 1);
    assert.throws(() => new resolve("./haha.mjs"), TypeError);
  });

  wrapped("import.meta.resolve takes a parent argument without its import.meta", () => {
    const { resolve } = import.meta;
    const parent = Bun.fileURLToPath(relativeToThisFile("./fixtures/parent.mjs"));
    assert.strictEqual(resolve("./haha.mjs", parent), relativeToThisFile("./fixtures/haha.mjs"));
    assert.strictEqual(resolve("./haha.mjs", { paths: [parent] }), relativeToThisFile("./fixtures/haha.mjs"));
    for (const noParent of [undefined, null]) {
      assert.strictEqual(resolve("./haha.mjs", noParent), relativeToThisFile("./haha.mjs"));
    }
  });

  wrapped("import.meta.resolve does not read the path property of its import.meta", () => {
    const { resolve } = import.meta;
    Object.defineProperty(import.meta, "path", { value: "/elsewhere/file.mjs", configurable: true });
    try {
      assert.strictEqual(resolve("./haha.mjs"), relativeToThisFile("./haha.mjs"));
      assert.strictEqual(import.meta.resolve("./haha.mjs"), relativeToThisFile("./haha.mjs"));
      assert.strictEqual(import.meta.resolveSync("./import-meta-resolve.test.mjs"), import.meta.filename);
    } finally {
      delete import.meta.path;
    }
  });

  wrapped("import.meta.resolveSync works without its import.meta", () => {
    const { resolveSync } = import.meta;
    const thisFile = import.meta.path;
    assert.strictEqual(resolveSync("./import-meta-resolve.test.mjs"), thisFile);
    for (const receiver of [undefined, null, "/elsewhere/file.mjs", { path: "/elsewhere/file.mjs" }]) {
      assert.strictEqual(resolveSync.call(receiver, "./import-meta-resolve.test.mjs"), thisFile);
    }

    const path = ["", "elsewhere", "file.mjs"].join("/");
    const call = specifier => [resolveSync(specifier), path];
    assert.deepStrictEqual(call("./import-meta-resolve.test.mjs"), [thisFile, "/elsewhere/file.mjs"]);

    assert.strictEqual(resolveSync.name, "resolveSync");
    assert.strictEqual(resolveSync.length, 1);
    assert.strictEqual(import.meta.resolveSync, resolveSync);
  });

  wrapped("import.meta.resolveSync resolves from its module when it is given no parent", () => {
    const thisFile = import.meta.path;
    assert.strictEqual(import.meta.resolveSync("./import-meta-resolve.test.mjs", undefined), thisFile);
    assert.strictEqual(import.meta.resolveSync("./import-meta-resolve.test.mjs", null), thisFile);
    // A boolean there says whether to resolve as an import. It is no parent.
    assert.strictEqual(import.meta.resolveSync("./import-meta-resolve.test.mjs", true), thisFile);
    assert.strictEqual(import.meta.resolveSync("./import-meta-resolve.test.mjs", undefined, true), thisFile);
    const parent = Bun.fileURLToPath(relativeToThisFile("./fixtures/parent.mjs"));
    assert.strictEqual(import.meta.resolveSync("../import-meta-resolve.test.mjs", parent), thisFile);
  });
}
