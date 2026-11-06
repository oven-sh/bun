/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. A `test.todo` is
 * what Node.js does and Bun does not do yet.
 *
 * Node.js assigns `code` and `requireStack` to the Error of a failed require():
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L1519-L1522
 */
import assert from "node:assert";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

const require = createRequire(import.meta.url);
const file = fileURLToPath(import.meta.url);
const data = value => ({ value, writable: true, enumerable: true, configurable: true });

function thrownByRequire(specifier = "./does-not-exist") {
  try {
    require(specifier);
  } catch (error) {
    return error;
  }
  assert.fail("nothing was thrown");
}

const thrownByImport = specifier =>
  import(specifier).then(
    () => assert.fail("nothing was thrown"),
    error => error,
  );

function enumerated(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys;
}

describe("the error of a failed require()", () => {
  test("has own stack, message, code and requireStack", () => {
    const error = thrownByRequire();
    assert.ok(error instanceof Error);
    assert.deepStrictEqual(Reflect.ownKeys(error), ["stack", "message", "code", "requireStack"]);
    const { stack, message, ...enumerable } = Object.getOwnPropertyDescriptors(error);
    assert.deepStrictEqual(enumerable, { code: data("MODULE_NOT_FOUND"), requireStack: data([file]) });
    assert.deepStrictEqual(message, {
      value: `Cannot find module './does-not-exist'\nRequire stack:\n- ${file}`,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    // An accessor in V8 and a data property in JavaScriptCore: the stack of any Error of the runtime says which.
    const ofAnyError = Object.getOwnPropertyDescriptor(new Error("any"), "stack");
    assert.deepStrictEqual(
      [Object.keys(stack).sort(), stack.enumerable, stack.configurable],
      [Object.keys(ofAnyError).sort(), ofAnyError.enumerable, ofAnyError.configurable],
    );
  });

  test("is enumerated, spread and copied with code and requireStack", () => {
    const error = thrownByRequire();
    const own = { code: "MODULE_NOT_FOUND", requireStack: [file] };
    assert.deepStrictEqual(enumerated(error), ["code", "requireStack"]);
    assert.deepStrictEqual({ ...error }, own);
    assert.deepStrictEqual(Object.assign({}, error), own);
    // pino copies an error in this way, and serializes the copy.
    const copy = {};
    for (const key in error) copy[key] = error[key];
    assert.deepStrictEqual(JSON.parse(JSON.stringify(copy)), own);
  });

  test("takes what Rollup and Vite assign", () => {
    const error = thrownByRequire();
    error.code = "PLUGIN_ERROR";
    error.plugin = "a plugin";
    error.name = "Failed to load PostCSS config";
    error.message = "a message";
    error.stack = "";
    error.requireStack = [];
    assert.deepStrictEqual(
      [error.code, error.plugin, error.name, error.message, error.stack, error.requireStack],
      ["PLUGIN_ERROR", "a plugin", "Failed to load PostCSS config", "a message", "", []],
    );
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "code"), data("PLUGIN_ERROR"));
  });

  test("has a stack that Vite defines again", () => {
    const error = thrownByRequire();
    assert.strictEqual(Object.getOwnPropertyDescriptor(error, "stack").configurable, true);
    Object.defineProperty(error, "stack", { value: "a stack", enumerable: true, configurable: true, writable: true });
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "stack"), data("a stack"));
  });

  test("is printed by util.inspect() with code and requireStack", () => {
    assert.match(inspect(thrownByRequire()), /\{\n  code: 'MODULE_NOT_FOUND',\n  requireStack: \[/);
  });

  test("has no code and no requireStack after they are deleted", () => {
    const error = thrownByRequire();
    assert.ok(delete error.code && delete error.requireStack);
    assert.deepStrictEqual([error.code, error.requireStack, Object.keys(error)], [undefined, undefined, []]);
  });

  test("of a node: builtin has the code ERR_UNKNOWN_BUILTIN_MODULE and no requireStack", () => {
    const error = thrownByRequire("node:does-not-exist");
    assert.deepStrictEqual(Reflect.ownKeys(error), ["stack", "message", "code"]);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "code"), data("ERR_UNKNOWN_BUILTIN_MODULE"));
    assert.strictEqual(error.message, "No such built-in module: node:does-not-exist");
  });
});

