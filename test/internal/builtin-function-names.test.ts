// src/codegen/bundle-functions.ts bundles the functions in src/js/builtins/*.ts.
// JSC takes `fn.name`, Function.prototype.toString() and the stack frame name of
// such a function from the name its executable is created with
// (JSC::createBuiltinExecutable), not from the property that holds it. So the
// rows below cover each way the C++ side attaches a builtin.
import { describe, expect, test } from "bun:test";
import Module from "node:module";
import { inspect } from "node:util";

describe("functions implemented in src/js/builtins", () => {
  test("are named after the exported function", () => {
    expect({
      // A HashTableValue row of type BuiltinGeneratorType (JSBuffer.cpp)
      "Buffer.prototype.toJSON": Buffer.prototype.toJSON.name,
      // JSBuiltin rows of a .lut.h table (JSBuffer.cpp, NodeModuleModule.cpp)
      "Buffer.from": Buffer.from.name,
      "Buffer.isBuffer": Buffer.isBuffer.name,
      "Module._initPaths": Module._initPaths.name,
      // `builtin: true` in a .bind.ts class (Glob.bind.ts)
      "Glob.prototype.scan": Bun.Glob.prototype.scan.name,
      "Glob.prototype.scanSync": Bun.Glob.prototype.scanSync.name,
      // JSFunction::create(vm, global, <name>CodeGenerator(vm), ...) (BunObject.cpp, BunProcess.cpp)
      "Bun.peek": Bun.peek.name,
      "process.loadEnvFile": process.loadEnvFile.name,
      // putDirectBuiltinFunction (ZigGlobalObject.cpp)
      "console.write": console.write.name,
    }).toEqual({
      "Buffer.prototype.toJSON": "toJSON",
      "Buffer.from": "from",
      "Buffer.isBuffer": "isBuffer",
      "Module._initPaths": "_initPaths",
      "Glob.prototype.scan": "scan",
      "Glob.prototype.scanSync": "scanSync",
      "Bun.peek": "peek",
      "process.loadEnvFile": "loadEnvFile",
      "console.write": "write",
    });
  });

  test("use $overriddenName when the exported name differs from the exposed one", () => {
    // UtilInspect.ts stylizeWithNoColor is the `stylize` Bun.inspect hands to inspect.custom.
    let stylizeName: string | undefined;
    Bun.inspect({
      [inspect.custom](_depth: number, options: { stylize: Function }) {
        stylizeName = options.stylize.name;
        return "";
      },
    });

    expect({
      "Bun.inspect stylize": stylizeName,
      // Peek.ts peekStatus
      "Bun.peek.status": Bun.peek.status.name,
      // ProcessObjectInternals.ts rawDebug
      "process._rawDebug": process._rawDebug.name,
      // CommonJS.ts overridableRequire
      "Module.prototype.require": Module.prototype.require.name,
      // CommonJS.ts requireResolve. `require.resolve` itself is a bound function that
      // JSCommonJSModule.cpp names "resolve", so its name is "bound resolve" either way.
      "Object.getPrototypeOf(require).resolve": Object.getPrototypeOf(require).resolve.name,
      // ConsoleObject.ts asyncIterator
      "console[Symbol.asyncIterator]": console[Symbol.asyncIterator].name,
      // JSBufferPrototype.ts offset, a $getter
      "get Buffer.prototype.offset": Object.getOwnPropertyDescriptor(Buffer.prototype, "offset")!.get!.name,
    }).toEqual({
      "Bun.inspect stylize": "stylizeNoColor",
      "Bun.peek.status": "status",
      "process._rawDebug": "_rawDebug",
      "Module.prototype.require": "require",
      "Object.getPrototypeOf(require).resolve": "resolve",
      "console[Symbol.asyncIterator]": "[Symbol.asyncIterator]",
      "get Buffer.prototype.offset": "get offset",
    });
  });

  test("carry the name into toString(), inspect and stack frames", () => {
    expect(Buffer.from.toString()).toBe("function from() { [native code] }");
    expect(Bun.inspect(Bun.Glob.prototype.scanSync)).toBe("[Function: scanSync]");

    // Buffer.from rejects a number from inside the builtin, so its frame is in the stack.
    let error: Error | undefined;
    try {
      Buffer.from(1 as unknown as string);
    } catch (e) {
      error = e as Error;
    }
    expect(error!.stack).toContain("at from (");
  });
});
