/// <reference types="./plugins" />
import { plugin } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { resolve } from "path";

declare global {
  var failingObject: any;
  var objectModuleResult: any;
  var laterCode: any;
  var asyncOnLoad: any;
  var asyncObject: any;
  var asyncfail: any;
  var asyncret: any;
}

plugin({
  name: "url text file loader",
  setup(builder) {
    var chainedThis = builder.onResolve({ namespace: "http", filter: /.*/ }, ({ path }) => {
      return {
        path,
        namespace: "url",
      };
    });
    expect(chainedThis).toBe(builder);

    chainedThis = builder.onLoad({ filter: /.*/, namespace: "url" }, async ({ path, namespace }) => {
      const res = await fetch("http://" + path);
      return {
        exports: { default: await res.text() },
        loader: "object",
      };
    });
    expect(chainedThis).toBe(builder);
  },
});

plugin({
  name: "recursion",
  setup(builder) {
    builder.onResolve({ filter: /.*/, namespace: "recursion" }, ({ path }) => ({
      path: require.resolve("recursion:" + path),
      namespace: "recursion",
    }));
  },
});

plugin({
  name: "boop beep beep",
  setup(builder) {
    builder.onResolve({ filter: /boop/, namespace: "beep" }, () => ({
      path: "boop",
      namespace: "beep",
    }));

    builder.onLoad({ filter: /boop/, namespace: "beep" }, () => ({
      contents: `export default 42;`,
      loader: "js",
    }));
  },
});

plugin({
  name: "an object module",
  setup(builder) {
    globalThis.objectModuleResult ||= {
      hello: "world",
    };
    builder.onResolve({ filter: /.*/, namespace: "obj" }, ({ path }) => ({
      path,
      namespace: "obj",
    }));

    builder.onLoad({ filter: /.*/, namespace: "obj" }, () => ({
      exports: globalThis.objectModuleResult,
      loader: "object",
    }));
  },
});

plugin({
  name: "failing loader",
  setup(builder) {
    globalThis.failingObject ||= {};
    builder.onResolve({ filter: /.*/, namespace: "fail" }, ({ path }) => ({
      path,
      namespace: "fail",
    }));
    builder.onLoad({ filter: /.*/, namespace: "fail" }, () => globalThis.failingObject);
  },
});

plugin({
  name: "delayed loader",
  setup(builder) {
    globalThis.laterCode = "";

    builder.onResolve({ filter: /.*/, namespace: "delay" }, ({ path }) => ({
      namespace: "delay",
      path,
    }));

    builder.onLoad({ filter: /.*/, namespace: "delay" }, ({ path }) => ({
      contents: globalThis.laterCode || "",
      loader: "js",
      resolveDir: process.cwd(),
    }));
  },
});

plugin({
  name: "async onLoad",
  setup(builder) {
    globalThis.asyncOnLoad = "";

    builder.onResolve({ filter: /.*/, namespace: "async" }, ({ path }) => ({
      namespace: "async",
      path,
    }));

    builder.onLoad({ filter: /.*/, namespace: "async" }, async ({ path }) => {
      await Promise.resolve(1);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve({
            contents: (globalThis.asyncOnLoad ||= ""),
            loader: "js",
          });
        }, 1);
      });
    });

    builder.onResolve({ filter: /.*/, namespace: "async-obj" }, ({ path }) => ({
      namespace: "async-obj",
      path,
    }));
    globalThis.asyncObject = {};
    builder.onLoad({ filter: /.*/, namespace: "async-obj" }, async ({ path }) => {
      await Promise.resolve(1);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve({
            exports: (globalThis.asyncObject ||= {}),
            loader: "object",
          });
        }, 1);
      });
    });

    builder.onResolve({ filter: /.*/, namespace: "asyncfail" }, ({ path }) => ({
      namespace: "asyncfail",
      path,
    }));

    globalThis.asyncfail = false;
    builder.onLoad({ filter: /.*/, namespace: "asyncfail" }, async ({ path }) => {
      await Promise.resolve(1);
      await 1;
      throw globalThis.asyncfail;
    });

    builder.onResolve({ filter: /.*/, namespace: "asyncret" }, ({ path }) => ({
      namespace: "asyncret",
      path,
    }));

    globalThis.asyncret = 123;
    builder.onLoad({ filter: /.*/, namespace: "asyncret" }, async ({ path }) => {
      await 100;
      await Promise.resolve(10);
      return await globalThis.asyncret;
    });
  },
});

plugin({
  name: "instant rejected load promise",
  setup(builder) {
    builder.onResolve({ filter: /.*/, namespace: "rejected-promise" }, ({ path }) => ({
      namespace: "rejected-promise",
      path,
    }));

    builder.onLoad({ filter: /.*/, namespace: "rejected-promise" }, async ({ path }) => {
      throw new Error("Rejected Promise");
    });

    builder.onResolve({ filter: /.*/, namespace: "rejected-promise2" }, ({ path }) => ({
      namespace: "rejected-promise2",
      path,
    }));

    builder.onLoad({ filter: /.*/, namespace: "rejected-promise2" }, ({ path }) => {
      return Promise.reject(new Error("Rejected Promise"));
    });
  },
});

// This is to test that it works when imported from a separate file
import { tempDir } from "harness";
import { render as svelteRender } from "svelte/server";
import "../../third_party/svelte";
import "./module-plugins";

describe("require", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", () => {
    const { default: App } = require("./hello.svelte");
    const { body } = svelteRender(App);

    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });

  it("beep:boop returns 42", () => {
    const result = require("beep:boop");
    expect(result.default).toBe(42);
  });

  it("object module works", () => {
    const result = require("obj:boop");
    expect(result.hello).toBe(objectModuleResult.hello);
    objectModuleResult.there = true;
    const result2 = require("obj:boop2");
    expect(result.there).toBe(undefined);
    expect(result2.there).toBe(objectModuleResult.there);
    expect(result2.there).toBe(true);
  });
});

describe("module", () => {
  it("throws with require()", () => {
    expect(() => require("my-virtual-module-async")).toThrow();
  });

  it("async module works with async import", async () => {
    // @ts-expect-error
    const { hello } = await import("my-virtual-module-async");

    expect(hello).toBe("world");
    delete require.cache["my-virtual-module-async"];
  });

  it("sync module module works with require()", async () => {
    const { hello } = require("my-virtual-module-sync");

    expect(hello).toBe("world");
    delete require.cache["my-virtual-module-sync"];
  });

  it("sync module module works with require.resolve()", async () => {
    expect(require.resolve("my-virtual-module-sync")).toBe("my-virtual-module-sync");
    delete require.cache["my-virtual-module-sync"];
  });

  it("sync module module works with import", async () => {
    // @ts-expect-error
    const { hello } = await import("my-virtual-module-sync");

    expect(hello).toBe("world");
    delete require.cache["my-virtual-module-sync"];
  });

  it("modules are overridable", async () => {
    // @ts-expect-error
    let { hello, there } = await import("my-virtual-module-sync");
    expect(there).toBeUndefined();
    expect(hello).toBe("world");

    Bun.plugin({
      setup(builder) {
        builder.module("my-virtual-module-sync", () => ({
          exports: {
            there: true,
          },
          loader: "object",
        }));
      },
    });

    {
      const { there, hello } = require("my-virtual-module-sync");
      expect(there).toBe(true);
      expect(hello).toBeUndefined();
    }

    Bun.plugin({
      setup(builder) {
        builder.module("my-virtual-module-sync", () => ({
          exports: {
            yo: true,
          },
          loader: "object",
        }));
      },
    });

    {
      // @ts-expect-error
      const { there, hello, yo } = await import("my-virtual-module-sync");
      expect(yo).toBe(true);
      expect(hello).toBeUndefined();
      expect(there).toBeUndefined();
    }
  });
});

describe("dynamic import", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", async () => {
    const { default: App }: any = await import("./hello.svelte");

    const { body } = svelteRender(App);
    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });

  it("beep:boop returns 42", async () => {
    const result = await import("beep:boop");
    expect(result.default).toBe(42);
  });

  it("async:onLoad returns 42", async () => {
    globalThis.asyncOnLoad = "export default 42;";
    const result = await import("async:hello42");
    expect(result.default).toBe(42);
  });

  it("async object loader returns 42", async () => {
    globalThis.asyncObject = { foo: 42, default: 43 };
    const result = await import("async-obj:hello42");
    expect(result.foo).toBe(42);
    expect(result.default).toBe(43);
  });
});

describe("import statement", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", async () => {
    laterCode = `
import Hello from ${JSON.stringify(resolve(import.meta.dir, "hello2.svelte"))};
export default Hello;
`;
    const { default: SvelteApp } = await import("delay:hello2.svelte");
    const { body } = svelteRender(SvelteApp);

    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });
});

describe("errors", () => {
  it("valid loaders work", () => {
    const validLoaders = ["js", "jsx", "ts", "tsx"];
    const inputs = ["export default 'hi';", "export default 'hi';", "export default 'hi';", "export default 'hi';"];
    for (let i = 0; i < validLoaders.length; i++) {
      const loader = validLoaders[i];
      const input = inputs[i];
      globalThis.failingObject = { contents: input, loader };
      expect(require(`fail:my-file-${loader}`).default).toBe("hi");
    }
  });

  it("handles invalid 'target'", () => {
    const opts = {
      setup: () => {},
      target: 123n,
    };

    expect(() => {
      plugin(opts as any);
    }).toThrow("plugin target must be one of 'node', 'bun' or 'browser'");
  });

  it("handles 'target' that throws while being coerced to a string", () => {
    let called = false;
    const opts = {
      setup: () => {
        called = true;
      },
      target: {
        [Symbol.toPrimitive]: () => ({}),
      },
    };

    expect(() => {
      plugin(opts as any);
    }).toThrow("Symbol.toPrimitive returned an object");
    expect(called).toBe(false);
  });

  it("handles a 'target' whose toString throws", () => {
    let called = false;
    const opts = {
      setup: () => {
        called = true;
      },
      target: {
        toString() {
          throw new Error("target toString error");
        },
      },
    };

    expect(() => {
      plugin(opts as any);
    }).toThrow("target toString error");
    expect(called).toBe(false);
  });

  it("invalid loaders throw", () => {
    const invalidLoaders = ["blah", "blah2", "blah3", "blah4"];
    const inputs = ["body { background: red; }", "<h1>hi</h1>", '{"hi": "there"}', "hi"];
    for (let i = 0; i < invalidLoaders.length; i++) {
      const loader = invalidLoaders[i];
      const input = inputs[i];
      globalThis.failingObject = { contents: input, loader };
      try {
        require(`fail:my-file-${loader}`);
        throw -1;
      } catch (e: any) {
        if (e === -1) {
          throw new Error("Expected error");
        }
        expect(e.message.length > 0).toBe(true);
      }
    }
  });

  it("transpiler errors work", () => {
    const invalidLoaders = ["ts"];
    const inputs = ["const x: string = -NaNAn../!!;"];
    for (let i = 0; i < invalidLoaders.length; i++) {
      const loader = invalidLoaders[i];
      const input = inputs[i];
      globalThis.failingObject = { contents: input, loader };
      try {
        require(`fail:my-file-${loader}-3`);
        throw -1;
      } catch (e: any) {
        if (e === -1) {
          throw new Error("Expected error");
        }
        expect(e.message.length > 0).toBe(true);
      }
    }
  });

  it("invalid async return value", async () => {
    try {
      globalThis.asyncret = { wat: true };
      await import("asyncret:my-file");
      throw -1;
    } catch (e: any) {
      if (e === -1) {
        throw new Error("Expected error");
      }

      expect(e.message.length > 0).toBe(true);
    }
  });

  it("async errors work", async () => {
    try {
      globalThis.asyncfail = new Error("async error");
      await import("asyncfail:my-file");
      throw -1;
    } catch (e: any) {
      if (e === -1) {
        throw new Error("Expected error");
      }
      expect(e.message.length > 0).toBe(true);
    }
  });

  it("invalid onLoad objects throw", () => {
    const invalidOnLoadObjects = [
      {},
      { contents: -1 },
      { contents: "", loader: -1 },
      { contents: "", loader: "klz", resolveDir: -1 },
    ];
    for (let i = 0; i < invalidOnLoadObjects.length; i++) {
      globalThis.failingObject = invalidOnLoadObjects[i];
      try {
        require(`fail:my-file-${i}-2`);
        throw -1;
      } catch (e: any) {
        if (e === -1) {
          throw new Error("Expected error");
        }
        expect(e.message.length > 0).toBe(true);
      }
    }
  });

  it("async transpiler errors work", async () => {
    expect(async () => {
      globalThis.asyncOnLoad = `const x: string = -NaNAn../!!;`;
      await import("async:fail");
      throw -1;
    }).toThrow('4 errors building "async:fail"');
  });

  it("onLoad returns the rejected promise", async () => {
    expect(async () => {
      await import("rejected-promise:hi");
      throw -1;
    }).toThrow("Rejected Promise");
    expect(async () => {
      await import("rejected-promise2:hi");
      throw -1;
    }).toThrow("Rejected Promise");
  });

  it("can work with http urls", async () => {
    const result = `The Mysterious Affair at Styles
    The Secret Adversary
    The Murder on the Links
    The Man in the Brown Suit
    The Secret of Chimneys
    The Murder of Roger Ackroyd
    The Big Four
    The Mystery of the Blue Train
    The Seven Dials Mystery
    The Murder at the Vicarage
    Giant's Bread
    The Floating Admiral
    The Sittaford Mystery
    Peril at End House
    Lord Edgware Dies
    Murder on the Orient Express
    Unfinished Portrait
    Why Didn't They Ask Evans?
    Three Act Tragedy
    Death in the Clouds`;

    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.stop();
        return new Response(result);
      },
    });
    const sleep = ms => new Promise<string>(res => setTimeout(() => res("timeout"), ms));
    const text = await Promise.race([
      import(`http://${server.hostname}:${server.port}/hey.txt`).then(mod => mod.default) as Promise<string>,
      sleep(2_500),
    ]);
    expect(text).toBe(result);
  });
});