describe("the error of a failed import()", () => {
  test("of a package has an own code and no requireStack", async () => {
    const error = await thrownByImport("package-that-does-not-exist");
    assert.ok(error instanceof Error);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "code"), data("ERR_MODULE_NOT_FOUND"));
    assert.deepStrictEqual(enumerated(error), ["code"]);
    assert.strictEqual(error.message, `Cannot find package 'package-that-does-not-exist' imported from ${file}`);
  });

  test("of a node: builtin has the code ERR_UNKNOWN_BUILTIN_MODULE", async () => {
    const error = await thrownByImport("node:does-not-exist");
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "code"), data("ERR_UNKNOWN_BUILTIN_MODULE"));
    assert.deepStrictEqual(enumerated(error), ["code"]);
  });
});

describe("what Node.js does and Bun does not do yet", () => {
  test.todo("JSON.stringify() gives the own enumerable properties", () => {
    const error = thrownByRequire();
    error.plugin = "a plugin";
    assert.deepStrictEqual(JSON.parse(JSON.stringify(error)), {
      code: "MODULE_NOT_FOUND",
      requireStack: [file],
      plugin: "a plugin",
    });
  });

  test.todo("the name is Error, and String() prints what is assigned", () => {
    const error = thrownByRequire();
    assert.strictEqual(error.name, "Error");
    error.name = "Renamed";
    error.message = "a message";
    assert.strictEqual(String(error), "Renamed: a message");
  });

  test.todo("the stack has the frames of the call", () => {
    assert.match(thrownByRequire().stack, /\n    at /);
  });

  test.todo("a property that is deleted is gone", () => {
    const error = thrownByRequire();
    assert.ok(delete error.code && delete error.message && delete error.stack);
    assert.deepStrictEqual(["code" in error, error.message, error.stack], [false, "", undefined]);
    error.code = "PLUGIN_ERROR";
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "code"), data("PLUGIN_ERROR"));
  });

  // winston assigns the level to the error that it logs.
  test.todo("a logger assigns a level", () => {
    const error = thrownByRequire();
    error.level = "error";
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(error, "level"), data("error"));
  });

  test.todo("has no line and no column", () => {
    const error = thrownByRequire();
    assert.deepStrictEqual([error.line, error.column], [undefined, undefined]);
  });

  test.todo("Error.isError() is true", () => {
    assert.strictEqual(Error.isError(thrownByRequire()), true);
  });

  test.todo("import() of a missing file has an own url, after code", async () => {
    const error = await thrownByImport("./does-not-exist.mjs");
    assert.deepStrictEqual(Reflect.ownKeys(error), ["stack", "code", "url", "message"]);
  });

  test.todo("a specifier that is too long is a module that is not found", () => {
    const specifier = "./" + Buffer.alloc(200000, "a").toString();
    const error = thrownByRequire(specifier);
    assert.deepStrictEqual(Reflect.ownKeys(error), ["stack", "message", "code", "requireStack"]);
    assert.strictEqual(error.message, `Cannot find module '${specifier}'\nRequire stack:\n- ${file}`);
  });

  test.todo("import() of a module whose static import failed makes a new error each time", async () => {
    const importer = new URL("../../bun/resolve/file-importing-nonexistent-file.js", import.meta.url).href;
    assert.notStrictEqual(await thrownByImport(importer), await thrownByImport(importer));
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  const node = nodeExeAtLeast("22.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      const proc = Bun.spawn({ cmd: [node, file], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
