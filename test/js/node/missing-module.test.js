import assert from "assert";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("not implemented yet module throws an error", () => {
  var missingModule = "node:missing";
  var missingBun = "bun:missing";
  var missingFile = "./filethatdoesntexist";
  var missingPackage = "package-that-doesnt-exist";

  assert.throws(() => require(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });
  assert.throws(() => require.resolve(missingModule), {
    message: /^Cannot find module 'node:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });

  assert.throws(() => require(missingBun), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingBun), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingBun), {
    message: /^Cannot find package 'bun:missing' imported from /,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingPackage), {
    message: /^Cannot find module 'package-that-doesnt-exist'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingPackage), {
    message: /^Cannot find module 'package-that-doesnt-exist'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingPackage), {
    message: /^Cannot find package 'package-that-doesnt-exist' imported from /,
    code: "ERR_MODULE_NOT_FOUND",
  });
});

// Only the rest that is the bare name of a Node.js builtin names a module ("bun:fs" is "fs").
describe.concurrent("a literal bun: specifier that is not a builtin", () => {
  test("gets the errors of a module that is missing", async () => {
    assert.throws(() => require("bun:missing"), {
      message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
      code: "MODULE_NOT_FOUND",
    });
    assert.throws(() => require.resolve("bun:missing"), {
      message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
      code: "MODULE_NOT_FOUND",
    });
    await assert.rejects(() => import("bun:missing"), {
      message: /^Cannot find package 'bun:missing' imported from /,
      code: "ERR_MODULE_NOT_FOUND",
    });
  });

  test("loads the Node.js builtin that the rest of it is the bare name of", async () => {
    expect(require("bun:fs")).toBe(require("node:fs"));
    expect((await import("bun:fs")).default).toBe(require("node:fs"));
    expect((await import("bun:fs/promises")).readFile).toBe(require("node:fs").promises.readFile);
  });

  // Each of these prints a line if it runs.
  const files = {
    "node_modules/missing/package.json": JSON.stringify({ name: "missing", version: "1.0.0", main: "index.js" }),
    "node_modules/missing/index.js": `console.log("LOADED node_modules/missing"); module.exports = {};`,
    "node_modules/bundle/package.json": JSON.stringify({ name: "bundle", version: "1.0.0", main: "index.js" }),
    "node_modules/bundle/index.js": `console.log("LOADED node_modules/bundle"); module.exports = {};`,
    "local.mjs": `console.log("LOADED ./local.mjs");`,
    "import-statement.mjs": `import missing from "bun:missing"; console.log("LOADED import-statement.mjs");`,
  };

  test("does not load the package, the module or the file that the rest of it names", async () => {
    using dir = tempDir("bun-prefix-literal", {
      ...files,
      "imported.mjs": `import missing from "bun:missing";`,
      "required.mjs": `import missing from "bun:missing";`,
      "export-from.ts": `export * from "bun:missing";`,
      "require.cjs": `module.exports = require("bun:missing");`,
      "worker.mjs": `import missing from "bun:missing"; postMessage("loaded");`,
      "node-builtin-imported.mjs": `import { readFile } from "bun:fs/promises"; if (typeof readFile !== "function") throw new Error("not node:fs/promises");`,
      "node-builtin-required.cjs": `if (require("bun:crypto") !== require("node:crypto")) throw new Error("not node:crypto");`,
      "entry.mjs": `
        import fs from "bun:fs";
        const forms = {
          "import()": () => import("bun:missing"),
          "require()": () => require("bun:missing"),
          "require.resolve()": () => require.resolve("bun:missing"),
          // import() transpiles the module on a worker thread, require() on this thread.
          "import statement in an imported module": () => import("./imported.mjs"),
          "import statement in a required module": () => require("./required.mjs"),
          "export from in an imported .ts module": () => import("./export-from.ts"),
          "require() in a required .cjs module": () => require("./require.cjs"),
          "import statement in a Worker": () => {
            const { promise, resolve, reject } = Promise.withResolvers();
            const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
            worker.onmessage = resolve;
            worker.onerror = event => reject(new Error(event.message));
            worker.addEventListener("close", () => reject(new Error("the Worker closed")));
            return promise;
          },
          "a builtin that is not of Node.js after the prefix": () => import("bun:ws"),
          "a prefixed Node.js builtin after the prefix": () => import("bun:node:fs"),
          "a relative path after the prefix": () => require("bun:./local.mjs"),
          "bun:bundle outside an import statement": () => require("bun:bundle"),
          "a Node.js builtin after the prefix, in this entry point": () => {
            if (fs !== require("node:fs")) throw new Error("not node:fs");
          },
          "a Node.js builtin after the prefix, in an imported module": () => import("./node-builtin-imported.mjs"),
          "a Node.js builtin after the prefix, in a required .cjs module": () => require("./node-builtin-required.cjs"),
        };
        const outcome = {};
        for (const [form, load] of Object.entries(forms)) {
          try {
            await load();
            outcome[form] = "loaded";
          } catch (error) {
            outcome[form] = error.message.match(/Cannot find (package|module) '[^']*'/)?.[0] ?? error.message;
          }
        }
        console.log(JSON.stringify(outcome));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split(/\r?\n/);
    expect({ loaded: lines.slice(0, -1), outcome: JSON.parse(lines.at(-1)), stderr }).toEqual({
      loaded: [],
      outcome: {
        "import()": "Cannot find package 'bun:missing'",
        "require()": "Cannot find module 'bun:missing'",
        "require.resolve()": "Cannot find module 'bun:missing'",
        "import statement in an imported module": "Cannot find package 'bun:missing'",
        "import statement in a required module": "Cannot find package 'bun:missing'",
        "export from in an imported .ts module": "Cannot find package 'bun:missing'",
        "require() in a required .cjs module": "Cannot find module 'bun:missing'",
        "import statement in a Worker": "Cannot find package 'bun:missing'",
        "a builtin that is not of Node.js after the prefix": "Cannot find package 'bun:ws'",
        "a prefixed Node.js builtin after the prefix": "Cannot find package 'bun:node:fs'",
        "a relative path after the prefix": "Cannot find module 'bun:./local.mjs'",
        "bun:bundle outside an import statement": "Cannot find module 'bun:bundle'",
        "a Node.js builtin after the prefix, in this entry point": "loaded",
        "a Node.js builtin after the prefix, in an imported module": "loaded",
        "a Node.js builtin after the prefix, in a required .cjs module": "loaded",
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("fails an entry point that imports it", async () => {
    using dir = tempDir("bun-prefix-literal-entry", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "import-statement.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toMatch(/^error: Cannot find package 'bun:missing' from '.*import-statement\.mjs'\r?$/m);
    expect(exitCode).toBe(1);
  });
});