describe("object loader with a throwing exports getter", () => {
  // The result object's "exports" getter throws while the module loader reads
  // it. Run in a subprocess: the unfixed runtime segfaults instead of
  // surfacing the getter's error.
  const throwingExportsResult = `
    const result = { loader: "object" };
    Object.defineProperty(result, "exports", {
      enumerable: true,
      get() {
        throw new Error("exports getter threw");
      },
    });
    return result;
  `;

  async function expectCleanFailure(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("failed: exports getter threw\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }

  it.concurrent("rejects import() of a build.module result", async () => {
    await expectCleanFailure(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.module("virt-mod", () => { ${throwingExportsResult} });
        },
      });
      try {
        await import("virt-mod");
        console.log("imported");
      } catch (e) {
        console.log("failed:", e?.message);
      }
    `);
  });

  it.concurrent("throws from require() of a build.module result", async () => {
    await expectCleanFailure(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.module("virt-mod", () => { ${throwingExportsResult} });
        },
      });
      try {
        require("virt-mod");
        console.log("required");
      } catch (e) {
        console.log("failed:", e?.message);
      }
    `);
  });

  it.concurrent("rejects import() of a build.onLoad result", async () => {
    await expectCleanFailure(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "virtns" }, args => ({ path: args.path, namespace: "virtns" }));
          build.onLoad({ filter: /.*/, namespace: "virtns" }, () => { ${throwingExportsResult} });
        },
      });
      try {
        await import("virtns:mod");
        console.log("imported");
      } catch (e) {
        console.log("failed:", e?.message);
      }
    `);
  });
});

describe("object loader with a throwing getter on an export", () => {
  // The "exports" object itself is fine; one of its own properties is a getter
  // that throws while the exports are copied into the module namespace. The
  // error must reach the importer as-is, not become an `undefined` export.
  const throwingExportResult = `
    const exported = { before: 1 };
    Object.defineProperty(exported, "boom", {
      enumerable: true,
      get() {
        throw globalThis.sentinel;
      },
    });
    exported.after = 2;
    return { exports: exported, loader: "object" };
  `;

  async function expectSentinel(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `globalThis.sentinel = new Error("export getter threw");\n${code}`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("failed with sentinel\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }

  const report = `
    catch (e) {
      console.log(e === globalThis.sentinel ? "failed with sentinel" : "failed with " + e);
    }
  `;

  it.concurrent("rejects import() of a build.module result", async () => {
    await expectSentinel(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.module("virt-mod", () => { ${throwingExportResult} });
        },
      });
      try {
        const ns = await import("virt-mod");
        console.log("imported boom=" + ns.boom);
      } ${report}
    `);
  });

  it.concurrent("throws from require() of a build.module result", async () => {
    await expectSentinel(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.module("virt-mod", () => { ${throwingExportResult} });
        },
      });
      try {
        const ns = require("virt-mod");
        console.log("required boom=" + ns.boom);
      } ${report}
    `);
  });

  it.concurrent("rejects import() of a build.onLoad result", async () => {
    await expectSentinel(`
      Bun.plugin({
        name: "virt",
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "virtns" }, args => ({ path: args.path, namespace: "virtns" }));
          build.onLoad({ filter: /.*/, namespace: "virtns" }, () => { ${throwingExportResult} });
        },
      });
      try {
        const ns = await import("virtns:mod");
        console.log("imported boom=" + ns.boom);
      } ${report}
    `);
  });
});

it("require(...).default without __esModule", () => {
  {
    const { default: mod } = require("my-virtual-module-with-default");
    expect(mod).toBe("world");
  }
});

it("require(...) with __esModule", () => {
  {
    const mod = require("my-virtual-module-with-__esModule");
    expect(mod).toBe("world");
  }
});

it("import(...) with __esModule", async () => {
  const { default: mod } = await import("my-virtual-module-with-__esModule");
  expect(mod).toBe("world");
});

it("import(...) without __esModule", async () => {
  const { default: mod } = await import("my-virtual-module-with-default");
  expect(mod).toBe("world");
});

it("recursion throws stack overflow", () => {
  expect(() => {
    require("recursion:recursion");
  }).toThrow("Maximum call stack size exceeded");

  try {
    require("recursion:recursion");
    throw -1;
  } catch (e: any) {
    if (e === -1) {
      throw new Error("Expected error");
    }
    expect(e.message).toMatchInlineSnapshot(`"Maximum call stack size exceeded."`);
  }
});

it("onResolve callbacks registered while a path is resolving only apply to later resolutions", () => {
  Bun.plugin({
    name: "registers another onResolve while resolving",
    setup(builder) {
      builder.onResolve({ filter: /.*/, namespace: "regduring" }, () => {
        Bun.plugin({
          name: "registered during resolution",
          setup(inner) {
            inner.onResolve({ filter: /.*/, namespace: "regduring" }, ({ path }) => ({
              path: "registered late: " + path,
              namespace: "regduring",
            }));
          },
        });
        return undefined;
      });

      builder.onLoad({ filter: /.*/, namespace: "regduring" }, ({ path }) => ({
        contents: `export default ${JSON.stringify(path)};`,
        loader: "js",
      }));
    },
  });

  expect(require("regduring:first").default).toBe("first");
  expect(require("regduring:second").default).toBe("registered late: second");
});

it("recursion throws stack overflow at entry point", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "--preload=./plugin-recursive-fixture.ts", "plugin-recursive-fixture-run.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(result.stderr.toString()).toContain("RangeError: Maximum call stack size exceeded.");
});

it.concurrent("onResolve can redirect a specifier to a real file in the file namespace", async () => {
  using dir = tempDir("plugin-onresolve-file-namespace", {
    "real.js": `export const value = "redirected";`,
    "entry.js": `
      import { join } from "node:path";

      const target = join(import.meta.dir, "real.js");

      Bun.plugin({
        name: "redirect-to-file",
        setup(build) {
          build.onResolve({ filter: /^implicit\\.mod$/ }, () => ({ path: target }));
          build.onResolve({ filter: /^explicit\\.mod$/ }, () => ({ path: target, namespace: "file" }));
          build.onResolve({ filter: /^empty-namespace\\.mod$/ }, () => ({ path: target, namespace: "" }));
          build.onResolve({ filter: /^custom\\.mod$/ }, () => ({ path: "inner", namespace: "custom" }));
          build.onLoad({ filter: /.*/, namespace: "custom" }, ({ path }) => ({
            contents: "export const value = " + JSON.stringify("custom:" + path) + ";",
            loader: "js",
          }));
        },
      });

      async function attempt(fn) {
        try {
          return await fn();
        } catch (error) {
          return "threw: " + error.message;
        }
      }

      console.log(
        JSON.stringify({
          dynamicImport: await attempt(async () => (await import("implicit.mod")).value),
          explicitFileNamespace: await attempt(async () => (await import("explicit.mod")).value),
          emptyNamespace: await attempt(async () => (await import("empty-namespace.mod")).value),
          customNamespace: await attempt(async () => (await import("custom.mod")).value),
          requireComputed: await attempt(() => require("implicit" + ".mod").value),
          resolveSync: await attempt(() => Bun.resolveSync("implicit.mod", import.meta.dir)),
          importMetaResolve: await attempt(() => import.meta.resolve("implicit.mod")),
        }),
      );
    `,
  });

  const target = resolve(String(dir), "real.js");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture catches its own failures, so empty stdout means it crashed.
  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    dynamicImport: "redirected",
    explicitFileNamespace: "redirected",
    emptyNamespace: "redirected",
    // A non-file namespace still round-trips through onLoad as "namespace:path".
    customNamespace: "custom:inner",
    requireComputed: "redirected",
    resolveSync: target,
    importMetaResolve: Bun.pathToFileURL(target).href,
  });
  expect(exitCode).toBe(0);
});

it.concurrent("a no-op onResolve that returns args.path unchanged is transparent", async () => {
  using dir = tempDir("plugin-onresolve-no-op", {
    "preload.js": `
      Bun.plugin({
        name: "no-op",
        setup(build) {
          build.onResolve({ filter: /\\.js$/ }, args => ({ path: args.path }));
          build.onResolve({ filter: /\\.ts$/, namespace: "file" }, args => ({ path: args.path, namespace: "file" }));
        },
      });
    `,
    "dep.ts": `export const value = "dep";`,
    "entry.js": `
      import { value } from "./dep.ts";
      console.log("entry ran:" + value);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.js", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() || stderr).toBe("entry ran:dep");
  expect(exitCode).toBe(0);
});

