// Guard for the names src/codegen/bundle-functions.ts gives the functions
// bundled from src/js/builtins/*.ts. The generated <File>BuiltinsWrapper passes
// the exported function's name (or its $overriddenName) to
// JSC::createBuiltinExecutable, and JSC reports that name as `fn.name`, in
// Function.prototype.toString() and in stack frames. This holds no matter how
// the C++ side attaches the function, so every attachment path is listed here.
// When the wrapper leaves the name identifier uninitialized, every function
// without an $overriddenName gets name === "".
import { describe, expect, test } from "bun:test";
import Module from "node:module";
import { inspect } from "node:util";

describe("functions implemented in src/js/builtins", () => {
  test("are named after the exported function", () => {
    expect({
      // HashTableValue rows of type BuiltinGeneratorType (JSBuffer.cpp)
      "Buffer.prototype.readInt8": Buffer.prototype.readInt8.name,
      "Buffer.prototype.writeUInt32LE": Buffer.prototype.writeUInt32LE.name,
      "Buffer.prototype.toJSON": Buffer.prototype.toJSON.name,
      // An alias row reuses the executable of the function it points at.
      "Buffer.prototype.readInt16": Buffer.prototype.readInt16.name,
      // JSBuiltin rows of a .lut.h table (jsBufferConstructorTable)
      "Buffer.from": Buffer.from.name,
      "Buffer.isBuffer": Buffer.isBuffer.name,
      // `builtin:` in a .classes.ts file (Glob.classes.ts)
      "Glob.prototype.scan": Bun.Glob.prototype.scan.name,
      "Glob.prototype.scanSync": Bun.Glob.prototype.scanSync.name,
      // JSFunction::create(vm, global, <name>CodeGenerator(vm), ...) (BunObject.cpp, BunProcess.cpp)
      "Bun.peek": Bun.peek.name,
      "process.loadEnvFile": process.loadEnvFile.name,
      // putDirectBuiltinFunction (ZigGlobalObject.cpp)
      "console.write": console.write.name,
    }).toEqual({
      "Buffer.prototype.readInt8": "readInt8",
      "Buffer.prototype.writeUInt32LE": "writeUInt32LE",
      "Buffer.prototype.toJSON": "toJSON",
      "Buffer.prototype.readInt16": "readInt16LE",
      "Buffer.from": "from",
      "Buffer.isBuffer": "isBuffer",
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
    expect(Buffer.from.toString()).toBe("function from() {\n    [native code]\n}");
    expect(Bun.inspect(Bun.Glob.prototype.scanSync)).toBe("[Function: scanSync]");

    let error: Error | undefined;
    try {
      Buffer.alloc(1).readInt8(5);
    } catch (e) {
      error = e as Error;
    }
    expect(error!.stack).toContain("at readInt8 (");
  });
});
