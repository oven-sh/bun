import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, normalizeBunSnapshot, tempDir } from "harness";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { inspect } from "node:util";

describe("ResolveMessage", () => {
  it("carries what the resolver logged while failing as notes", async () => {
    // The resolver records the reason it gave up (here: the dependency's
    // package.json does not parse) in the log of the failing resolve. That
    // used to be discarded, leaving a bare "Cannot find package".
    using dir = tempDir("resolve-error-notes", {
      "index.js": `import "badjson";\n`,
      "node_modules/badjson/package.json": `{ "name": "badjson", "main":\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: Cannot find package 'badjson' from '<dir>/index.js'

      1 | { "name": "badjson", "main":
                                      ^
      note: Unexpected end of file
         at <dir>/node_modules/badjson/package.json:1:29

      Bun v<bun-version>"
    `);
    expect(exitCode).toBe(1);
  });

  it("position object does not segfault", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(Bun.inspect(e.position).length > 0).toBe(true);
      expect(e.column).toBeGreaterThanOrEqual(0);
      expect(e.line).toBeGreaterThanOrEqual(0);
    }
  });

  it(".message is modifiable", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      const orig = e.message;
      expect(() => (e.message = "new message")).not.toThrow();
      expect(e.message).toBe("new message");
      expect(e.message).not.toBe(orig);
    }
  });

  it("has code for esm", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
    }
  });

  it("has code for require.resolve", () => {
    try {
      require.resolve("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("has code for require", () => {
    try {
      require("./file-importing-nonexistent-file.cjs");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("preserves non-ASCII specifier in .message and .specifier (import)", async () => {
    const spec = "./caf\u00e9-missing-\u{1F389}";
    let err: any;
    try {
      await import(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe("ResolveMessage");
    expect(err.specifier).toBe(spec);
    expect(err.message).toContain(spec);
    expect(String(err)).toContain(spec);
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({ specifier: spec });
  });

  it("preserves non-ASCII specifier in .message and .specifier (require node:)", () => {
    const spec = "node:sql\u0131te"; // dotless i U+0131
    let err: any;
    try {
      require(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
    expect(err.specifier).toBe(spec);
    expect(err.message).toBe(`No such built-in module: ${spec}`);
  });

  it("preserves non-ASCII referrer in .referrer and .message", () => {
    const referrer = "/tmp/caf\u00e9-tr\u00e8s-\u{1F389}/file.js";
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", referrer);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.referrer).toBe(referrer);
    expect(err.message).toContain(referrer);
  });

  it("preserves non-ASCII in position.lineText and position.file", async () => {
    const lineText = `const caf\u00e9 = 1; import "./na\u00efve-missing.js"; // \u{1F389}`;
    const fileName = "entry-caf\u00e9-\u{1F389}.js";
    using dir = tempDir("resolve-position-utf8", {
      [fileName]: lineText + "\n",
    });
    const result = await Bun.build({ entrypoints: [path.join(String(dir), fileName)], throw: false });
    expect(result.success).toBe(false);
    const log: any = result.logs.find(l => l.name === "ResolveMessage");
    expect(log).toBeDefined();
    expect(log.position.lineText).toBe(lineText);
    expect(path.basename(log.position.file)).toBe(fileName);
    expect(log.specifier).toBe("./na\u00efve-missing.js");
  });

  it("invalid data URL import", async () => {
    expect(async () => {
      // @ts-ignore
      await import("data:Hello%2C%20World!");
    }).toThrow("Cannot resolve invalid data URL");
  });

  it("doesn't crash", async () => {
    expect(async () => {
      // @ts-ignore
      await import(":://filesystem");
    }).toThrow("Cannot find package '::'");
  });

  it("referrer is not freed before it is read", () => {
    // Non-ASCII in the source path forces resolveMaybeNeedsTrailingSlash to
    // allocate a new UTF-8 buffer which is freed on return. ResolveMessage
    // used to borrow that buffer for .referrer, causing a use-after-free
    // when the property was read later.
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", "/tmp/caf\u00e9-tr\u00e8s-long-\u{1F389}/file.js");
    } catch (e) {
      err = e;
    }
    Bun.gc(true);
    expect(err.referrer).toStartWith("/tmp/caf");
    expect(err.referrer).toEndWith("/file.js");
  });

  it("finalize frees with the same allocator it was created with", () => {
    // ResolveMessage.create() clones the message with the VM's arena
    // allocator but finalize() was freeing it with bun.default_allocator
    // and never destroying the struct itself. Under ASAN with mimalloc's
    // per-heap tracking this surfaced as a flaky use-after-poison in the
    // resolver after many failed require()s + GCs in a long-running
    // process (Fuzzilli REPRL). Use relative specifiers so auto-install
    // does not kick in.
    for (let i = 0; i < 50; i++) {
      let errs: any[] = [];
      for (let j = 0; j < 10; j++) {
        try {
          Bun.resolveSync("./does-not-exist-" + j, import.meta.dir);
        } catch (e) {
          errs.push(e);
        }
      }
      for (const e of errs) {
        void e.message;
        void e.code;
        void e.specifier;
        void e.referrer;
        void e.level;
        void e.importKind;
        void e.position;
        void String(e);
      }
      errs = [];
      Bun.gc(true);
    }
    expect().pass();
  });
});

// The error of a failed require() or import() is a ResolveMessage. `stack`, `message` and `code` are own properties of
// it, as they are of the Error that Node.js throws, and so is `requireStack` of a CommonJS "Cannot find module".
describe("own properties of a thrown ResolveMessage", () => {
  const require = createRequire(import.meta.url);
  const data = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });
  const hidden = (value: unknown) => ({ value, writable: true, enumerable: false, configurable: true });
  const message = `Cannot find module './does-not-exist'\nRequire stack:\n- ${import.meta.path}`;
  const commonjs = { code: data("MODULE_NOT_FOUND"), requireStack: data([import.meta.path]) };
  const esm = { code: data("ERR_MODULE_NOT_FOUND") };
  const builtin = { code: data("ERR_UNKNOWN_BUILTIN_MODULE") };
  const missing = { file: "./does-not-exist", package: "package-that-does-not-exist", builtin: "node:does-not-exist" };
  // Longer than the resolver looks for: it fails with ENAMETOOLONG.
  const tooLong = "./" + Buffer.alloc(MAX_PATH_BYTES * 2, "a").toString();
  const resolveFilename: (request: string, ...rest: unknown[]) => string = (Module as any)._resolveFilename;

  async function thrownBy(load: () => unknown): Promise<any> {
    try {
      await load();
    } catch (error) {
      return error;
    }
    throw new Error("nothing was thrown");
  }

  // The stack has the message in it. What else it has is not a subject of these tests.
  const stackWith = (message: string) => expect.stringContaining(message);

  function expectOwnProperties(error: any, message: string, enumerable: object) {
    expect(error).toBeInstanceOf(ResolveMessage);
    expect(Object.getOwnPropertyDescriptors(error)).toEqual({
      stack: hidden(stackWith(message)),
      message: hidden(message),
      ...enumerable,
    });
    expect(Reflect.ownKeys(error)).toEqual(["stack", "message", ...Object.keys(enumerable)]);
  }

  const notFound = (specifier: string) => `Cannot find module '${specifier}'\nRequire stack:\n- ${import.meta.path}`;
  const noBuiltin = "No such built-in module: node:does-not-exist";
  const nameTooLong = `ENAMETOOLONG while resolving '${tooLong}' from '${import.meta.path}'`;
  const noPackage = `Cannot find package 'package-that-does-not-exist' imported from ${import.meta.path}`;
  const notImported = (from: string) => `Cannot find module './does-not-exist' imported from ${from}`;

  it.each<[string, () => unknown, string, object]>([
    ["require()", () => require(missing.file), message, commonjs],
    ["require() of a package", () => require(missing.package), notFound(missing.package), commonjs],
    ["require() of a node: builtin", () => require(missing.builtin), noBuiltin, builtin],
    // Not as in Node.js, which has "Cannot find module" and a requireStack here.
    ["require() of a specifier that is too long", () => require(tooLong), nameTooLong, { code: commonjs.code }],
    ["require.resolve()", () => require.resolve("./does-not-exist"), message, commonjs],
    [
      "require.resolve() with paths",
      () => require.resolve("./does-not-exist", { paths: [import.meta.dir] }),
      message,
      commonjs,
    ],
    [
      "Module._resolveFilename()",
      () => resolveFilename("./does-not-exist", { filename: import.meta.path }),
      message,
      commonjs,
    ],
    ["import.meta.require()", () => import.meta.require("./does-not-exist"), message, commonjs],
    ["import()", () => import(missing.file), notImported(import.meta.path), esm],
    ["import() of a package", () => import(missing.package), noPackage, esm],
    ["import() of a node: builtin", () => import(missing.builtin), noBuiltin, builtin],
    ["import() of a specifier that is too long", () => import(tooLong), nameTooLong, esm],
    ["import.meta.resolve()", () => import.meta.resolve("package-that-does-not-exist"), noPackage, esm],
    [
      "import.meta.resolveSync()",
      () => import.meta.resolveSync("./does-not-exist"),
      notImported(import.meta.path),
      esm,
    ],
    [
      "Bun.resolveSync()",
      () => Bun.resolveSync("./does-not-exist", import.meta.dir),
      notImported(import.meta.dir),
      esm,
    ],
    ["Bun.resolve()", () => Bun.resolve("./does-not-exist", import.meta.dir), notImported(import.meta.dir), esm],
  ])("%s", async (_, load, message, enumerable) => {
    expectOwnProperties(await thrownBy(load), message, enumerable);
  });

  // There is no file to list, and the message has no "Require stack:" line.
  it.each<[string, unknown[]]>([
    ["no parent", []],
    ["a null parent", [null]],
    ["a null parent and paths", [null, false, { paths: [import.meta.dir] }]],
  ])("Module._resolveFilename() with %s has an empty requireStack", async (_, rest) => {
    const error = await thrownBy(() => resolveFilename("./does-not-exist", ...rest));
    expectOwnProperties(error, "Cannot find module './does-not-exist'", {
      code: commonjs.code,
      requireStack: data([]),
    });
  });

  // Node.js has ERR_PACKAGE_PATH_NOT_EXPORTED here, and no requireStack.
  it("require() of a subpath that a package does not export", async () => {
    using dir = tempDir("resolve-error-exports", {
      "node_modules/has-exports/package.json": `{ "name": "has-exports", "exports": { ".": "./index.js" } }`,
      "node_modules/has-exports/index.js": "",
      "node_modules/has-exports/not-exported.js": "",
      "index.js": "",
    });
    const importer = path.join(String(dir), "index.js");
    const error = await thrownBy(() => createRequire(importer)("has-exports/not-exported.js"));
    expectOwnProperties(error, `Cannot find module 'has-exports/not-exported.js'\nRequire stack:\n- ${importer}`, {
      code: commonjs.code,
      requireStack: data([importer]),
    });
  });

  it("a static import", async () => {
    using dir = tempDir("resolve-error-static-import", { "entry.mjs": `import "./does-not-exist.mjs";` });
    const entry = path.join(String(dir), "entry.mjs");
    const error = await thrownBy(() => import(entry));
    expectOwnProperties(error, `Cannot find module './does-not-exist.mjs' imported from ${entry}`, esm);
  });

  // Not as in Node.js, which makes a new error for each import(). The module loader keeps the error of a module whose
  // static import failed, so the next import() of that module reads what the first catcher assigned.
  it("a static import that failed gives the same error to the next import()", async () => {
    using dir = tempDir("resolve-error-again", { "entry.mjs": `import "./does-not-exist.mjs";` });
    const entry = path.join(String(dir), "entry.mjs");
    const first = await thrownBy(() => import(entry));
    first.code = "PLUGIN_ERROR";
    const second = await thrownBy(() => import(entry));
    expect(second).toBe(first);
    expect(second.code).toBe("PLUGIN_ERROR");
  });

  // This one is found when the required module is transpiled, before anything resolves its imports.
  it("a static import of a missing node: builtin in a module that is required", async () => {
    using dir = tempDir("resolve-error-transpile", { "entry.mjs": `import "node:does-not-exist";` });
    const error = await thrownBy(() => require(path.join(String(dir), "entry.mjs")));
    expectOwnProperties(error, `Could not resolve: "node:does-not-exist". Maybe you need to "bun install"?`, builtin);
  });

  // A property gets its value when it is first read. JavaScript cannot tell: it is a data property before and after.
  describe.each(["before it is read", "after it is read"])("%s", when => {
    async function thrown() {
      const error = await thrownBy(() => require("./does-not-exist"));
      if (when === "after it is read") void [error.stack, error.message, error.code, error.requireStack];
      return error;
    }

    it("is assigned", async () => {
      const error = await thrown();
      error.stack = "a stack";
      error.message = "a message";
      error.code = "E_WRAPPED";
      error.requireStack = [];
      expect(Object.getOwnPropertyDescriptors(error)).toEqual({
        stack: hidden("a stack"),
        message: hidden("a message"),
        code: data("E_WRAPPED"),
        requireStack: data([]),
      });
    });

    // Not as in Node.js: ResolveMessage.prototype has accessors for `stack`, `message` and `code`, which then answer.
    it("is deleted", async () => {
      const error = await thrown();
      for (const key of ["stack", "message", "code", "requireStack"]) expect(delete error[key]).toBe(true);
      const read = () => ({
        stack: error.stack,
        message: error.message,
        code: error.code,
        requireStack: error.requireStack,
        keys: Reflect.ownKeys(error),
      });
      expect(read()).toEqual({
        stack: stackWith(message),
        message,
        code: undefined,
        requireStack: undefined,
        keys: [],
      });
      error.stack = "a stack";
      error.message = "a message";
      error.requireStack = [];
      expect(() => {
        error.code = "E_WRAPPED";
      }).toThrow(TypeError);
      expect(read()).toEqual({
        stack: "a stack",
        message: "a message",
        code: undefined,
        requireStack: [],
        keys: ["requireStack"],
      });
    });

    it("is frozen", async () => {
      const error = Object.freeze(await thrown());
      expect(() => {
        error.code = "E_WRAPPED";
      }).toThrow(TypeError);
      const frozen = (value: unknown, enumerable: boolean) => ({
        value,
        writable: false,
        enumerable,
        configurable: false,
      });
      expect(Object.getOwnPropertyDescriptors(error)).toEqual({
        stack: frozen(stackWith(message), false),
        message: frozen(message, false),
        code: frozen("MODULE_NOT_FOUND", true),
        requireStack: frozen([import.meta.path], true),
      });
      expect(error.requireStack).toBe(error.requireStack);
    });

    // Vite does this to the error of a module that fails to load (ssrFixStacktrace).
    it("has a stack that is defined again", async () => {
      const error = await thrown();
      expect(Object.getOwnPropertyDescriptor(error, "stack")).toEqual(hidden(stackWith(message)));
      Object.defineProperty(error, "stack", { value: "a stack", enumerable: true, configurable: true, writable: true });
      expect(Object.getOwnPropertyDescriptor(error, "stack")).toEqual(data("a stack"));
    });

    it("is assigned on an object that is not extensible", async () => {
      const error = Object.preventExtensions(await thrown());
      error.code = "E_WRAPPED";
      expect(Object.getOwnPropertyDescriptor(error, "code")).toEqual(data("E_WRAPPED"));
    });

    it("is not assigned through another receiver", async () => {
      const error = await thrown();
      const receiver: any = {};
      expect(Reflect.set(error, "code", "E_WRAPPED", receiver)).toBe(true);
      const child = Object.create(error);
      child.code = "E_CHILD";
      expect({ receiver, child: { ...child }, code: error.code }).toEqual({
        receiver: { code: "E_WRAPPED" },
        child: { code: "E_CHILD" },
        code: "MODULE_NOT_FOUND",
      });
    });

    // toJSON() is native code that reads `code` and `requireStack`. Here nothing has read them before.
    it("is serialized first", async () => {
      const error = await thrown();
      expect(JSON.parse(JSON.stringify(error))).toEqual({
        name: "ResolveMessage",
        position: null,
        message,
        level: "error",
        specifier: "./does-not-exist",
        importKind: "require-call",
        referrer: import.meta.path,
        code: "MODULE_NOT_FOUND",
        requireStack: [import.meta.path],
      });
      expectOwnProperties(error, message, commonjs);
    });

    it("is read through another receiver", async () => {
      const error = await thrown();
      const read = (object: any) => [object.stack, object.message, object.code, object.requireStack];
      const values = [stackWith(message), message, "MODULE_NOT_FOUND", [import.meta.path]];
      const child = Object.create(error);
      expect({
        child: read(child),
        proxy: read(new Proxy(error, {})),
        reflected: Reflect.get(error, "requireStack", {}),
        keys: Reflect.ownKeys(child),
      }).toEqual({ child: values, proxy: values, reflected: [import.meta.path], keys: [] });
    });

    it("has one array as requireStack", async () => {
      const error = await thrown();
      const requireStack = error.requireStack;
      requireStack.push("another");
      expect(error.requireStack).toBe(requireStack);
      expect(error.requireStack).toEqual([import.meta.path, "another"]);
    });

    it("is copied and serialized", async () => {
      const error = await thrown();
      const own = { code: "MODULE_NOT_FOUND", requireStack: [import.meta.path] };
      expect({ ...error }).toEqual(own);
      expect(Object.assign({}, error)).toEqual(own);
      expect(Object.entries(error)).toEqual(Object.entries(own));
      // pino copies an error in this way, and serializes the copy.
      const copy: Record<string, unknown> = {};
      for (const key in error) copy[key] = error[key];
      expect(JSON.parse(JSON.stringify(copy))).toEqual(own);
      expect(JSON.stringify(error)).toBe(
        JSON.stringify({
          name: "ResolveMessage",
          position: null,
          message,
          level: "error",
          specifier: "./does-not-exist",
          importKind: "require-call",
          referrer: import.meta.path,
          ...own,
        }),
      );
      // toJSON() gives the `code` and the `requireStack` that are there now. Rollup assigns the code of an error that a
      // plugin throws. Another property that is assigned is not serialized, and `message` is the one of the resolver.
      error.code = "PLUGIN_ERROR";
      error.plugin = "a plugin";
      error.message = "a message";
      delete error.requireStack;
      expect(JSON.parse(JSON.stringify(error))).toEqual({
        name: "ResolveMessage",
        position: null,
        message,
        level: "error",
        specifier: "./does-not-exist",
        importKind: "require-call",
        referrer: import.meta.path,
        code: "PLUGIN_ERROR",
      });
    });
  });

  it.each<[string, () => unknown, string[]]>([
    ["require()", () => require(missing.file), ["code", "requireStack"]],
    ["import()", () => import(missing.package), ["code"]],
  ])("for...in over what %s throws gives the keys that Node.js gives", async (_, load, keys) => {
    const enumerated: string[] = [];
    for (const key in await thrownBy(load)) enumerated.push(key);
    expect(enumerated).toEqual(keys);
  });

  it("util.inspect() prints the code", async () => {
    expect(inspect(await thrownBy(() => require(missing.builtin)))).toBe(
      "[ResolveMessage: No such built-in module: node:does-not-exist] {\n  code: 'ERR_UNKNOWN_BUILTIN_MODULE'\n}",
    );
  });

  it("is not equal to an error with another code", async () => {
    const error = await thrownBy(() => import(missing.package));
    expect(error).toEqual(await thrownBy(() => import(missing.package)));
    expect(error).not.toEqual(await thrownBy(() => import(missing.builtin)));
  });

  // Vite does this to the error of a PostCSS config that fails to load (resolvePostcssConfig).
  describe.each(["ResolveMessage", "BuildMessage"])("a thrown %s", kind => {
    async function thrown() {
      using dir = tempDir("resolve-error-name", { "syntax-error.cjs": "module.exports = ;" });
      const specifier = kind === "ResolveMessage" ? missing.file : path.join(String(dir), "syntax-error.cjs");
      const error = await thrownBy(() => require(specifier));
      expect(error.constructor.name).toBe(kind);
      return error;
    }

    it("takes a name, a message and a stack", async () => {
      const error = await thrown();
      const { name, message, stack } = error;
      error.name = "Failed to load PostCSS config";
      error.message = `Failed to load PostCSS config: [${name}] ${message}\n${stack}`;
      error.stack = "";
      expect({ name: error.name, message: error.message, stack: error.stack }).toEqual({
        name: "Failed to load PostCSS config",
        message: `Failed to load PostCSS config: [${kind}] ${message}\n${stack}`,
        stack: "",
      });
    });

    it("has the name of its class as Error.prototype has its name", async () => {
      const prototype = Object.getPrototypeOf(await thrown());
      expect(Object.getOwnPropertyDescriptor(prototype, "name")).toEqual({
        ...Object.getOwnPropertyDescriptor(Error.prototype, "name"),
        value: kind,
      });
      expect(Object.keys(prototype)).toEqual([]);
    });
  });

  // What fails while a module is transpiled is thrown as one AggregateError when it is more than one message.
  it.each<[string, string, (file: string) => unknown, string[]]>([
    [
      "needs-macro.ts",
      `import { nope } from "./does-not-exist" with { type: "macro" };\nexport const value = nope();`,
      file => import(file),
      ["ResolveMessage", "BuildMessage"],
    ],
    [
      "preserve.jsx",
      `// @jsxRuntime preserve\nimport "node:does-not-exist";\nexport default <div />;`,
      file => require(file),
      ["BuildMessage", "ResolveMessage"],
    ],
  ])("each ResolveMessage of the AggregateError for %s", async (name, source, load, kinds) => {
    using dir = tempDir("resolve-error-aggregate", { [name]: source });
    const error = await thrownBy(() => load(path.join(String(dir), name)));
    expect(error).toBeInstanceOf(AggregateError);
    const shapes = {
      ResolveMessage: [
        ["stack", "message", "code"],
        ["name", "position", "message", "level", "specifier", "importKind", "referrer", "code"],
      ],
      BuildMessage: [[], ["name", "position", "message", "level"]],
    };
    expect(
      error.errors.map((error: any) => [error.constructor.name, Reflect.ownKeys(error), Object.keys(error.toJSON())]),
    ).toEqual(kinds.map(kind => [kind, ...shapes[kind as keyof typeof shapes]]));
  });

  // Plugins are for the whole process.
  it("a plugin's answer that does not exist, and what is not thrown", async () => {
    using dir = tempDir("resolve-error-plugin", {
      "package.json": `{ "name": "resolve-error-plugin" }`,
      "node_modules/.keep": "",
      "plugin-fixture.mjs": `
        import { heapStats } from "bun:jsc";
        import { mock } from "bun:test";
        import Module, { createRequire } from "node:module";
        import path from "node:path";
        import { pathToFileURL } from "node:url";

        const require = createRequire(import.meta.url);
        const nowhere = path.join(import.meta.dir, "nowhere.js");
        const directories = ["a", "b", "c"].map(name => path.join(import.meta.dir, name));

        // The first heapStats() of a process collects, so it is before what is counted.
        const count = () => heapStats().objectTypeCounts.ResolveMessage ?? 0;
        async function made(run) {
          const before = count();
          await run();
          return count() - before;
        }

        // Nothing is thrown for what these do not find, so no ResolveMessage is made.
        const byFindPath = await made(() => Module._findPath("package-that-does-not-exist", directories));
        const byMock = await made(() => mock.module("package-that-does-not-exist", () => ({})));

        Bun.plugin({
          name: "fixture",
          setup(build) {
            build.onResolve({ filter: /redirected/ }, () => ({ path: nowhere }));
            build.onResolve({ filter: /^\\.\\/invalid$/ }, () => ({ path: 1 }));
            build.onResolve({ filter: /^virtual\\.js$/ }, ({ path }) => ({ path }));
            build.onLoad({ filter: /^virtual\\.js$/ }, () => ({ exports: { default: 1 }, loader: "object" }));
          },
        });
        const byOnLoad = await made(() => import("virtual.js"));

        async function thrownBy(load) {
          try {
            await load();
          } catch (error) {
            if (!(error instanceof ResolveMessage)) return [error.constructor.name, error.message];
            return [Reflect.ownKeys(error), Object.getOwnPropertyDescriptor(error, "code")];
          }
        }
        console.log(
          JSON.stringify({
            byFindPath,
            byMock,
            byOnLoad,
            "import.meta.resolve()": await thrownBy(() => import.meta.resolve("./redirected")),
            "import.meta.resolve() of a URL": await thrownBy(() =>
              import.meta.resolve(pathToFileURL(path.join(import.meta.dir, "redirected.js")).href),
            ),
            "import()": await thrownBy(() => import("./redirected")),
            "require()": await thrownBy(() => require("./redirected")),
            "an answer that is not valid": await thrownBy(() => import("./invalid")),
          }),
        );
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "plugin-fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const esmError = [["stack", "message", "code"], esm.code];
    expect({ stdout: stdout && JSON.parse(stdout), stderr }).toEqual({
      stdout: {
        byFindPath: 0,
        byMock: 0,
        byOnLoad: 0,
        "import.meta.resolve()": esmError,
        "import.meta.resolve() of a URL": esmError,
        "import()": esmError,
        "require()": [["stack", "message", "code", "requireStack"], data("MODULE_NOT_FOUND")],
        "an answer that is not valid": ["Error", 'Expected "path" to be a string in onResolve plugin'],
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  it("a ResolveMessage that Bun.Transpiler throws has none", () => {
    const source = `import { nope } from "./does-not-exist" with { type: "macro" };\nexport const value = nope();`;
    let failure: any;
    try {
      new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    const log = failure.errors.find((error: unknown) => error instanceof ResolveMessage);
    expect({ code: log.code, keys: Reflect.ownKeys(log) }).toEqual({ code: "ERR_MODULE_NOT_FOUND", keys: [] });
    expect(() => {
      log.code = "E_WRAPPED";
    }).toThrow(TypeError);
  });

  it.each(["a log", "an error of the rejection"])("%s of Bun.build() has none", async which => {
    using dir = tempDir("resolve-error-build-log", { "entry.js": `import "./does-not-exist";` });
    const entrypoints = [path.join(String(dir), "entry.js")];
    const logs =
      which === "a log"
        ? (await Bun.build({ entrypoints, throw: false })).logs
        : (await thrownBy(() => Bun.build({ entrypoints, throw: true }))).errors;
    expect(logs).toHaveLength(1);
    const log: any = logs[0];
    expect(log).toBeInstanceOf(ResolveMessage);
    const enumerated: string[] = [];
    for (const key in log) enumerated.push(key);
    expect({ code: log.code, keys: Reflect.ownKeys(log), enumerated, json: Object.keys(log.toJSON()) }).toEqual({
      code: "ERR_MODULE_NOT_FOUND",
      keys: [],
      enumerated: [],
      json: ["name", "position", "message", "level", "specifier", "importKind", "referrer"],
    });
    expect(() => {
      log.code = "E_WRAPPED";
    }).toThrow(TypeError);
  });
});

// These tests reproduce panics where the module resolver wrote past fixed-size
// PathBuffers when given very long import specifiers. The bug triggers when
// `import_path < PATH_MAX` but `baseUrl + import_path > PATH_MAX` (otherwise a
// syscall returns ENAMETOOLONG first). PATH_MAX is 1024 on macOS, 4096 on
// Linux/Windows, so pick a length just under it per platform.
// Any length > 512 also exercises the `esm_subpath` buffer.
describe.concurrent("long import path overflow", () => {
  const len = process.platform === "darwin" ? 1020 : 4090;
  // "a".repeat is slow in debug builds; use Buffer.alloc instead.
  const long = Buffer.alloc(len, "a").toString();

  function makeDir() {
    // package.json + node_modules/ prevent the resolver from attempting
    // auto-install (which has an unrelated pre-existing bug).
    return tempDir("resolve-long-path", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": `{"compilerOptions": {"baseUrl": ".", "paths": {"@x/*": ["./src/*"]}}}`,
    });
  }

  async function run(dir: string, importExpr: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { await import(${importExpr}); } catch {} console.log("ok");`],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }

  it("bare package specifier (tsconfig baseUrl + import_path join)", async () => {
    using dir = makeDir();
    // normalizeStringGenericTZ: `@memcpy(buf[buf_i..][0..count], ...)` past PathBuffer
    await run(String(dir), `\`@nonexistent/pkg/build/${long}.js\``);
  });

  it("tsconfig paths wildcard (matched text captured from import path)", async () => {
    using dir = makeDir();
    // matchTSConfigPaths: bun.concat into fixed tsconfig_match_full_buf3
    await run(String(dir), `\`@x/${long}\``);
  });

  it("relative path (source_dir + import_path join)", async () => {
    using dir = makeDir();
    // checkRelativePath / resolveWithoutRemapping absBuf
    await run(String(dir), `\`./${long}.js\``);
  });

  it("relative path full of `..` segments (exercises normalization fallback)", async () => {
    using dir = makeDir();
    // Concat length >> PATH_MAX but normalizes down; JoinScratch heap fallback
    await run(String(dir), `\`./\${"x/../".repeat(${len})}${long}.js\``);
  });

  it("absolute path longer than PATH_MAX (dirInfoCached buffer)", async () => {
    using dir = makeDir();
    // dirInfoCachedMaybeLog: bun.copy into dir_info_uncached_path
    await run(String(dir), `\`/${long}/mixed\``);
  });

  it("absolute path with >256 short components (dir_entry_paths_to_resolve queue)", async () => {
    using dir = makeDir();
    // Walk-up loop indexed into a fixed [256]DirEntryResolveQueueItem
    await run(String(dir), `\`/\${"a/".repeat(300)}x\``);
  });
});

// The resolver builds every candidate path in a MAX_PATH_BYTES buffer and treats one that's too long as missing.
describe.concurrent("candidate paths longer than a path buffer", () => {
  const longName = Buffer.alloc(MAX_PATH_BYTES, "a").toString();

  // package.json and node_modules/ keep the resolver from auto-installing the bare specifiers.
  async function run(files: Record<string, string>) {
    using dir = tempDir("resolve-too-long", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: stdout && JSON.parse(stdout), stderr, exitCode };
  }

  const helpers = `
    const outcome = fn => { try { return "resolved: " + fn(); } catch (e) { return e.code; } };
  `;

  it("throws MODULE_NOT_FOUND for a missing file whose path length is near the limit", async () => {
    const lengths = [-5, -4, -1, 0, 1, 300].map(delta => MAX_PATH_BYTES + delta);
    expect(
      await run({
        "main.cjs": `${helpers}
          const cwd = process.cwd();
          const out = {};
          for (const length of ${JSON.stringify(lengths)}) {
            const file = cwd + "/" + Buffer.alloc(length - Buffer.byteLength(cwd) - 1, "f").toString();
            out[length] = [outcome(() => require(file)), outcome(() => require.resolve(file))];
          }
          console.log(JSON.stringify(out));`,
      }),
    ).toEqual({
      result: Object.fromEntries(lengths.map(length => [length, ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]])),
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws when package.json main or module is too long", async () => {
    expect(
      await run({
        "node_modules/relative/package.json": JSON.stringify({ name: "relative", main: `./${longName}` }),
        "node_modules/absolute/package.json": JSON.stringify({ name: "absolute", module: `/${longName}` }),
        "main.cjs": `${helpers}
          import("absolute").then(() => "resolved", e => e.code).then(absolute => {
            console.log(JSON.stringify({ relative: outcome(() => require("relative")), absolute }));
          });`,
      }),
    ).toEqual({
      result: { relative: "MODULE_NOT_FOUND", absolute: "ERR_MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws MODULE_NOT_FOUND when a require.extensions key is too long", async () => {
    expect(
      await run({
        "dir/.keep": "",
        "main.cjs": `${helpers}
          require.extensions[${JSON.stringify("." + longName)}] = () => {};
          console.log(JSON.stringify({
            file: outcome(() => require("./missing")),
            directory: outcome(() => require("./dir")),
          }));`,
      }),
    ).toEqual({
      result: { file: "MODULE_NOT_FOUND", directory: "MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("fails the build when the package.json browser field remaps main to a path that's too long", async () => {
    expect(
      await run({
        "node_modules/m/package.json": JSON.stringify({
          name: "m",
          main: "./x.js",
          browser: { "./x.js": `./${longName}` },
        }),
        "node_modules/m/x.js": "module.exports = 1;",
        "entry.js": `import "m";`,
        "main.cjs": `
          Bun.build({ entrypoints: ["./entry.js"], target: "browser", throw: false }).then(build => {
            console.log(JSON.stringify({ success: build.success, messages: build.logs.map(log => log.message) }));
          });`,
      }),
    ).toEqual({
      result: { success: false, messages: ['Could not resolve: "m". Maybe you need to "bun install"?'] },
      stderr: "",
      exitCode: 0,
    });
  });

  it("skips tsconfig.json extends, baseUrl and paths values that are too long", async () => {
    // Each use.cjs uses the tsconfig.json next to it.
    expect(
      await run({
        "extends/tsconfig.json": JSON.stringify({ extends: `./${longName}` }),
        "extends/use.cjs": `module.exports = "loaded";`,
        "baseUrl/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: longName } }),
        "baseUrl/use.cjs": `module.exports = require("x");`,
        "paths/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { x: [longName] } } }),
        "paths/use.cjs": `module.exports = require("x");`,
        "main.cjs": `${helpers}
          console.log(JSON.stringify({
            extends: outcome(() => require("./extends/use.cjs")),
            baseUrl: outcome(() => require("./baseUrl/use.cjs")),
            paths: outcome(() => require("./paths/use.cjs")),
          }));`,
      }),
    ).toEqual({
      result: { extends: "resolved: loaded", baseUrl: "MODULE_NOT_FOUND", paths: "MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });
});

// matchTSConfigPaths sliced `path[prefix.len()..path.len() - suffix.len()]`
// after only checking starts_with/ends_with. When the prefix and suffix bytes
// overlap inside the import path (e.g. key "ab*ba" vs import "aba"), the slice
// start exceeds the end and Rust panics.
describe.concurrent("tsconfig paths wildcard with overlapping prefix/suffix", () => {
  async function run(key: string, specifier: string) {
    using dir = tempDir("tsconfig-paths-overlap", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { [key]: ["./impl/*"] } },
      }),
      "main.ts": `try { require(${JSON.stringify(specifier)}); } catch (e) { console.log("ERR:" + e.code); }`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "ERR:MODULE_NOT_FOUND",
      stderr: "",
      exitCode: 0,
    });
  }

  it("ab*ba vs aba", async () => {
    await run("ab*ba", "aba");
  });

  it("test*test vs testest", async () => {
    await run("test*test", "testest");
  });

  it("xy*xy vs xy", async () => {
    await run("xy*xy", "xy");
  });
});

// Bun.resolve() resolves synchronously and returns an already-settled promise.
// A rejected one has to be reported like any other unhandled rejection.
describe.concurrent("Bun.resolve() rejections are tracked", () => {
  async function run(body: string) {
    using dir = tempDir("bun-resolve-unhandled", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const dir = ${JSON.stringify(String(dir))};\n${body}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("an unhandled rejection is reported", async () => {
    const { stdout, stderr, exitCode } = await run(`Bun.resolve("./does-not-exist", dir);`);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module './does-not-exist'");
    expect(exitCode).toBe(1);
  });

  it("the returned promise is the one passed to 'unhandledRejection'", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(reason.code, promise === p);
      });
      const p = Bun.resolve("./does-not-exist", dir);
    `);
    expect(stdout).toBe("ERR_MODULE_NOT_FOUND true\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("a handled rejection is not reported", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Bun.resolve("./does-not-exist", dir).catch(e => console.log("caught", e.code));
    `);
    expect(stdout).toBe("caught ERR_MODULE_NOT_FOUND\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// Bun.resolve() allocates its rejected promise while the exception the resolve
// threw is still pending on the VM. That allocation is a GC safepoint, and the
// concurrent collector's end phase materializes the stack of every live Error
// whose frames died, through the onComputeErrorInfo hook. The hook used to
// clear whatever exception was pending, so the rejection then found nothing:
// `panic: A JavaScript exception was thrown, but it was cleared before it could be read.`
//
// Each call comes from a fresh closure and the reasons are kept in a ring, so
// every collection has live Errors with a dead top frame to materialize. The
// calls have to be awaited one at a time (64 per tick never fires), and
// collectContinuously keeps an end phase always imminent. The unfixed debug
// build panics after 2500 to 8500 iterations. Not concurrent with the tests
// above: a busy machine starves the collector and hides the race.
//
// Skipped on Windows: collectContinuously is several times slower under
// Windows + ASAN in CI, and the fixed C++ path is not platform-specific.
it.skipIf(isWindows)(
  "Bun.resolve() rejection survives a GC stack-trace finalizer",
  async () => {
    using dir = tempDir("bun-resolve-rejection-gc", {
      "fixture.mjs": `
        const keep = [];
        let rejections = 0;
        for (let i = 0; i < 20000; i++) {
          const call = () => Bun.resolve();
          await call().catch(e => {
            rejections++;
            keep.push(e);
            if (keep.length > 1024) keep.shift();
          });
        }
        console.log("ok rejections=" + rejections);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok rejections=20000", exitCode: 0 });
    void stderr;
  },
  // 20000 awaited rejections under collectContinuously on a debug+ASAN build
  // take well over the default 5s.
  120_000,
);