// Spawned in a subprocess because clearAll() would wipe the plugins the rest of this file relies on.
describe.concurrent("Bun.plugin.clearAll()", () => {
  async function run(src: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  it("re-registering a namespaced onLoad plugin after clearAll() works", async () => {
    const { stdout, stderr, exitCode } = await run(`
      function register() {
        Bun.plugin({
          name: "p",
          setup(b) {
            b.onResolve({ filter: /.*/, namespace: "myns" }, ({ path }) => ({ path, namespace: "myns" }));
            b.onLoad({ filter: /.*/, namespace: "myns" }, () => ({ contents: "export default 1;", loader: "js" }));
          },
        });
      }
      for (let i = 0; i < 50; i++) {
        register();
        Bun.plugin.clearAll();
      }
      register();
      const m = await import("myns:hello");
      console.log("result=" + m.default);
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "result=1", stderr: "", exitCode: 0 });
  });

  it("an onResolve error propagates out of a static import in a later-loaded module", async () => {
    using dir = tempDir("onresolve-throws-static", {
      "entry.mjs": `import "./dep.custom"; export default 1;`,
      "main.mjs": `
        Bun.plugin({ name: "throws", setup(b) { b.onResolve({ filter: /\\.custom$/ }, () => { throw new Error("resolve boom"); }); } });
        try {
          await import("./entry.mjs");
          console.log("resolved");
        } catch (e) {
          console.log("caught=" + e.message);
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "caught=resolve boom",
      stderr: "",
      exitCode: 0,
    });
  });

  it("re-registering a namespaced onResolve plugin after clearAll() drops the old callback", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Bun.plugin({
        name: "old",
        setup(b) {
          b.onResolve({ filter: /.*/, namespace: "myns" }, () => {
            throw new Error("stale onResolve callback ran");
          });
        },
      });
      Bun.plugin.clearAll();
      Bun.plugin({
        name: "new",
        setup(b) {
          b.onResolve({ filter: /.*/, namespace: "myns" }, ({ path }) => ({ path, namespace: "myns" }));
          b.onLoad({ filter: /.*/, namespace: "myns" }, () => ({ contents: "export default 2;", loader: "js" }));
        },
      });
      const m = await import("myns:hello");
      console.log("result=" + m.default);
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "result=2", stderr: "", exitCode: 0 });
  });

  // A namespace registered after clearAll() takes the index of a namespace that
  // was cleared, so it must not inherit that namespace's callbacks.
  it("a fresh namespace does not inherit a cleared plugin's callbacks", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const calls = { oldResolve: 0, newResolve: 0, newLoad: 0 };

      Bun.plugin({
        name: "old",
        setup(b) {
          b.onResolve({ filter: /.*/, namespace: "aa" }, ({ path }) => {
            calls.oldResolve++;
            return { path, namespace: "aa" };
          });
          b.onLoad({ filter: /.*/, namespace: "aa" }, () => ({ contents: "export default 'old';", loader: "js" }));
        },
      });

      Bun.plugin.clearAll();

      Bun.plugin({
        name: "new",
        setup(b) {
          b.onResolve({ filter: /.*/, namespace: "bb" }, ({ path }) => {
            calls.newResolve++;
            return { path, namespace: "bb" };
          });
          b.onLoad({ filter: /.*/, namespace: "bb" }, () => {
            calls.newLoad++;
            return { contents: "export default 'new';", loader: "js" };
          });
        },
      });

      const loaded = (await import("bb:hello")).default;
      console.log(JSON.stringify({ calls, loaded }));
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ calls: { oldResolve: 0, newResolve: 1, newLoad: 1 }, loaded: "new" }),
      stderr: "",
      exitCode: 0,
    });
  });

  // clearAll() frees the virtual module map, so the flag selecting how that map
  // is keyed goes with it. A stale flag trips an assertion on the next resolve.
  it("resets the virtual module lookup mode", async () => {
    using dir = tempDir("plugin-clear-all-virtual", {
      "sibling.mjs": `export default 1;`,
      "entry.mjs": `
        import { mock } from "bun:test";
        mock.module(new URL("./virtual-module.js", import.meta.url).href, () => ({ default: 1 }));
        Bun.plugin.clearAll();
        await import("./sibling.mjs");
        console.log("ok");
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

    expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  });
});

it("object loader: an error thrown by a getter on the exports object rejects the require()", () => {
  const boom = new Error("boom");
  plugin({
    name: "object loader with throwing __esModule",
    setup(build) {
      build.module("object-loader-throwing-esmodule", () => ({
        exports: {
          get __esModule() {
            throw boom;
          },
          a: 1,
        },
        loader: "object",
      }));
    },
  });
  expect(() => require("object-loader-throwing-esmodule")).toThrow(boom);
});

it.concurrent("build.module() of a module whose import() is still loading its dependencies", async () => {
  using dir = tempDir("plugin-module-import-in-flight", {
    "a.ts": `import "./dependency"; export const from = "file";`,
    "dependency.ts": `export {};`,
    "entry.ts": `
      import { join } from "node:path";
      const dependencyRequested = Promise.withResolvers<void>();
      const dependencyMayLoad = Promise.withResolvers<void>();
      Bun.plugin({
        name: "hold the dependency's load open",
        setup(build) {
          build.onLoad({ filter: /dependency\\.ts$/ }, async () => {
            dependencyRequested.resolve();
            await dependencyMayLoad.promise;
            return { contents: "export {}", loader: "ts" };
          });
        },
      });

      const a = join(import.meta.dir, "a.ts");
      const inFlight = import(a);
      await dependencyRequested.promise;
      Bun.plugin({
        name: "replace a.ts",
        setup(build) {
          build.module(a, () => ({ exports: { from: "build.module()" }, loader: "object" }));
        },
      });
      dependencyMayLoad.resolve();

      console.log("in flight:", (await inFlight).from);
      console.log("next:", (await import(a)).from);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "in flight: file\nnext: build.module()\n",
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent(
  "import() after delete require.cache of a module that onResolve redirected a resolved path to",
  async () => {
    using dir = tempDir("plugin-onresolve-removed", {
      "a.mjs": `export const from = "a.mjs";`,
      "b.mjs": `export const from = "b.mjs, evaluation " + (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);`,
      "entry.ts": `
      import { join } from "node:path";
      Bun.plugin({
        name: "redirect a path that is already resolved",
        setup(build) {
          build.onResolve({ filter: /a\\.mjs$/ }, () => ({ path: join(import.meta.dir, "b.mjs") }));
        },
      });

      const a = join(import.meta.dir, "a.mjs");
      console.log("first:", (await import(a)).from);
      console.log("deleted:", delete require.cache[join(import.meta.dir, "b.mjs")]);
      console.log("again:", (await import(a)).from);
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "first: b.mjs, evaluation 1\ndeleted: true\nagain: b.mjs, evaluation 2\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

// As in the example of onResolve in the documentation, which answers "./public/images/...".
describe.concurrent("what onResolve answers without a namespace", () => {
  const files = {
    // Not these: they are where the answers lead from the working directory.
    "public/a.mjs": `export default "from the working directory";`,
    "public/index.mjs": `export default "from the working directory";`,
    "src/public/a.mjs": `export default "a.mjs";`,
    "src/public/index.mjs": `export default "index.mjs";`,
    "src/node_modules/dep/package.json": `{ "name": "dep", "main": "main.mjs" }`,
    "src/node_modules/dep/main.mjs": `export default "dep";`,
    "src/real.img": "",
    "src/importer.mjs": `export { default } from "who.importer";`,
    "src/importer.cjs": `module.exports = require("who.importer");`,
    "plugin.ts": `
      import { basename, join } from "node:path";
      const answers = {
        "relative.img": "./public/a.mjs",
        "extension.img": "./public/a",
        "directory.img": "./public",
        "package.img": "dep",
        "url.img": Bun.pathToFileURL(import.meta.dir + "/src/public/a.mjs").href,
        "module.img": "a-module",
        "namespace.img": "served:thing",
        "absent.img": import.meta.dir + "/src/absent.served",
        "itself.img": "itself.img",
        "bare.img": "bare",
        "symlink.img": join(import.meta.dir, "src", "link.img"),
        "long.img": "/" + Buffer.alloc(200_000, "a") + ".js",
      };
      Bun.plugin({
        name: "answers",
        setup(build) {
          build.onResolve({ filter: /\\.img$/ }, ({ path }) => ({ path: answers[path] ?? path }));
          build.onResolve({ filter: /\\.importer$/ }, ({ importer }) => ({ path: basename(importer), namespace: "served" }));
          build.module("a-module", () => ({ exports: { default: "a module" }, loader: "object" }));
          build.onLoad({ filter: /.*/, namespace: "served" }, ({ path }) => ({
            contents: "export default " + JSON.stringify(path),
            loader: "js",
          }));
          build.onLoad({ filter: /(absent\\.served|(itself|link|real)\\.img|^bare)$/ }, ({ path }) => ({
            contents: "export default " + JSON.stringify(basename(path)),
            loader: "js",
          }));
        },
      });
    `,
  };
  async function run(name: string, source: string) {
    using dir = tempDir("plugin-onresolve-answer", { ...files, ["src/" + name]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./plugin.ts", "src/" + name],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const specifiers = [
    "relative",
    "extension",
    "directory",
    "package",
    "url",
    "module",
    "namespace",
    "absent",
    "itself",
  ];
  const S = `const S = ${JSON.stringify(specifiers.map(name => name + ".img"))};\n`;
  const loaded = "a.mjs,a.mjs,index.mjs,dep,a.mjs,a module,thing,absent.served,itself.img\n";
  const resolved = "a.mjs,a.mjs,index.mjs,main.mjs,a.mjs,a-module,served:thing,absent.served,itself.img\n";
  it.each([
    [
      "an import statement",
      "entry.mjs",
      specifiers.map(name => `import $${name} from "${name}.img";\n`).join("") +
        `console.log([${specifiers.map(name => "$" + name)}].join());`,
      loaded,
    ],
    [
      "import()",
      "entry.mjs",
      S + `console.log((await Promise.all(S.map(s => import(s)))).map(m => m.default).join());`,
      loaded,
    ],
    ["require()", "entry.cjs", S + `console.log(S.map(s => require(s).default).join());`, loaded],
    [
      "import.meta.require()",
      "entry.mjs",
      S + `console.log(S.map(s => import.meta.require(s).default).join());`,
      loaded,
    ],
    [
      "Bun.resolveSync()",
      "entry.mjs",
      S + `console.log(S.map(s => require("node:path").basename(Bun.resolveSync(s, import.meta.dir))).join());`,
      resolved,
    ],
  ])("is resolved from the importer for %s", async (_, name, source, stdout) => {
    expect(await run(name, source)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  // No onLoad is called for a key with no extension and no namespace.
  it("is not found when only the filter of an onLoad that is not called for it matches", async () => {
    const source = `
      try { require.resolve("bare.img"); } catch (error) { console.log("require.resolve()", error.message.split("\\n")[0]); }
      try { require("bare.img"); } catch (error) { console.log("require()", error.message.split("\\n")[0]); }
      import("bare.img").catch(error => console.log("import()", error.message.split(" imported")[0]));
    `;
    expect(await run("entry.cjs", source)).toEqual({
      stdout:
        "require.resolve() Cannot find module 'bare'\nrequire() Cannot find module 'bare'\nimport() Cannot find package 'bare'\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("is the module of the real path when it is a symlink", async () => {
    const source = `
      require("node:fs").symlinkSync(import.meta.dir + "/real.img", import.meta.dir + "/link.img");
      const symlink = await import("symlink.img");
      console.log(symlink.default, symlink === (await import("./real.img")));
    `;
    expect(await run("entry.mjs", source)).toEqual({ stdout: "real.img true\n", stderr: "", exitCode: 0 });
  });

  it("is an error to catch when it is too long for a path", async () => {
    const source = `
      try { require("long.img"); } catch (error) { console.log("require()", error.message.slice(0, 12)); }
      import("long.img").catch(error => console.log("import()", error.message.slice(0, 12)));
    `;
    expect(await run("entry.cjs", source)).toEqual({
      stdout: "require() ENAMETOOLONG\nimport() ENAMETOOLONG\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("is asked for with the path of the importer, without its query", async () => {
    const source = `
      import esm from "./importer.mjs?x=1";
      console.log(esm, (await import("./importer.cjs?y=2")).default.default);
    `;
    expect(await run("entry.mjs", source)).toEqual({ stdout: "importer.mjs importer.cjs\n", stderr: "", exitCode: 0 });
  });

  it("is not asked for about a specifier that is empty or not a URL", async () => {
    const source = `
      for (const load of [() => import(""), async () => require("file://%zz"), async () => Bun.resolveSync("", import.meta.dir)])
        console.log(await load().catch(error => error.name));
    `;
    expect(await run("entry.mjs", source)).toEqual({
      stdout: "ResolveMessage\nResolveMessage\nResolveMessage\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// Without a node_modules directory, Bun installs the package it does not find.
describe.concurrent("the registry is not asked for a bare name that onResolve answers about as well", () => {
  // onResolve answers the first with itself, so it is not asked again. It is about the name it answers the second with.
  const asksOnResolve = "onResolve itself-served.js\nonResolve dir/served.virtual\nonResolve served.virtual\n";
  it.each([
    [
      "an import statement",
      "entry.mjs",
      `import a from "itself-served.js"; import b from "dir/served.virtual"; console.log(a, b);`,
    ],
    [
      "import()",
      "entry.mjs",
      `console.log((await import("itself-served.js")).default, (await import("dir/served.virtual")).default);`,
    ],
    [
      "require()",
      "entry.cjs",
      `console.log(require("itself-served.js").default, require("dir/served.virtual").default);`,
    ],
    [
      "import.meta.require()",
      "entry.mjs",
      `console.log(import.meta.require("itself-served.js").default, import.meta.require("dir/served.virtual").default);`,
    ],
    [
      "require.resolve()",
      "entry.cjs",
      `console.log(require.resolve("itself-served.js"), require.resolve("dir/served.virtual"));`,
    ],
    [
      "import.meta.resolve()",
      "entry.mjs",
      `console.log(import.meta.resolve("itself-served.js"), import.meta.resolve("dir/served.virtual"));`,
    ],
    [
      "Bun.resolveSync()",
      "entry.mjs",
      `console.log(Bun.resolveSync("itself-served.js", import.meta.dir), Bun.resolveSync("dir/served.virtual", import.meta.dir));`,
    ],
    [
      "Bun.resolve()",
      "entry.mjs",
      `console.log(await Bun.resolve("itself-served.js", import.meta.dir), await Bun.resolve("dir/served.virtual", import.meta.dir));`,
    ],
  ])("by %s", async (_, name, source) => {
    expect(await run(name, source)).toEqual({
      stdout: asksOnResolve + "itself-served.js served.virtual\n",
      stderr: "",
      exitCode: 0,
      asked: ["/not-answered"],
    });
  });

  it("whether or not an onLoad serves it", async () => {
    const source = `
      for (const specifier of ["itself-not-served.js", "dir/not-served.virtual"])
        try { require.resolve(specifier); } catch (error) { console.log(error.message.split("\\n")[0]); }
    `;
    expect(await run("entry.cjs", source)).toEqual({
      stdout:
        "onResolve itself-not-served.js\nCannot find module 'itself-not-served.js'\n" +
        "onResolve dir/not-served.virtual\nonResolve not-served.virtual\nCannot find module 'not-served.virtual'\n",
      stderr: "",
      exitCode: 0,
      asked: ["/not-answered"],
    });
  });

  it("and is for one it does not, though the filter of an onLoad or of an onResolve that declines matches", async () => {
    const source = `
      for (const specifier of ["package.redirect", "file.redirect", "file.declines"])
        try { console.log(require.resolve(specifier)); } catch (error) { console.log(error.message.split("\\n")[0]); }
    `;
    expect(await run("entry.cjs", source)).toEqual({
      stdout:
        "onResolve package.redirect\nCannot find module 'a-package'\n" +
        "onResolve file.redirect\nb-package/file.transformed\n" +
        "onResolve file.declines\nonResolve c-package/file.declines\nCannot find module 'c-package/file.declines'\n",
      stderr: "",
      exitCode: 0,
      asked: ["/a-package", "/b-package", "/c-package", "/not-answered"],
    });
  });

  it("and onResolve is not asked again about an answer in a namespace", async () => {
    expect(await run("entry.cjs", `console.log(require("moved.namespace").default);`)).toEqual({
      stdout: "onResolve moved.namespace\ninner.js\n",
      stderr: "",
      exitCode: 0,
      asked: ["/not-answered"],
    });
  });

  it("and what onResolve says about the bare name is an error if it is not valid", async () => {
    const source = `try { require.resolve("first.invalid"); } catch (error) { console.log(error.message); }`;
    expect(await run("entry.cjs", source)).toEqual({
      stdout: `onResolve first.invalid\nonResolve second.invalid\nExpected "path" to be a string in onResolve plugin\n`,
      stderr: "",
      exitCode: 0,
      asked: ["/not-answered"],
    });
  });

  async function run(name: string, source: string) {
    const asked: string[] = [];
    using registry = Bun.serve({
      port: 0,
      fetch(request) {
        asked.push(new URL(request.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("plugin-onresolve-registry", {
      "plugin.ts": `
        import { basename } from "node:path";
        const redirects = { "package.redirect": "a-package", "file.redirect": "b-package/file.transformed" };
        function logged(answer) {
          return args => (console.log("onResolve", args.path), answer(args));
        }
        Bun.plugin({
          name: "answers",
          setup(build) {
            build.onResolve({ filter: /^itself-/ }, logged(({ path }) => ({ path })));
            build.onResolve({ filter: /\\.virtual$/ }, logged(({ path }) => ({ path: basename(path) })));
            build.onResolve({ filter: /\\.redirect$/ }, logged(({ path }) => ({ path: redirects[path] })));
            build.onResolve({ filter: /\\.declines$/ }, logged(({ path }) => (path === "file.declines" ? { path: "c-package/" + path } : undefined)));
            build.onResolve({ filter: /\\.namespace$/ }, logged(() => ({ path: "inner.js", namespace: "custom" })));
            build.onResolve({ filter: /.*/, namespace: "custom" }, logged(() => undefined));
            build.onResolve({ filter: /\\.invalid$/ }, logged(({ path }) => ({ path: path === "first.invalid" ? "second.invalid" : 42 })));
            build.onLoad({ filter: /.*/, namespace: "custom" }, ({ path }) => ({
              contents: "export default " + JSON.stringify(path),
              loader: "js",
            }));
            build.onLoad({ filter: /^(itself-served\\.js|served\\.virtual)$/ }, ({ path }) => ({
              contents: "export default " + JSON.stringify(path),
              loader: "js",
            }));
            build.onLoad({ filter: /\\.transformed$/ }, async ({ path }) => ({
              contents: await Bun.file(path).text(),
              loader: "js",
            }));
          },
        });
      `,
      // The last line is what no plugin answers about, which is asked of the registry.
      [name]: source + `\nimport("not-answered").catch(() => {});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./plugin.ts", name],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: registry.url.href,
        NPM_CONFIG_REGISTRY: registry.url.href,
        BUN_INSTALL_CACHE_DIR: resolve(String(dir), ".cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, asked };
  }
});

it.concurrent("an onLoad in the namespace of builtins leaves their aliases alone", async () => {
  const source = `
    Bun.plugin({ name: "node", setup(build) { build.onLoad({ filter: /^never$/, namespace: "node" }, () => {}); } });
    console.log(typeof (await import("node:sys")).inspect, typeof require("node:sys").inspect);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
});

describe.concurrent("onResolve", () => {
  const files = {
    "a.mjs": `export const from = "a.mjs";`,
    "b.mjs": `export const from = "b.mjs";`,
    "c.mjs": `export const from = "c.mjs";`,
    "d.mjs": `export const from = "d.mjs";`,
    "a.cjs": `exports.from = "a.cjs";`,
    "b.cjs": `exports.from = "b.cjs";`,
    "c.cjs": `exports.from = "c.cjs";`,
    "a.js": `console.log("a.js");`,
    "b.js": `console.log("b.js");`,
    "c.js": `console.log("c.js");`,
    "a.test.js": `console.log("a.test.js"); require("bun:test").test("passes", () => {});`,
    "b.test.js": `console.log("b.test.js"); require("bun:test").test("passes", () => {});`,
    "c.test.js": `console.log("c.test.js"); require("bun:test").test("passes", () => {});`,
    "absent.test.js": `require("bun:test").test("is not loaded", () => {});`,
    "throws.test.js": `require("bun:test").test("is not loaded", () => {});`,
    "other.test.js": `require("bun:test").test("passes", () => {});`,
    "plugin.ts": `
      import { basename, join } from "node:path";
      const next = { a: "b", b: "c", c: "d" };
      Bun.plugin({
        name: "redirect",
        setup(build) {
          build.onResolve({ filter: /[\\\\/][abc](\\.test)?\\.[cm]?js$/ }, ({ path }) => {
            const name = basename(path);
            console.log("onResolve", name);
            return { path: join(import.meta.dir, next[name[0]] + name.slice(1)) };
          });
          build.onResolve({ filter: /\\.virtual$/ }, ({ path }) => {
            console.log("onResolve", basename(path));
            return { path: "from " + basename(path), namespace: "virtual" };
          });
          build.onResolve({ filter: /\\.throws$|throws\\.test\\.js$/ }, () => {
            throw new Error("from onResolve");
          });
          build.onResolve({ filter: /absent\\.test\\.js$/ }, () => ({ path: "/absent/from-onResolve.js" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, ({ path }) => ({
            contents: "export const from = " + JSON.stringify(path) + ";",
            loader: "js",
          }));
        },
      });
    `,
  };
  async function run(name: string, source: string, args = ["--preload", "./plugin.ts", name]) {
    using dir = tempDir("plugin-onresolve-once", { ...files, [name]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), stderr, exitCode };
  }

  it.each([
    ["import()", "entry.mjs", `console.log((await import("./a.mjs")).from);`, "a.mjs", "b.mjs"],
    ["an import statement", "entry.mjs", `import { from } from "./a.mjs"; console.log(from);`, "a.mjs", "b.mjs"],
    [
      "export from",
      "entry.mjs",
      `export { from } from "./a.mjs"; import * as self from "./entry.mjs"; console.log(self.from);`,
      "a.mjs",
      "b.mjs",
    ],
    ["import.meta.require()", "entry.mjs", `console.log(import.meta.require("./a.mjs").from);`, "a.mjs", "b.mjs"],
    ["require() of an ES module", "entry.cjs", `console.log(require("./a.mjs").from);`, "a.mjs", "b.mjs"],
    ["require() of a CommonJS module", "entry.cjs", `console.log(require("./a.cjs").from);`, "a.cjs", "b.cjs"],
    ["module.require()", "entry.cjs", `console.log(module.require("./a.cjs").from);`, "a.cjs", "b.cjs"],
    [
      "require.resolve()",
      "entry.cjs",
      `console.log(require("node:path").basename(require.resolve("./a.cjs")));`,
      "a.cjs",
      "b.cjs",
    ],
  ])("is asked once by %s", async (_, name, source, asked, loaded) => {
    expect(await run(name, source)).toEqual({ stdout: ["onResolve " + asked, loaded], stderr: "", exitCode: 0 });
  });

  // What Bun loads itself has no importer.
  it.each([
    ["a later preload", "", ["--preload", "./plugin.ts", "--preload", "./a.js", "entry.cjs"]],
    ["Module.runMain()", `require("node:module").runMain("./a.js");`, ["--preload", "./plugin.ts", "entry.cjs"]],
    [
      "Bun.ModuleGraph's import()",
      `new Bun.ModuleGraph().import("./a.js");`,
      ["--preload", "./plugin.ts", "entry.cjs"],
    ],
  ])("is asked once about %s", async (_, source, args) => {
    expect(await run("entry.cjs", source, args)).toEqual({
      stdout: ["onResolve a.js", "b.js"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("is asked once about a test file", async () => {
    const { stdout, exitCode } = await run("entry.cjs", "", ["test", "--preload", "./plugin.ts", "./a.test.js"]);
    // (After the version.)
    expect({ stdout: stdout.slice(1), exitCode }).toEqual({
      stdout: ["onResolve a.test.js", "b.test.js"],
      exitCode: 0,
    });
  });

  it.each([
    ["answers what is not there", "./absent.test.js", "Cannot find module '/absent/from-onResolve.js'"],
    ["throws", "./throws.test.js", "error: from onResolve"],
  ])("that %s about a test file fails that file, and the next one runs", async (_, file, error) => {
    const { stderr, exitCode } = await run("entry.cjs", "", [
      "test",
      "--preload",
      "./plugin.ts",
      file,
      "./other.test.js",
    ]);
    expect(stderr).toContain(error);
    expect(stderr).toContain(" 1 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  it.each([
    ["an import statement", "entry.mjs", `import { from } from "./x.virtual"; console.log(from);`, "from x.virtual"],
    ["import()", "entry.mjs", `console.log((await import("./x.virtual")).from);`, "from x.virtual"],
    ["require()", "entry.cjs", `console.log(require("./x.virtual").from);`, "from x.virtual"],
    ["module.require()", "entry.cjs", `console.log(module.require("./x.virtual").from);`, "from x.virtual"],
    ["require.resolve()", "entry.cjs", `console.log(require.resolve("./x.virtual"));`, "virtual:from x.virtual"],
  ])("can move what %s asks for into a namespace", async (_, name, source, expected) => {
    expect(await run(name, source)).toEqual({ stdout: ["onResolve x.virtual", expected], stderr: "", exitCode: 0 });
  });

  it.each([
    ["an import statement", "entry.mjs", `import { from } from "virtual:thing"; console.log(from);`],
    ["import()", "entry.mjs", `console.log((await import("virtual:thing")).from);`],
    ["require()", "entry.cjs", `console.log(require("virtual:thing").from);`],
  ])("is not needed when the namespace has an onLoad: %s", async (_, name, source) => {
    expect(await run(name, source)).toEqual({ stdout: ["thing"], stderr: "", exitCode: 0 });
  });

  it("is not asked about a require() that does not run", async () => {
    const source = `
      if (process.env.NOT_SET) require("./a.cjs");
      function notCalled() { return require.resolve("./b.cjs"); }
      console.log("done");
    `;
    expect(await run("entry.cjs", source)).toEqual({ stdout: ["done"], stderr: "", exitCode: 0 });
  });

  it("throws where the require() is", async () => {
    const source = `
      console.log("before");
      try { require("./x.throws"); } catch (error) { console.log("caught", error.message); }
    `;
    expect(await run("entry.cjs", source)).toEqual({
      stdout: ["before", "caught from onResolve"],
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("onLoad that declines", () => {
  const ways = ["statement", "export", "import", "require", "meta-require"];
  const files = {
    ...Object.fromEntries(ways.map(way => [`dep-${way}.ts`, `export default "${way} from disk" as string;`])),
    "entry.ts": `
      import statement from "./dep-statement.ts";
      export { default as exported } from "./dep-export.ts";
      import * as self from "./entry.ts";
      function attempt(load) {
        try { return load(); } catch (error) { return error.name + ": " + error.message.replace(import.meta.dir, "").replaceAll("\\\\", "/"); }
      }
      console.log(statement);
      console.log(self.exported);
      console.log((await import("./dep-import.ts")).default);
      console.log(attempt(() => require("./dep-require.ts").default));
      console.log(attempt(() => import.meta.require("./dep-meta-require.ts").default));
      console.log(globalThis.asked.join());
    `,
  };
  async function run(
    setup: string,
    extra: Record<string, string> = {},
    args = ["--preload", "./plugin.ts", "entry.ts"],
  ) {
    using dir = tempDir("plugin-onload-declines", {
      ...files,
      ...extra,
      "plugin.ts": `
        import { basename } from "node:path";
        globalThis.asked = [];
        function asked(name, callback) {
          return args => (globalThis.asked.push(name + " " + basename(args.path).replace(/^dep-|\\.ts$/g, "")), callback(args));
        }
        Bun.plugin({ name: "declines", setup(build) { ${setup} } });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), stderr, exitCode };
  }

  const settled = [
    ["undefined", "() => undefined"],
    ["null", "() => null"],
    ["nothing", "() => {}"],
    ["a promise fulfilled with undefined", "() => Promise.resolve(undefined)"],
    ["a promise fulfilled with null", "() => Promise.resolve(null)"],
    ["the promise of an async function that does not await", "async () => {}"],
  ];
  const pending = [
    ["a promise that is pending, then fulfilled with undefined", "async () => { await 0; }"],
    ["a promise that is pending, then fulfilled with null", "async () => { await Bun.sleep(1); return null; }"],
  ];
  const unsupported = (way: string) =>
    `TypeError: require() async module "/dep-${way}.ts" is unsupported. use "await import()" instead.`;

  describe.each([...settled.map(row => [...row, false] as const), ...pending.map(row => [...row, true] as const)])(
    "with %s",
    (_, declines, isPending) => {
      it("has the file loaded as if no plugin had matched", async () => {
        expect(await run(`build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("only", ${declines}));`)).toEqual({
          stdout: [
            "statement from disk",
            "export from disk",
            "import from disk",
            isPending ? unsupported("require") : "require from disk",
            isPending ? unsupported("meta-require") : "meta-require from disk",
            ways.map(way => "only " + way).join(),
          ],
          stderr: "",
          exitCode: 0,
        });
      });

      it("has the next matching callback asked, in the order they were registered", async () => {
        const setup = `
          build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("1st", ${declines}));
          build.onLoad({ filter: /does-not-match/ }, asked("2nd", () => ({ contents: "export default '2nd'", loader: "ts" })));
          build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("3rd", ${declines}));
          build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("4th", ({ path }) => ({ contents: "export default " + JSON.stringify(basename(path) + " from the 4th"), loader: "ts" })));
          build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("5th", () => ({ contents: "export default '5th'", loader: "ts" })));
        `;
        expect(await run(setup)).toEqual({
          stdout: [
            "dep-statement.ts from the 4th",
            "dep-export.ts from the 4th",
            "dep-import.ts from the 4th",
            isPending ? unsupported("require") : "dep-require.ts from the 4th",
            isPending ? unsupported("meta-require") : "dep-meta-require.ts from the 4th",
            expect.any(String),
          ],
          stderr: "",
          exitCode: 0,
        });
      });
    },
  );

  it("asks each callback once for each file, and none after the one that answers", async () => {
    const setup = `
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("sync", () => {}));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("pending", async () => { await 0; }));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("sync again", () => null));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("pending again", async () => { await Bun.sleep(1); }));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("answers", async () => { await 0; return { exports: { default: "answered" }, loader: "object" }; }));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("not asked", () => {}));
    `;
    const entry = `console.log((await import("./dep-import.ts")).default); console.log(globalThis.asked.join());`;
    expect(await run(setup, { "entry.ts": entry })).toEqual({
      stdout: ["answered", "sync import,pending import,sync again import,pending again import,answers import"],
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    ["returned", "value => value"],
    ["in a fulfilled promise", "value => Promise.resolve(value)"],
    ["in a promise that is pending", "async value => { await 0; return value; }"],
  ])("is not what anything else that is not an object does: %s", async (_, wrap) => {
    const names = ["number", "zero", "false", "true", "empty-string", "string", "bigint", "symbol"];
    const setup = `
      const wrap = ${wrap};
      const values = { number: 42, zero: 0, false: false, true: true, "empty-string": "", string: "contents", bigint: 10n, symbol: Symbol() };
      build.onLoad({ filter: /\\.value$/ }, asked("1st", () => {}));
      build.onLoad({ filter: /\\.value$/ }, asked("2nd", ({ path }) => wrap(values[basename(path, ".value")])));
      build.onLoad({ filter: /\\.value$/ }, asked("3rd", () => ({ contents: "", loader: "js" })));
    `;
    const entry = `
      for (const name of ${JSON.stringify(names)})
        await import("./" + name + ".value").then(
          () => console.log(name, "loaded"),
          error => console.log(name, error.name + ": " + error.message),
        );
      console.log(globalThis.asked.join());
    `;
    const extra = { "entry.ts": entry, ...Object.fromEntries(names.map(name => [name + ".value", ""])) };
    expect(await run(setup, extra)).toEqual({
      stdout: [
        ...names.map(name => name + " TypeError: onLoad() expects an object returned"),
        names.map(name => `1st ${name}.value,2nd ${name}.value`).join(),
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    ["throws", "() => { throw new Error('from the 2nd'); }"],
    ["returns a rejected promise", "() => Promise.reject(new Error('from the 2nd'))"],
    ["returns a promise that is pending, then rejected", "async () => { await 0; throw new Error('from the 2nd'); }"],
  ])("leaves the import to fail when the next callback %s", async (_, fails) => {
    for (const declines of ["() => {}", "async () => { await 0; }"]) {
      const setup = `
        build.onLoad({ filter: /dep-import\\.ts$/ }, asked("1st", ${declines}));
        build.onLoad({ filter: /dep-import\\.ts$/ }, asked("2nd", ${fails}));
        build.onLoad({ filter: /dep-import\\.ts$/ }, asked("3rd", () => {}));
      `;
      const entry = `
        await import("./dep-import.ts").catch(error => console.log(error.message));
        console.log(globalThis.asked.join());
      `;
      expect(await run(setup, { "entry.ts": entry })).toEqual({
        stdout: ["from the 2nd", "1st import,2nd import"],
        stderr: "",
        exitCode: 0,
      });
    }
  });

  // What is thrown is all that happens: nothing is loaded, and nothing is rejected, once the promise is settled.
  it("later than require() can wait for leaves nothing behind", async () => {
    const setup = `
      globalThis.promises = [];
      build.onLoad({ filter: /(dep-require|syntax-error)\\.ts$/ }, asked("only", () => {
        promises.push((async () => { await 0; })());
        return promises.at(-1);
      }));
    `;
    const entry = `
      for (const specifier of ["./dep-require.ts", "./syntax-error.ts"])
        try { require(specifier); } catch (error) { console.log(error.name); }
      await Promise.all(promises);
      console.log(Object.keys(require.cache).filter(key => /dep-require|syntax-error/.test(key)));
    `;
    expect(await run(setup, { "entry.ts": entry, "syntax-error.ts": "export default (;" })).toEqual({
      stdout: ["TypeError", "TypeError", "[]"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("keeps the type the file is imported with", async () => {
    const setup = `build.onLoad({ filter: /dep-.*\\.ts$/ }, asked("only", process.env.PENDING ? async () => { await 0; } : () => {}));`;
    const entry = `
      import statement from "./dep-statement.ts" with { type: "text" };
      console.log(statement);
      console.log((await import("./dep-import.ts", { with: { type: "text" } })).default);
      console.log((await import("./dep-import.ts")).default);
    `;
    for (const PENDING of [undefined, "1"]) {
      using dir = tempDir("plugin-onload-declines-type", {
        ...files,
        "entry.ts": entry,
        "plugin.ts": `function asked(_, callback) { return callback; } Bun.plugin({ name: "declines", setup(build) { ${setup} } });`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--preload", "./plugin.ts", "entry.ts"],
        cwd: String(dir),
        env: { ...bunEnv, PENDING },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: `export default "statement from disk" as string;\nexport default "import from disk" as string;\nimport from disk\n`,
        stderr: "",
        exitCode: 0,
      });
    }
  });

  it("keeps the Bun.ModuleGraph the file is imported into", async () => {
    const setup = `build.onLoad({ filter: /in-graph\\.[cm]js$/ }, asked("only", async () => { await 0; }));`;
    const entry = `
      const graph = new Bun.ModuleGraph();
      console.log((await graph.import(import.meta.dir + "/in-graph.cjs")).default);
      console.log((await graph.import(import.meta.dir + "/in-graph.mjs")).default);
      console.log(Object.keys(require.cache).filter(key => key.includes("in-graph")));
    `;
    const extra = {
      "entry.ts": entry,
      "in-graph.cjs": `module.exports = "CommonJS";`,
      "in-graph.mjs": `export default "ES module";`,
    };
    expect(await run(setup, extra)).toEqual({ stdout: ["CommonJS", "ES module", "[]"], stderr: "", exitCode: 0 });
  });

  // Only the request that waits holds on to them.
  it("has the callbacks that matched asked after Bun.plugin.clearAll() and a collection", async () => {
    const setup = `
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("1st", async () => {
        Bun.plugin.clearAll();
        await Bun.sleep(1);
        Bun.gc(true);
      }));
      for (const name of ["2nd", "3rd"])
        build.onLoad({ filter: /dep-import\\.ts$/ }, asked(name, async () => {
          await Bun.sleep(1);
          Bun.gc(true);
        }));
      build.onLoad({ filter: /dep-import\\.ts$/ }, asked("4th", () => ({ exports: { default: Buffer.alloc(64, "4").toString() }, loader: "object" })));
    `;
    const entry = `
      console.log((await import("./dep-import.ts")).default);
      console.log((await import("./dep-require.ts")).default);
      console.log(globalThis.asked.join());
    `;
    expect(await run(setup, { "entry.ts": entry })).toEqual({
      stdout: [Buffer.alloc(64, "4").toString(), "require from disk", "1st import,2nd import,3rd import,4th import"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("leaves a builtin to be loaded under bun test, where plugins are asked about builtins", async () => {
    const setup = `
      build.onLoad({ filter: /.*/, namespace: "node" }, asked("sync", () => {}));
      build.onLoad({ filter: /.*/, namespace: "node" }, asked("pending", async () => { await 0; }));
    `;
    const test = `
      import { expect, test } from "bun:test";
      import { escape } from "node:querystring";
      test("builtins", async () => {
        expect(escape("a b")).toBe("a%20b");
        expect((await import("node:zlib")).gzipSync).toBeFunction();
        expect(globalThis.asked).toEqual(["sync querystring", "pending querystring", "sync zlib", "pending zlib"]);
      });
    `;
    const { stderr, exitCode } = await run(setup, { "builtins.test.ts": test }, [
      "test",
      "--preload",
      "./plugin.ts",
      "./builtins.test.ts",
    ]);
    expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  it("in a namespace leaves nothing to load", async () => {
    const setup = `build.onLoad({ filter: /.*/, namespace: "declined" }, asked("only", ({ path }) => (path === "pending" ? Bun.sleep(1) : undefined)));`;
    const entry = `
      for (const specifier of ["declined:sync", "declined:pending"])
        await import(specifier).catch(error => console.log(error.message));
    `;
    expect(await run(setup, { "entry.ts": entry })).toEqual({
      stdout: [`ENOENT reading "declined:sync"`, `ENOENT reading "declined:pending"`],
      stderr: "",
      exitCode: 0,
    });
  });
});

// A file that no onLoad serves is transpiled off the main thread, so microtasks alone do not finish its import().
describe.concurrent("a graph of modules is loaded the way it is without plugins", () => {
  // Module i imports 3i+1, 3i+2 and 3i+3. Its value is i plus theirs.
  const count = 40;
  const children = (i: number) => [3 * i + 1, 3 * i + 2, 3 * i + 3].filter(child => child < count);
  const source = (i: number, own: number) =>
    children(i)
      .map(child => `import { value as v${child} } from "./m${child}";\n`)
      .join("") + `export const value: number = ${[own, ...children(i).map(child => "v" + child)].join(" + ")};\n`;
  const total = (own: (i: number) => number) => Array.from({ length: count }, (_, i) => own(i)).reduce((a, b) => a + b);
  const modules = Object.fromEntries(Array.from({ length: count }, (_, i) => [`src/m${i}.ts`, source(i, i)]));
  const serve = `
    const source = ${source}, children = ${children}, count = ${count};
    function serve(path) {
      const i = Number(/m(\\d+)\\.ts$/.exec(path)[1]);
      return i % 4 === 0 ? { contents: source(i, i + 1000), loader: "ts" } : undefined;
    }
  `;
  const fromDisk = total(i => i);
  const someServed = total(i => (i % 4 === 0 ? i + 1000 : i));
  const loadedOffThread = (file: string) => `
    let loaded = false;
    const promise = import("./${file}").then(() => { loaded = true; });
    for (let i = 0; i < 10_000; i++) await undefined;
    const byMicrotasksAlone = loaded;
    await promise;
  `;

  describe.each([
    ["only an onResolve", `build.onResolve({ filter: /\\.never$/ }, () => {});`, fromDisk],
    ["an onLoad whose filter matches nothing", `build.onLoad({ filter: /\\.never$/ }, () => {});`, fromDisk],
    ["an onLoad that declines every file", `build.onLoad({ filter: /\\.ts$/ }, () => {});`, fromDisk],
    [
      "an onLoad that declines every file with a promise that is pending",
      `build.onLoad({ filter: /\\.ts$/ }, async () => { await 0; });`,
      fromDisk,
    ],
    [
      "an onLoad that serves some files",
      serve + `build.onLoad({ filter: /m\\d+\\.ts$/ }, ({ path }) => serve(path));`,
      someServed,
    ],
    [
      "an onLoad that serves some files with a promise that is pending",
      serve + `build.onLoad({ filter: /m\\d+\\.ts$/ }, async ({ path }) => { await 0; return serve(path); });`,
      someServed,
    ],
  ])("with %s", (_, setup, expected) => {
    const names = ["a", "b", "c"];
    const files = {
      ...modules,
      "plugin.ts": `Bun.plugin({ name: "plugin", setup(build) { ${setup} } });`,
      "late.ts": `export {};`,
      "entry.ts": `
        import { value } from "./src/m0";
        ${loadedOffThread("late.ts")}
        console.log(JSON.stringify({ value, byMicrotasksAlone, loaded }));
      `,
      // (Each its own: --isolate keeps what one file has loaded for the next.)
      ...Object.fromEntries(names.map(name => [`late-${name}.ts`, `export {};`])),
      ...Object.fromEntries(
        names.map(name => [
          `${name}.test.ts`,
          `
            import { expect, test } from "bun:test";
            import { value } from "./src/m0";
            test("${name}", async () => {
              ${loadedOffThread(`late-${name}.ts`)}
              expect({ value, byMicrotasksAlone, loaded }).toEqual({ value: ${expected}, byMicrotasksAlone: false, loaded: true });
            });
          `,
        ]),
      ),
    };
    async function run(args: string[]) {
      using dir = tempDir("plugin-onload-graph", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    it("in a script", async () => {
      expect(await run(["--preload", "./plugin.ts", "entry.ts"])).toEqual({
        stdout: JSON.stringify({ value: expected, byMicrotasksAlone: false, loaded: true }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it.each([[[]], [["--isolate"]], [["--parallel=2"]]])("in bun test %j", async flags => {
      const { stderr, exitCode } = await run(["test", "--preload", "./plugin.ts", ...flags]);
      expect(stderr).toContain(" 3 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent("onResolve is asked about a specifier with no extension and no namespace", () => {
  async function run(files: Record<string, string>, args: string[]) {
    using dir = tempDir("plugin-onresolve-every-specifier", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), stderr, exitCode };
  }

  const alias = {
    "preload.ts": `
      import { plugin } from "bun";
      plugin({ name: "alias", setup(b) { b.onResolve({ filter: /^aliased$/ }, () => ({ path: import.meta.dir + "/target.ts" })); } });
    `,
    "target.ts": `export const which = "the target";`,
    "script.ts": `console.log((await import("aliased")).which);`,
    "x.test.ts": `
      import { expect, test } from "bun:test";
      test("alias", async () => {
        expect((await import("aliased")).which).toBe("the target");
      });
    `,
  };
  it("in a script", async () => {
    expect(await run(alias, ["--preload", "./preload.ts", "script.ts"])).toEqual({
      stdout: ["the target"],
      stderr: "",
      exitCode: 0,
    });
  });
  it("in bun test", async () => {
    const { stderr, exitCode } = await run(alias, ["test", "--preload", "./preload.ts", "x.test.ts"]);
    expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  const specifiers = ["aliased", "@/aliased", "@scope/aliased", "./relative-no-ext", "../up", "/absolute/no-ext"];
  const targets = ["bare", "at", "scoped", "relative", "up", "absolute"];
  const files = {
    ...Object.fromEntries(targets.map(target => [`targets/${target}.ts`, `export default "${target}";`])),
    "plugin.ts": `
      const targets = ${JSON.stringify(Object.fromEntries(specifiers.map((specifier, i) => [specifier, targets[i]])))};
      Bun.plugin({
        name: "aliases",
        setup(build) {
          build.onResolve({ filter: /aliased$|no-ext$|^\\.\\.\\/up$/ }, ({ path, importer }) => {
            console.log("onResolve", path, "from", importer.slice(import.meta.dir.length + 1).replaceAll("\\\\", "/"));
            return { path: import.meta.dir + "/targets/" + targets[path] + ".ts" };
          });
        },
      });
    `,
  };
  const S = `const S = ${JSON.stringify(specifiers)};\nconst name = path => require("node:path").basename(path);\n`;
  it.each([
    [
      "an import statement",
      "entry.mjs",
      specifiers.map((specifier, i) => `import $${i} from "${specifier}";\n`).join("") +
        `console.log([${specifiers.map((_, i) => "$" + i)}].join());`,
      targets.join(),
    ],
    [
      "export from",
      "entry.mjs",
      specifiers.map((specifier, i) => `export { default as $${i} } from "${specifier}";\n`).join("") +
        `import * as self from "./entry.mjs";\nconsole.log(Object.values(self).join());`,
      targets.join(),
    ],
    ["import()", "entry.mjs", S + `for (const s of S) console.log((await import(s)).default);`, null],
    ["require()", "entry.cjs", S + `for (const s of S) console.log(require(s).default);`, null],
    ["module.require()", "entry.cjs", S + `for (const s of S) console.log(module.require(s).default);`, null],
    ["import.meta.require()", "entry.mjs", S + `for (const s of S) console.log(import.meta.require(s).default);`, null],
    ["require.resolve()", "entry.cjs", S + `for (const s of S) console.log(name(require.resolve(s), ".ts"));`, ".ts"],
    [
      "require.resolve() with paths",
      "entry.cjs",
      S + `for (const s of S) console.log(name(require.resolve(s, { paths: ["/not/there"] })));`,
      ".ts",
    ],
    ["import.meta.resolve()", "entry.mjs", S + `for (const s of S) console.log(name(import.meta.resolve(s)));`, ".ts"],
    [
      "import.meta.resolveSync()",
      "entry.mjs",
      S + `for (const s of S) console.log(name(import.meta.resolveSync(s)));`,
      ".ts",
    ],
    [
      "Bun.resolveSync()",
      "entry.mjs",
      S + `for (const s of S) console.log(name(Bun.resolveSync(s, import.meta.dir)));`,
      ".ts",
    ],
    [
      "Bun.resolve()",
      "entry.mjs",
      S + `for (const s of S) console.log(name(await Bun.resolve(s, import.meta.dir)));`,
      ".ts",
    ],
  ])("once, by %s", async (_, name, source, expected) => {
    // Bun.resolveSync() and Bun.resolve() are given a directory.
    const importer = source.includes("import.meta.dir") ? "src/sub" : "src/sub/" + name;
    const asked = specifiers.map(specifier => `onResolve ${specifier} from ${importer}`);
    expect(
      await run({ ...files, ["src/sub/" + name]: source }, ["--preload", "./plugin.ts", "src/sub/" + name]),
    ).toEqual({
      stdout:
        expected === null || expected === ".ts"
          ? specifiers.flatMap((_, i) => [asked[i], targets[i] + (expected ?? "")])
          : [...asked, expected],
      stderr: "",
      exitCode: 0,
    });
  });

  it("and import.meta.resolve() of a path answers what it does without plugins when onResolve declines", async () => {
    const source = `
      Bun.plugin({ name: "declines", setup(build) { build.onResolve({ filter: /.*/ }, ({ path }) => { console.log("onResolve", path); }); } });
      for (const specifier of ["./not-there", "../not-there.js", "/not/there", "file:///not/there.js"])
        console.log(import.meta.resolve(specifier).replace(Bun.pathToFileURL(import.meta.dir).href, "file://<dir>"));
    `;
    expect(await run({ "src/entry.mjs": source }, ["src/entry.mjs"])).toEqual({
      stdout: [
        "onResolve ./not-there",
        "file://<dir>/not-there",
        "onResolve ../not-there.js",
        expect.stringMatching(/^file:.*\/not-there\.js$/),
        "onResolve /not/there",
        expect.stringMatching(/^file:\/\/\/(\w:\/)?not\/there$/),
        expect.stringMatching(/^onResolve (\w:)?[\\/]not[\\/]there\.js$/),
        "file:///not/there.js",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  it("once when its answer matches its own filter", async () => {
    const files = {
      "node_modules/my-pkg/package.json": `{ "name": "my-pkg", "main": "index.js" }`,
      "node_modules/my-pkg/index.js": `module.exports = "my-pkg";`,
      "node_modules/my-pkg/dist/index.js": `module.exports = "my-pkg/dist";`,
      "plugin.ts": `
        Bun.plugin({ name: "dist", setup(build) { build.onResolve({ filter: /^my-pkg/ }, ({ path }) => (console.log("onResolve", path), { path: path + "/dist" })); } });
      `,
      "entry.mjs": `
        import statement from "my-pkg";
        console.log(statement, (await import("my-pkg")).default, import.meta.require("my-pkg"));
      `,
    };
    expect(await run(files, ["--preload", "./plugin.ts", "entry.mjs"])).toEqual({
      stdout: ["onResolve my-pkg", "onResolve my-pkg", "onResolve my-pkg", "my-pkg/dist my-pkg/dist my-pkg/dist"],
      stderr: "",
      exitCode: 0,
    });
  });

  // As in the documentation of onLoad.
  it("and can move it into a namespace", async () => {
    const source = `
      Bun.plugin({
        name: "env plugin",
        setup(build) {
          build.onResolve({ filter: /^env$/ }, args => ({ path: args.path, namespace: "env" }));
          build.onLoad({ filter: /env/, namespace: "env" }, () => ({
            contents: "export default " + JSON.stringify({ FOO: process.env.FOO }),
            loader: "js",
          }));
        },
      });
      console.log((await import("env")).default.FOO, require("env").default.FOO, require.resolve("env"));
    `;
    using dir = tempDir("plugin-onresolve-env", { "entry.ts": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      cwd: String(dir),
      env: { ...bunEnv, FOO: "bar" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "bar bar env:env\n", stderr: "", exitCode: 0 });
  });

  const packages = {
    "node_modules/dep-pkg/package.json": `{ "name": "dep-pkg", "main": "main.js" }`,
    "node_modules/dep-pkg/main.js": `module.exports = "dep-pkg";`,
    "lib/foo.js": `module.exports = "lib/foo";`,
    "index.js": `module.exports = "index";`,
    "sub/index.js": `module.exports = "sub/index";`,
  };

  it("and answering with what it was asked about changes nothing", async () => {
    const files = {
      ...packages,
      "plugin.ts": `
        globalThis.asked = [];
        Bun.plugin({ name: "no-op", setup(build) { build.onResolve({ filter: /.*/ }, ({ path }) => (asked.push(path.replace(import.meta.dir, "").replaceAll("\\\\", "/")), { path })); } });
      `,
      "sub/entry.cjs": `
        asked.length = 0;
        for (const specifier of ["dep-pkg", "..", ".", "./", "../", "../lib/foo", require("node:path").join(__dirname, "../lib/foo"), "not-there", "./not-there", "...", " "])
          try { console.log(require(specifier)); } catch (error) { console.log(error.message.split("\\n")[0]); }
        import("dep-pkg").then(({ default: dep }) => console.log(dep, JSON.stringify(asked)));
      `,
    };
    expect(await run(files, ["--no-install", "--preload", "./plugin.ts", "sub/entry.cjs"])).toEqual({
      stdout: [
        "dep-pkg",
        "index",
        "sub/index",
        "sub/index",
        "index",
        "lib/foo",
        "lib/foo",
        "Cannot find module 'not-there'",
        "Cannot find module './not-there'",
        "Cannot find module '...'",
        "Cannot find module ' '",
        "dep-pkg " +
          JSON.stringify([
            ...["dep-pkg", "..", ".", "./", "../", "../lib/foo", "/lib/foo", "not-there", "./not-there", "...", " "],
            "dep-pkg",
          ]),
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  it("but not about the name of a builtin", async () => {
    const files = {
      ...packages,
      "plugin.ts": `
        Bun.plugin({ name: "logs", setup(build) { build.onResolve({ filter: /.*/ }, ({ path }) => { console.log("onResolve", path); }); } });
      `,
      "entry.mjs": `
        import fs from "fs";
        import { sleep } from "bun";
        console.log("loaded");
        require("os"); await import("path");
        console.log(["fs", "fs/promises", "ws", "undici", "bun", "node:fs", "bun:jsc"].map(name => require.resolve(name)).join());
        await import("node:os"); require("bun:jsc");
        console.log(import.meta.resolve("path"), Bun.resolveSync("zlib", import.meta.dir));
        console.log(require("dep-pkg"));
      `,
    };
    const { stdout, stderr, exitCode } = await run(files, ["--preload", "./plugin.ts", "entry.mjs"]);
    expect({ stdout: stdout.slice(1), stderr, exitCode }).toEqual({
      // (After the entry point.)
      stdout: [
        "loaded",
        "fs,fs/promises,ws,undici,bun,node:fs,bun:jsc",
        "node:path node:zlib",
        "onResolve dep-pkg",
        "dep-pkg",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  // A catch-all that loads a package when it is first called would be called about that package, and so on.
  it("but not about what a callback, or a package it calls, loads while it runs", async () => {
    const files = {
      ...packages,
      "node_modules/helper-pkg/package.json": `{ "name": "helper-pkg", "main": "index.js" }`,
      "node_modules/helper-pkg/index.js": `let lazy; exports.help = path => (lazy ??= require("./lib/lazy"))(path);`,
      "node_modules/helper-pkg/lib/lazy.js": `module.exports = path => (path === "aliased" ? { path: "dep-pkg" } : undefined);`,
      "plugin.ts": `
        Bun.plugin({
          name: "catch-all",
          setup(build) {
            build.onResolve({ filter: /.*/ }, ({ path }) => {
              console.log("onResolve", path);
              return require("helper-pkg").help(path);
            });
          },
        });
      `,
      "entry.cjs": `console.log(require("aliased"), require("./lib/foo"), require("helper-pkg").help("aliased").path);`,
    };
    const { stdout, stderr, exitCode } = await run(files, ["--preload", "./plugin.ts", "entry.cjs"]);
    expect({ stdout: stdout.slice(1), stderr, exitCode }).toEqual({
      stdout: ["onResolve aliased", "onResolve ./lib/foo", "onResolve helper-pkg", "dep-pkg lib/foo dep-pkg"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("and what a callback resolves is apart from the paths of the require.resolve() that asks", async () => {
    const files = {
      ...packages,
      "x.js": ``,
      "other/x.js": ``,
      "other/node_modules/only-there/package.json": `{ "name": "only-there", "main": "main.js" }`,
      "other/node_modules/only-there/main.js": ``,
      "plugin.ts": `
        const short = path => path.slice(import.meta.dir.length + 1).replaceAll("\\\\", "/");
        Bun.plugin({
          name: "resolves",
          setup(build) {
            build.onResolve({ filter: /^(\\.\\/x|\\.\\/x\\.js|only-there)$/ }, ({ path }) => {
              console.log("onResolve", path, short(require.resolve("./x")), short(require.resolve("./foo", { paths: [import.meta.dir + "/lib"] })));
            });
          },
        });
      `,
      "entry.cjs": `
        const short = path => path.slice(__dirname.length + 1).replaceAll("\\\\", "/");
        for (const specifier of ["./x", "./x.js", "only-there"])
          console.log(short(require.resolve(specifier, { paths: [__dirname + "/other"] })));
      `,
    };
    expect(await run(files, ["--preload", "./plugin.ts", "entry.cjs"])).toEqual({
      stdout: [
        "onResolve ./x x.js lib/foo.js",
        "other/x.js",
        "onResolve ./x.js x.js lib/foo.js",
        "other/x.js",
        "onResolve only-there x.js lib/foo.js",
        "other/node_modules/only-there/main.js",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  it("in the namespace that is its prefix, then in the namespace file as it is written", async () => {
    const source = `
      Bun.plugin({
        name: "namespaces",
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "other" }, ({ path }) => { console.log("other", path); });
          build.onResolve({ filter: /.*/, namespace: "file" }, ({ path }) => { console.log("file", path); });
        },
      });
      for (const specifier of ["bare", "./relative", "other:bare", "file:bare"])
        await import(specifier).catch(() => {});
    `;
    expect(await run({ "entry.mjs": source }, ["--no-install", "entry.mjs"])).toEqual({
      stdout: ["file bare", "file ./relative", "other bare", "file other:bare", "file bare"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("with a prefix, by a filter that matches the whole of it", async () => {
    const source = `
      Bun.plugin({
        name: "virtual",
        setup({ onResolve, onLoad }) {
          onResolve({ filter: /^virtual:/ }, ({ path }) => (console.log("onResolve", path), { path, namespace: "v" }));
          onLoad({ filter: /.*/, namespace: "v" }, ({ path }) => ({ exports: { path }, loader: "object" }));
        },
      });
      console.log((await import("virtual:thing")).path, require("virtual:other.js").path, require.resolve("virtual:thing"));
    `;
    expect(await run({ "entry.ts": source }, ["entry.ts"])).toEqual({
      stdout: [
        "onResolve virtual:thing",
        "onResolve virtual:other.js",
        "onResolve virtual:thing",
        "virtual:thing virtual:other.js v:virtual:thing",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  it("that names a package or a path in it", async () => {
    const source = `
      Bun.plugin({
        name: "intercept",
        setup(build) {
          build.onResolve({ filter: /^@somemodule\\/foo(\\/.*)?$/ }, args => ({ path: args.path, namespace: "host" }));
          build.onLoad({ filter: /.*/, namespace: "host" }, args => ({ exports: { path: args.path }, loader: "object" }));
        },
      });
      console.log((await import("@somemodule/foo")).path, (await import("@somemodule/foo/bar")).path);
    `;
    expect(await run({ "entry.ts": source }, ["entry.ts"])).toEqual({
      stdout: ["@somemodule/foo @somemodule/foo/bar"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("again after a callback has thrown", async () => {
    const source = `
      Bun.plugin({
        name: "throws",
        setup(build) {
          build.onResolve({ filter: /^throws$/ }, () => { throw new Error("from onResolve"); });
          build.onResolve({ filter: /^aliased$/ }, () => ({ path: "./target" }));
        },
      });
      try { require("throws"); } catch (error) { console.log(error.message); }
      console.log(require("aliased"));
    `;
    expect(await run({ "entry.cjs": source, "target.js": `module.exports = "the target";` }, ["entry.cjs"])).toEqual({
      stdout: ["from onResolve", "the target"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("and can answer with a file it has just written", async () => {
    const source = `
      import { writeFileSync } from "node:fs";
      // The directory is read while the files are not there.
      await import("./generated/not-there").catch(() => {});
      Bun.plugin({
        name: "generates",
        setup(build) {
          build.onResolve({ filter: /^generated\\// }, ({ path }) => {
            writeFileSync(import.meta.dir + "/" + path + ".ts", "export default " + JSON.stringify(path));
            return { path: import.meta.dir + "/" + path };
          });
        },
      });
      console.log((await import("generated/a")).default, require("generated/b").default);
    `;
    expect(await run({ "entry.ts": source, "generated/.keep": "" }, ["entry.ts"])).toEqual({
      stdout: ["generated/a generated/b"],
      stderr: "",
      exitCode: 0,
    });
  });
});

// Files are transpiled off the main thread, where there are no plugins. A macro is a module that plugins can serve.
describe.concurrent("a macro called in a file that is not the entry point", () => {
  const files = {
    "macro.ts": `export function macro() { return "macro.ts"; }`,
    "other-macro.ts": `export function macro() { return "other-macro.ts"; }`,
    "imports-alias.ts": `import aliased from "aliased"; export function macro() { return "imports " + aliased; }`,
    "target.ts": `export default "the target";`,
    "macro.custom": `not JavaScript`,
    "calls-plain.ts": `import { macro } from "./macro.ts" with { type: "macro" }; export default macro();`,
    "calls-custom.ts": `import { macro } from "./macro.custom" with { type: "macro" }; export default macro();`,
    "calls-redirected.ts": `import { macro } from "./redirected-macro.ts" with { type: "macro" }; export default macro();`,
    "redirected-macro.ts": `export function macro() { return "redirected-macro.ts"; }`,
    "calls-alias.ts": `import { macro } from "./imports-alias.ts" with { type: "macro" }; export default macro();`,
    "plugin.ts": `
      Bun.plugin({
        name: "plugin",
        setup(build) {
          build.onLoad({ filter: /\\.custom$/ }, () => ({ contents: "export function macro() { return 'served by onLoad'; }", loader: "js" }));
          build.onResolve({ filter: /redirected-macro\\.ts$/ }, () => ({ path: import.meta.dir + "/other-macro.ts" }));
          build.onResolve({ filter: /^aliased$/ }, () => ({ path: import.meta.dir + "/target.ts" }));
        },
      });
    `,
  };
  const cases = [
    ["that no plugin is about", "plain", "macro.ts"],
    ["that an onLoad serves", "custom", "served by onLoad"],
    ["that an onResolve redirects", "redirected", "other-macro.ts"],
    ["that imports what an onResolve answers about", "alias", "imports the target"],
  ];
  async function run(extra: Record<string, string>, args: string[]) {
    using dir = tempDir("plugin-macro", { ...files, ...extra });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // (A debug build logs the calls.)
    return { stdout: stdout.replace(/^\[macro\].*\n/gm, ""), stderr, exitCode };
  }

  it.each(cases)("%s, in a script", async (_, name, expected) => {
    const entry = `
      import statement from "./calls-${name}.ts";
      console.log(statement, (await import("./calls-${name}.ts?again")).default);
    `;
    expect(await run({ "entry.ts": entry }, ["--preload", "./plugin.ts", "entry.ts"])).toEqual({
      stdout: `${expected} ${expected}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([[[]], [["--isolate"]], [["--parallel=2"]]])("in bun test %j", async flags => {
    const tests = Object.fromEntries(
      ["a", "b"].map(file => [
        `${file}.test.ts`,
        `
          import { expect, test } from "bun:test";
          ${cases.map(([, name]) => `import ${name} from "./calls-${name}.ts";`).join("\n")}
          test("${file}", () => {
            expect([${cases.map(([, name]) => name)}]).toEqual(${JSON.stringify(cases.map(([, , expected]) => expected))});
          });
        `,
      ]),
    );
    const { stderr, exitCode } = await run(tests, ["test", "--preload", "./plugin.ts", ...flags]);
    expect(stderr).toContain(" 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  it("is an error, said once, when macros are disabled", async () => {
    const entry = `await import("./calls-plain.ts").catch(error => console.log(error.message));`;
    expect(await run({ "entry.ts": entry }, ["--no-macros", "--preload", "./plugin.ts", "entry.ts"])).toEqual({
      stdout: "Macros are disabled\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

it.concurrent(
  "a syntax error in a file that is not the entry point is reported once with a plugin registered",
  async () => {
    using dir = tempDir("plugin-syntax-error", {
      "plugin.ts": `Bun.plugin({ name: "plugin", setup(build) { build.onLoad({ filter: /\\.ts$/ }, () => {}); } });`,
      "syntax-error.ts": `export default (;\n`,
      "entry.ts": `
      await import("./syntax-error.ts").catch(error => console.log(error.name, error.message, error.position.line, error.position.column));
      await import("./syntax-error.ts");
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./plugin.ts", "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout,
      stderr: stderr.replaceAll(String(dir), "<dir>").replaceAll("\\", "/").split("\n\nBun v")[0],
      exitCode,
    }).toEqual({
      stdout: "BuildMessage Unexpected ; 1 17\n",
      stderr: `1 | export default (;\n                    ^\nerror: Unexpected ;\n    at <dir>/syntax-error.ts:1:17`,
      exitCode: 1,
    });
  },
);

describe.concurrent("what a plugin supplies as contents is loaded like a file that holds it", () => {
  // [loader, extension of a file of that type, contents, what import() gives, what require() gives]
  const object = { a: 1, b: { c: 2 } };
  const cases: Record<string, [string, string, string, unknown, unknown]> = {
    "an ES module": [
      "js",
      "js",
      `export const a = 1; export default { b: 2 };`,
      { a: 1, default: { b: 2 } },
      { a: 1, default: { b: 2 } },
    ],
    "a CommonJS module": [
      "js",
      "js",
      `module.exports = { a: 1, b: { c: 2 } };`,
      { ...object, default: object },
      object,
    ],
    "a CommonJS module that exports a function": [
      "js",
      "cjs",
      `module.exports = function f() {}; module.exports.x = 1;`,
      { default: "function f", length: 0, name: "f", prototype: {}, x: 1 },
      "function f",
    ],
    "JSX": [
      "jsx",
      "jsx",
      `/** @jsxRuntime classic */ /** @jsx h */ const h = tag => tag; export default <div />;`,
      { default: "div" },
      { default: "div" },
    ],
    "TypeScript": [
      "ts",
      "ts",
      `export const a: number = 1; export default { b: 2 } as object;`,
      { a: 1, default: { b: 2 } },
      { a: 1, default: { b: 2 } },
    ],
    "TypeScript that is CommonJS": [
      "ts",
      "cts",
      `const a: number = 1; module.exports = { a };`,
      { a: 1, default: { a: 1 } },
      { a: 1 },
    ],
    "TSX": [
      "tsx",
      "tsx",
      `/** @jsxRuntime classic */ /** @jsx h */ const h = (tag: string) => tag; export default <div />;`,
      { default: "div" },
      { default: "div" },
    ],
    "a JSON object": [
      "json",
      "json",
      `{"a":1,"b":{"c":2},"default":3}`,
      { ...object, default: { ...object, default: 3 } },
      { ...object, default: 3 },
    ],
    "a JSON array": ["json", "json", `[1,2,3]`, { __esModule: true, default: [1, 2, 3] }, [1, 2, 3]],
    "a JSON string": ["json", "json", `"string"`, { __esModule: true, default: "string" }, "string"],
    "JSON that is empty": [
      "json",
      "json",
      ``,
      "SyntaxError: JSON Parse error: Unexpected EOF",
      "SyntaxError: JSON Parse error: Unexpected EOF",
    ],
    "JSON that is cut short": [
      "json",
      "json",
      `{"a":`,
      "SyntaxError: JSON Parse error: Unexpected EOF",
      "SyntaxError: JSON Parse error: Unexpected EOF",
    ],
    "JSONC": ["jsonc", "jsonc", `{ // comment\n"a":1,"b":{"c":2}, }`, { ...object, default: object }, object],
    "JSON5": ["json5", "json5", `{ a: 1, b: { c: 2 }, }`, { ...object, default: object }, object],
    "TOML": ["toml", "toml", `a = 1\n[b]\nc = 2\n`, { ...object, default: object }, object],
    "TOML that is not valid": [
      "toml",
      "toml",
      `\na = = 1`,
      "BuildMessage: Expected a value but found '=' at 2:5",
      "BuildMessage: Expected a value but found '=' at 2:5",
    ],
    "YAML": ["yaml", "yaml", `a: 1\nb:\n  c: 2\n`, { ...object, default: object }, object],
    "a YAML sequence": ["yaml", "yaml", `- 1\n- 2\n`, { __esModule: true, default: [1, 2] }, [1, 2]],
    "XML": [
      "xml",
      "xml",
      `<a><b c="2">t</b></a>`,
      { a: { b: { "@c": "2", "#text": "t" } }, default: { a: { b: { "@c": "2", "#text": "t" } } } },
      { a: { b: { "@c": "2", "#text": "t" } } },
    ],
    "text": ["text", "txt", `hello\nwörld`, { default: "hello\nwörld" }, { default: "hello\nwörld" }],
    "Markdown": [
      "md",
      "md",
      `# hi\n\ntext`,
      { default: "<h1>hi</h1>\n<p>text</p>\n" },
      { default: "<h1>hi</h1>\n<p>text</p>\n" },
    ],
    "CSS": ["css", "css", `.a { color: red }`, { __esModule: true, default: {} }, {}],
  };
  const names = Object.keys(cases);
  const slug = (name: string) => name.replaceAll(" ", "-");

  // Each case is loaded from "<way>-<case>.<extension>", a file, and from "<way>-<case>.<extension>.virtual", which is empty.
  const common = `
    const cases = ${JSON.stringify(Object.fromEntries(names.map(name => [slug(name), cases[name].slice(0, 3)])))};
    function supplied(path) {
      const [loader, , contents] = cases[/[\\\\/][a-z]+_([^\\\\/]*?)\\.\\w+\\.virtual$/.exec(path)[1]];
      return { loader, contents };
    }
    function shown(value) {
      return JSON.parse(JSON.stringify(value, (_, value) => (typeof value === "function" ? "function " + value.name : value)) ?? "null");
    }
    function failed(error) {
      return error.name + ": " + error.message + (error.position ? " at " + error.position.line + ":" + error.position.column : "");
    }
    async function load(way, name, suffix) {
      const specifier = "./" + way + "_" + name + "." + cases[name][1] + suffix;
      try {
        return shown(way === "import" ? await import(specifier) : way === "require" ? require(specifier) : import.meta.require(specifier));
      } catch (error) {
        return failed(error).replace(suffix || "\\0", "");
      }
    }
  `;
  const files = Object.fromEntries(
    ["import", "require", "metarequire", "statement"].flatMap(way =>
      names.flatMap(name => {
        const [, extension, contents] = cases[name];
        return [
          [`${way}_${slug(name)}.${extension}`, contents],
          [`${way}_${slug(name)}.${extension}.virtual`, ""],
        ];
      }),
    ),
  );
  async function run(extra: Record<string, string>, args: string[], env: Record<string, string> = {}) {
    using dir = tempDir("plugin-contents", { ...files, ...extra });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const plugin = (callback: string) => `
    ${common}
    Bun.plugin({ name: "supplies", setup(build) { build.onLoad({ filter: /\\.virtual$/ }, ${callback}); } });
  `;
  const sync = plugin(`({ path }) => supplied(path)`);
  const pending = plugin(`async ({ path }) => { await 0; return supplied(path); }`);
  const expected = (index: 3 | 4) => Object.fromEntries(names.map(name => [slug(name), cases[name][index]]));

  it.each([
    ["import()", "import", sync, expected(3)],
    ["import(), with a promise that is pending", "import", pending, expected(3)],
    ["require()", "require", sync, expected(4)],
    ["import.meta.require()", "metarequire", sync, expected(4)],
  ])("by %s", async (_, way, plugin, expected) => {
    const entry = `
      ${plugin}
      const loaded = { file: {}, plugin: {} };
      for (const name in cases) {
        loaded.file[name] = await load("${way}", name, "");
        loaded.plugin[name] = await load("${way}", name, ".virtual");
      }
      console.log(JSON.stringify(loaded));
    `;
    const { stdout, stderr, exitCode } = await run({ "entry.ts": entry }, ["entry.ts"]);
    expect({ loaded: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      loaded: { file: expected, plugin: expected },
      stderr: "",
      exitCode: 0,
    });
  });

  const valid = names.filter(name => typeof cases[name][3] !== "string");
  const statements = (suffix: string) =>
    valid
      .map((name, i) => `import * as $${i} from "./statement_${slug(name)}.${cases[name][1]}${suffix}";\n`)
      .join("") + `const statements = { ${valid.map((name, i) => `${JSON.stringify(slug(name))}: shown($${i})`)} };\n`;
  const expectedStatements = Object.fromEntries(valid.map(name => [slug(name), cases[name][3]]));

  it.each([
    ["", sync],
    [", with a promise that is pending", pending],
  ])("by an import statement%s", async (_, plugin) => {
    const extra = {
      "plugin.ts": plugin + `globalThis.shown = shown;`,
      "entry.ts": statements(".virtual") + `console.log(JSON.stringify(statements));`,
    };
    const { stdout, stderr, exitCode } = await run(extra, ["--preload", "./plugin.ts", "entry.ts"]);
    expect({ loaded: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      loaded: expectedStatements,
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([[[]], [["--isolate"]], [["--parallel=2"]]])("in bun test %j", async flags => {
    const test = (file: string) => `
      import { expect, test } from "bun:test";
      ${statements(".virtual")}
      test("${file}", async () => {
        expect(statements).toEqual(${JSON.stringify(expectedStatements)});
        for (const name in cases) {
          expect([name, await load("import", name, ".virtual")]).toEqual([name, await load("import", name, "")]);
          expect([name, await load("require", name, ".virtual")]).toEqual([name, await load("require", name, "")]);
        }
      });
    `;
    const extra = {
      "plugin.ts": sync + `Object.assign(globalThis, { shown, load, cases });`,
      "a.test.ts": test("a"),
      "b.test.ts": test("b"),
    };
    const { stderr, exitCode } = await run(extra, ["test", "--preload", "./plugin.ts", ...flags]);
    expect(stderr).toContain(" 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  // --isolate keeps the source of what one file has loaded for the next, by path.
  it("and is not taken for the file's by the next test file under --isolate", async () => {
    const extra = {
      "dep.ts": `export default "from disk";`,
      "dep.cjs": `module.exports = "from disk";`,
      "plugin.ts": `
        import { existsSync, writeFileSync } from "node:fs";
        // The preload runs again for each test file.
        if (!existsSync(import.meta.dir + "/served")) {
          writeFileSync(import.meta.dir + "/served", "");
          Bun.plugin({ name: "supplies", setup(build) {
            build.onLoad({ filter: /dep\\.ts$/ }, () => ({ contents: "export default 'from the plugin'", loader: "ts" }));
            build.onLoad({ filter: /dep\\.cjs$/ }, () => ({ contents: "module.exports = 'from the plugin'", loader: "js" }));
          } });
        }
      `,
      "a.test.ts": `
        import esm from "./dep.ts";
        test("a", () => expect([esm, require("./dep.cjs")]).toEqual(["from the plugin", "from the plugin"]));
      `,
      "b.test.ts": `
        import esm from "./dep.ts";
        test("b", () => expect([esm, require("./dep.cjs")]).toEqual(["from disk", "from disk"]));
      `,
    };
    const { stderr, exitCode } = await run(extra, [
      "test",
      "--isolate",
      "--preload",
      "./plugin.ts",
      "./a.test.ts",
      "./b.test.ts",
    ]);
    expect(stderr).toContain(" 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  it("whichever of import() and require() comes first", async () => {
    const entry = `
      ${sync}
      const loaded = {};
      for (const suffix of ["", ".virtual"])
        loaded[suffix || "file"] = {
          json: [await load("import", "a-JSON-object", suffix), await load("require", "a-JSON-object", suffix).then(() => shown(require("./import_a-JSON-object.json" + suffix)))],
          cjs: [shown(require("./require_a-CommonJS-module.js" + suffix)), shown(await import("./require_a-CommonJS-module.js" + suffix)),
                require("./require_a-CommonJS-module.js" + suffix) === (await import("./require_a-CommonJS-module.js" + suffix)).default],
        };
      console.log(JSON.stringify(loaded));
    `;
    const { stdout, stderr, exitCode } = await run({ "entry.ts": entry }, ["entry.ts"]);
    const namespace = { ...object, default: { ...object, default: 3 } };
    const each = { json: [namespace, namespace], cjs: [object, { ...object, default: object }, true] };
    expect({ loaded: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      loaded: { file: each, ".virtual": each },
      stderr: "",
      exitCode: 0,
    });
  });

  it("with the loader of the type it is imported with, unless the plugin names one", async () => {
    const plugin = `
      Bun.plugin({
        name: "supplies",
        setup(build) {
          build.onLoad({ filter: /no-loader-\\d\\.virtual$/ }, () => ({ contents: '{"a":1}' }));
          build.onLoad({ filter: /pending-\\d\\.virtual$/ }, async () => { await 0; return { contents: '{"a":1}' }; });
          build.onLoad({ filter: /named-\\d\\.virtual$/ }, () => ({ contents: '{"a":1}', loader: "json" }));
        },
      });
    `;
    const entry = `
      import json from "./no-loader-1.virtual" with { type: "json" };
      import text from "./no-loader-2.virtual" with { type: "text" };
      console.log(JSON.stringify([
        json,
        text,
        (await import("./no-loader-3.virtual", { with: { type: "jsonc" } })).a,
        (await import("./pending-1.virtual", { with: { type: "json" } })).a,
        (await import("./pending-2.virtual", { with: { type: "text" } })).default,
        (await import("./named-1.virtual", { with: { type: "text" } })).a,
        await import("./no-loader-4.virtual").catch(error => error.name),
      ]));
    `;
    const extra = Object.fromEntries(
      ["no-loader-1", "no-loader-2", "no-loader-3", "no-loader-4", "pending-1", "pending-2", "named-1"].map(name => [
        name + ".virtual",
        "",
      ]),
    );
    const files = { ...extra, "plugin.ts": plugin, "entry.ts": entry };
    expect(await run(files, ["--preload", "./plugin.ts", "entry.ts"])).toEqual({
      stdout: JSON.stringify([{ a: 1 }, '{"a":1}', 1, 1, '{"a":1}', 1, "BuildMessage"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("from build.module() as well", async () => {
    const entry = `
      Bun.plugin({
        name: "modules",
        setup(build) {
          build.module("virtual-json", () => ({ contents: '{"v":1}', loader: "json" }));
          build.module("virtual-toml", () => ({ contents: 'v = 1', loader: "toml" }));
          build.module("virtual-yaml", async () => { await 0; return { contents: "v: 2", loader: "yaml" }; });
          build.module("virtual-cjs", () => ({ contents: "module.exports = { v: 3 };", loader: "js" }));
        },
      });
      console.log(JSON.stringify([
        await import("virtual-json"), require("virtual-toml"), await import("virtual-yaml"), require("virtual-cjs"), await import("virtual-cjs"),
      ]));
    `;
    expect(await run({ "entry.ts": entry }, ["entry.ts"])).toEqual({
      stdout:
        JSON.stringify([
          { default: { v: 1 }, v: 1 },
          { v: 1 },
          { default: { v: 2 }, v: 2 },
          { v: 3 },
          { default: { v: 3 }, v: 3 },
        ]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/39786
  it("when it is the file's own, a CommonJS module", async () => {
    const extra = {
      "target.js": "module.exports.greet = function greet(name) {\n  return `hello ${name}`\n}\n",
      "app.js": `const { greet } = require('./target.js')\n\nconsole.log(greet('world'))\n`,
      "preload.js": `
        const { readFileSync } = require('node:fs')
        Bun.plugin({
          name: 'pass-through-source-hook',
          setup(build) {
            build.onLoad({ filter: /target\\.js$/, namespace: 'file' }, args => ({ loader: 'js', contents: readFileSync(args.path, 'utf8') }))
          }
        })
      `,
    };
    expect(await run(extra, ["--preload", "./preload.js", "./app.js"])).toEqual({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("CommonJS or an ES module by its extension and package.json when nothing in it says", async () => {
    const entry = `
      import { readFileSync } from "node:fs";
      Bun.plugin({ name: "passes through", setup(build) { build.onLoad({ filter: /neutral\\.[cm]?js$/ }, ({ path }) => ({ contents: readFileSync(path, "utf8"), loader: "js" })); } });
      const loaded = {};
      for (const file of ["neutral.js", "neutral.cjs", "neutral.mjs", "commonjs/neutral.js", "commonjs/neutral.mjs", "module/neutral.js", "module/neutral.cjs"])
        loaded[file] = "default" in (await import("./" + file)) ? "CommonJS" : "ES module";
      console.log(JSON.stringify(loaded));
    `;
    const extra = {
      "entry.ts": entry,
      "commonjs/package.json": `{ "type": "commonjs" }`,
      "module/package.json": `{ "type": "module" }`,
      ...Object.fromEntries(
        [
          "neutral.js",
          "neutral.cjs",
          "neutral.mjs",
          "commonjs/neutral.js",
          "commonjs/neutral.mjs",
          "module/neutral.js",
          "module/neutral.cjs",
        ].map(file => [file, `globalThis.loaded = true;`]),
      ),
    };
    const { stdout, stderr, exitCode } = await run(extra, ["entry.ts"]);
    expect({ loaded: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      loaded: {
        "neutral.js": "ES module",
        "neutral.cjs": "CommonJS",
        "neutral.mjs": "ES module",
        "commonjs/neutral.js": "CommonJS",
        "commonjs/neutral.mjs": "ES module",
        "module/neutral.js": "ES module",
        "module/neutral.cjs": "CommonJS",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("whether it is a string or bytes, which are UTF-8", async () => {
    const entry = `
      const text = "é 日本 😀";
      const bytes = () => new Uint8Array(Buffer.from(text));
      const kinds = {
        string: () => text,
        Buffer: () => Buffer.from(text),
        Uint8Array: bytes,
        "part of a Uint8Array": () => new Uint8Array(Buffer.from("xx" + text + "xx")).subarray(2, -2),
        DataView: () => new DataView(bytes().buffer),
        ArrayBuffer: () => bytes().buffer,
        SharedArrayBuffer: () => { const shared = new SharedArrayBuffer(bytes().length); new Uint8Array(shared).set(bytes()); return shared; },
        "an empty ArrayBuffer": () => new ArrayBuffer(0),
      };
      Bun.plugin({ name: "supplies", setup(build) { build.onLoad({ filter: /.*/, namespace: "kind" }, ({ path }) => ({ contents: kinds[path](), loader: "text" })); } });
      const loaded = {};
      for (const kind in kinds) loaded[kind] = (await import("kind:" + kind)).default;
      console.log(JSON.stringify(loaded));
    `;
    const { stdout, stderr, exitCode } = await run({ "entry.ts": entry }, ["entry.ts"]);
    const text = "é 日本 😀";
    expect({ loaded: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      loaded: {
        string: text,
        Buffer: text,
        Uint8Array: text,
        "part of a Uint8Array": text,
        DataView: text,
        ArrayBuffer: text,
        SharedArrayBuffer: text,
        "an empty ArrayBuffer": "",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a CSS module, with the names a file at that path gets", async () => {
    const css = `.title { color: red } .box { composes: title; }`;
    const entry = `console.log(JSON.stringify([require("./a.module.css"), await import("./b.module.css")]));`;
    const fromFile = await run({ "a.module.css": css, "b.module.css": css, "entry.ts": entry }, ["entry.ts"]);
    const fromPlugin = await run(
      {
        "a.module.css": "",
        "b.module.css": "",
        "entry.ts": `Bun.plugin({ name: "css", setup(build) { build.onLoad({ filter: /\\.module\\.css$/ }, () => ({ contents: ${JSON.stringify(css)}, loader: "css" })); } });\n${entry}`,
      },
      ["entry.ts"],
    );
    expect(JSON.parse(fromFile.stdout)[0]).toEqual({
      title: expect.stringMatching(/^title_\w+$/),
      box: expect.stringMatching(/^title_\w+ box_\w+$/),
    });
    expect(fromPlugin).toEqual(fromFile);
  });

  it.each(["file", "napi", "wasm", "html", "sqlite", "dataurl", "base64", "nope", ""])(
    "but not with the loader %j",
    async loader => {
      const entry = `
      Bun.plugin({ name: "supplies", setup(build) { build.onLoad({ filter: /.*/, namespace: "ns" }, () => ({ contents: "", loader: ${JSON.stringify(loader)} })); } });
      await import("ns:import").catch(error => console.log(error.message));
      try { require("ns:require"); } catch (error) { console.log(error.message); }
    `;
      const message = `Expected loader to be one of "js", "jsx", "object", "ts", "tsx", "json", "jsonc", "json5", "toml", "yaml", "xml", "text", "md", or "css"`;
      expect(await run({ "entry.ts": entry }, ["entry.ts"])).toEqual({
        stdout: `${message}\n${message}\n`,
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
