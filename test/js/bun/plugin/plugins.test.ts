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
              path,
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

  expect(() => require("regduring:first")).toThrow();
  expect(require("regduring:second").default).toBe("second");
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
    "dotted.dir/real.js": `export const value = "dotted";`,
    "entry.js": `
      import { join } from "node:path";

      const target = join(import.meta.dir, "real.js");

      Bun.plugin({
        name: "redirect-to-file",
        setup(build) {
          build.onResolve({ filter: /^implicit\\.mod$/ }, () => ({ path: target }));
          build.onResolve({ filter: /^extensionless-package$/ }, () => ({ path: target }));
          build.onResolve({ filter: /^no-extension-(import|require)\\.mod$/ }, () => ({
            path: join(import.meta.dir, "real"),
          }));
          build.onResolve({ filter: /^no-extension-dotted\\.mod$/ }, () => ({
            path: join(import.meta.dir, "dotted.dir", "real"),
          }));
          // Longer than a path can be on every platform: it stays the module key.
          build.onResolve({ filter: /^no-extension-too-long\\.mod$/ }, () => ({
            path: join(import.meta.dir, Buffer.alloc(200_000, "a").toString()),
          }));
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
          extensionlessPackage: await attempt(async () => (await import("extensionless-package")).value),
          noExtensionResultImport: await attempt(async () => (await import("no-extension-import.mod")).value),
          noExtensionResultRequire: await attempt(() => require(["no-extension-require", "mod"].join(".")).value),
          noExtensionResultInDottedDirectory: await attempt(() => require(["no-extension-dotted", "mod"].join(".")).value),
          noExtensionResultTooLong: await attempt(
            () => Bun.resolveSync("no-extension-too-long.mod", import.meta.dir).length - import.meta.dir.length,
          ),
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

  // --no-install: a bare name that no plugin claims must not reach the npm registry.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture catches its own failures, so empty stdout means it crashed.
  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    dynamicImport: "redirected",
    extensionlessPackage: "redirected",
    noExtensionResultImport: "redirected",
    noExtensionResultRequire: "redirected",
    noExtensionResultInDottedDirectory: "dotted",
    noExtensionResultTooLong: 200_001,
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

it.concurrent("onResolve runs for a bare specifier without an extension", async () => {
  using dir = tempDir("plugin-onresolve-bare-specifier", {
    "external.ts": `
      import { value } from "host-package/subpath";
      console.log("static:" + value);
    `,
    "entry.ts": `
      const resolved: string[] = [];
      Bun.plugin({
        name: "host-modules",
        setup(build) {
          build.onResolve({ filter: /^host-package(\\/.*)?$/ }, args => {
            resolved.push(args.path);
            return { path: args.path, namespace: "host" };
          });
          build.onLoad({ filter: /.*/, namespace: "host" }, args => ({
            exports: { value: "from " + args.path },
            loader: "object",
          }));
        },
      });
      const dynamic = await import("host-package/subpath");
      console.log("dynamic:" + dynamic.value);
      console.log("require:" + require("host-package/other").value);
      await import("./external.ts");
      console.log("resolved:" + resolved.join(","));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() || stderr).toBe(
    [
      "dynamic:from host-package/subpath",
      "require:from host-package/other",
      "static:from host-package/subpath",
      "resolved:host-package/subpath,host-package/other,host-package/subpath",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

// `bun test` asks onLoad before the builtin lookup, and the resolved key of a builtin can be bare.
it.concurrent("a file-namespace onLoad does not run for a bare builtin under bun test", async () => {
  using dir = tempDir("plugin-onload-bare-builtin", {
    "preload.ts": `
      import { basename } from "node:path";

      Bun.plugin({
        name: "catch-all",
        setup(build) {
          build.onLoad({ filter: /.*/ }, async args => {
            console.log("onLoad:" + basename(args.path));
            return { contents: await Bun.file(args.path).text(), loader: "ts" };
          });
        },
      });
    `,
    "builtin.test.ts": `
      import { expect, test } from "bun:test";

      test("bare builtins load", async () => {
        expect(typeof require("ws")).toBe("function");
        expect(typeof (await import("undici")).fetch).toBe("function");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preload", "./preload.ts", "builtin.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const loaded = stdout.split(/\r?\n/).filter(line => line.startsWith("onLoad:"));
  expect({ loaded, stderr }).toEqual({
    loaded: ["onLoad:builtin.test.ts"],
    stderr: expect.stringContaining(" 1 pass"),
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

it.concurrent("a catch-all onResolve that returns args.path unchanged is transparent", async () => {
  using dir = tempDir("plugin-onresolve-catch-all-no-op", {
    "node_modules/dep-pkg/package.json": `{ "name": "dep-pkg", "main": "index.js" }`,
    "node_modules/dep-pkg/index.js": `module.exports = { value: "dep-pkg" };`,
    "app/preload.js": `
      Bun.plugin({
        name: "catch-all-no-op",
        setup(build) {
          build.onResolve({ filter: /.*/ }, args => ({ path: args.path }));
        },
      });
    `,
    "node_modules/dotted.pkg/package.json": `{ "name": "dotted.pkg", "main": "index.js" }`,
    "node_modules/dotted.pkg/index.js": `module.exports = { value: "dotted.pkg" };`,
    "app/dep.js": `export const value = "dep";`,
    "app/index.js": `module.exports = { value: "index" };`,
    "app/lib/parent.js": `module.exports = require("..");`,
    "app/config.local/index.js": `module.exports = { value: "config.local" };`,
    "app/entry.js": `
      import pkg from "dep-pkg";
      import { value } from "./dep";

      console.log(
        JSON.stringify({
          staticBare: pkg.value,
          staticRelative: value,
          dynamicBare: (await import(["dep", "pkg"].join("-"))).default.value,
          requireBuiltin: typeof require(["f", "s"].join("")).readFileSync,
          // The common CommonJS shape require(path.join(__dirname, "dep")).
          requireAbsoluteWithoutExtension: require(import.meta.dir + "/dep").value,
          requireParentDirectory: require("./lib/parent").value,
          // A dot in the last segment passes the pre-filter, so the hook saw these before too.
          requireDottedBare: require(["dotted", "pkg"].join(".")).value,
          requireDottedRelativeDirectory: require("./config.local/index").value,
        }),
      );
    `,
  });

  // cwd is the parent of the importer's directory: "./dep" exists only relative to app/entry.js.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./app/preload.js", "app/entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    staticBare: "dep-pkg",
    staticRelative: "dep",
    dynamicBare: "dep-pkg",
    requireBuiltin: "function",
    requireAbsoluteWithoutExtension: "dep",
    requireParentDirectory: "index",
    requireDottedBare: "dotted.pkg",
    requireDottedRelativeDirectory: "config.local",
  });
  expect(exitCode).toBe(0);
});

it.concurrent("an unchanged onResolve result stays the module key when nothing is on disk", async () => {
  using dir = tempDir("plugin-onresolve-file-namespace-virtual", {
    "gen/cfg.js": `export const value = "disk file";`,
    "preload.js": `
      const { join } = require("node:path");
      Bun.plugin({
        name: "file-namespace-virtual",
        setup(build) {
          // Nothing on disk: the unchanged specifier is the module key and onLoad serves it.
          build.onResolve({ filter: /^\\.\\/virtual\\.cfg$/ }, args => ({ path: args.path }));
          // An absolute path without an extension is completed from disk, as before.
          build.onResolve({ filter: /^app\\.cfg$/ }, () => ({ path: join(process.cwd(), "gen", "cfg") }));
          build.onLoad({ filter: /virtual\\.cfg$/ }, args => ({
            contents: "export const value = " + JSON.stringify("virtual:" + args.path.split(/[\\\\/]/).pop()) + ";",
            loader: "js",
          }));
        },
      });
    `,
    "entry.js": `
      import { value as staticRelative } from "./virtual.cfg";
      import { value as staticAbsolute } from "app.cfg";
      console.log(
        JSON.stringify({
          staticRelative,
          dynamicRelative: (await import("./virtual.cfg")).value,
          staticAbsolute,
          requireAbsolute: require("app.cfg").value,
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./preload.js", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    staticRelative: "virtual:virtual.cfg",
    dynamicRelative: "virtual:virtual.cfg",
    staticAbsolute: "disk file",
    requireAbsolute: "disk file",
  });
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/12261
it.concurrent("onResolve sees scoped, bare and extension-less relative specifiers", async () => {
  using dir = tempDir("plugin-onresolve-every-specifier", {
    "node_modules/nested-pkg/dist/package.json": `{ "name": "nested-pkg-dist", "main": "index.js" }`,
    "node_modules/nested-pkg/dist/index.js": `module.exports = { value: "nested-pkg/dist" };`,
    "preload.js": `
      globalThis.seen = [];
      globalThis.nestedCalls = [];
      Bun.plugin({
        name: "every-specifier",
        setup(build) {
          build.onResolve({ filter: /^(host-package|@scope\\/pkg)$/ }, args => ({ path: args.path, namespace: "host" }));
          build.onLoad({ filter: /.*/, namespace: "host" }, ({ path }) => ({
            exports: { value: "host:" + path },
            loader: "object",
          }));
          // Not idempotent: a second call for the same import would ask for "nested-pkg/dist/dist".
          build.onResolve({ filter: /^nested-pkg/ }, args => {
            nestedCalls.push(args.path);
            return { path: args.path + "/dist" };
          });
          // A catch-all that claims nothing stays transparent.
          build.onResolve({ filter: /.*/ }, args => {
            if (!require("node:path").isAbsolute(args.path)) seen.push(args.path);
          });
        },
      });
    `,
    "entry.js": `
      import { value as staticRelative } from "./static-dep";

      async function attempt(fn) {
        try {
          return await fn();
        } catch (error) {
          return "threw: " + error.message;
        }
      }

      console.log(
        JSON.stringify({
          dynamicBare: await attempt(async () => (await import("host-package")).value),
          dynamicScoped: await attempt(async () => (await import("@scope/pkg")).value),
          staticRelative,
          dynamicRelative: await attempt(async () => (await import("./dynamic-dep")).value),
          requireRelative: await attempt(() => require(["./required", "dep"].join("-")).value),
          requireBuiltin: await attempt(() => typeof require(["f", "s"].join("")).readFileSync),
          dynamicBareToBare: await attempt(async () => (await import("nested-pkg")).default.value),
          resolveSync: await attempt(() => Bun.resolveSync("host-package", import.meta.dir)),
          importMetaResolve: await attempt(() => import.meta.resolve("host-package")),
          nestedCalls,
          seen: seen.sort(),
        }),
      );
    `,
    "static-dep.js": `export const value = "static";`,
    "dynamic-dep.js": `export const value = "dynamic";`,
    "required-dep.js": `export const value = "required";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./preload.js", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture catches its own failures, so empty stdout means it crashed.
  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    dynamicBare: "host:host-package",
    dynamicScoped: "host:@scope/pkg",
    staticRelative: "static",
    dynamicRelative: "dynamic",
    requireRelative: "required",
    requireBuiltin: "function",
    dynamicBareToBare: "nested-pkg/dist",
    resolveSync: "host:host-package",
    importMetaResolve: "host:host-package",
    nestedCalls: ["nested-pkg"],
    // One call for each import. A builtin name and a module key do not reach the hook.
    seen: ["./dynamic-dep", "./required-dep", "./static-dep"],
  });
  expect(exitCode).toBe(0);
});

it.concurrent("a relative or bare onResolve result for a bare specifier resolves from the importer", async () => {
  using dir = tempDir("plugin-onresolve-result-from-importer", {
    "node_modules/real-pkg/package.json": `{ "name": "real-pkg", "main": "index.js" }`,
    "node_modules/real-pkg/index.js": `module.exports = { value: "real-pkg" };`,
    "from-cwd.js": `export const value = "from-cwd.js";`,
    "lib/real.js": `export const value = "lib/real.js";`,
    "lib/services/api.js": `export const value = "real api";`,
    "lib/services/__mocks__/api.js": `export const value = "mock api";`,
    "lib/static.js": `
      export { value as staticBareToRelative } from "alias-relative";
      export { value as staticRelativeToRelative } from "./services/api";
    `,
    "lib/preload.js": `
      Bun.plugin({
        name: "redirects",
        setup(build) {
          build.module("virtual-shim", () => ({ exports: { value: "virtual-shim" }, loader: "object" }));
          build.onResolve({ filter: /^alias-pkg$/ }, () => ({ path: "real-pkg" }));
          build.onResolve({ filter: /^alias-relative$/ }, () => ({ path: "./real.js" }));
          build.onResolve({ filter: /^alias-relative-no-ext$/ }, () => ({ path: "./real", namespace: "file" }));
          build.onResolve({ filter: /^\\.\\/services\\/api$/ }, () => ({ path: "./services/__mocks__/api" }));
          // Not a file from the importer: these stay the module key, as before.
          build.onResolve({ filter: /^alias-virtual$/ }, () => ({ path: "virtual-shim" }));
          build.onResolve({ filter: /^alias-cwd$/ }, () => ({ path: "./from-cwd.js" }));
          // Longer than the specifier cap on every platform (Windows allows about 147 KB).
          build.onResolve({ filter: /^alias-too-long$/ }, () => ({ path: "./" + Buffer.alloc(200_000, "a").toString() }));
        },
      });
    `,
    "lib/entry.js": `
      import { relative } from "node:path";
      import { staticBareToRelative, staticRelativeToRelative } from "./static.js";

      async function attempt(fn) {
        try {
          return await fn();
        } catch (error) {
          return "threw: " + error.message;
        }
      }

      console.log(
        JSON.stringify({
          bareToBare: await attempt(async () => (await import("alias-pkg")).value),
          bareToRelative: await attempt(async () => (await import("alias-relative")).value),
          bareToRelativeWithoutExtension: await attempt(async () => (await import("alias-relative-no-ext")).value),
          staticBareToRelative,
          staticRelativeToRelative,
          requireBareToRelative: await attempt(() => require(["alias", "relative"].join("-")).value),
          resolveSync: await attempt(() => relative(import.meta.dir, Bun.resolveSync("alias-relative", import.meta.dir))),
          virtualModule: await attempt(async () => (await import("alias-virtual")).value),
          relativeToCwd: await attempt(async () => (await import("alias-cwd")).value),
          tooLong: await attempt(async () => (await import("alias-too-long")).value).then(message => message.slice(0, 19)),
        }),
      );
    `,
  });

  // cwd is the parent of the importer's directory.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./lib/preload.js", "lib/entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    bareToBare: "real-pkg",
    bareToRelative: "lib/real.js",
    bareToRelativeWithoutExtension: "lib/real.js",
    staticBareToRelative: "lib/real.js",
    staticRelativeToRelative: "mock api",
    requireBareToRelative: "lib/real.js",
    resolveSync: "real.js",
    virtualModule: "virtual-shim",
    relativeToCwd: "from-cwd.js",
    tooLong: "threw: ENAMETOOLONG",
  });
  expect(exitCode).toBe(0);
});

it.concurrent("an onResolve callback can require and resolve modules itself", async () => {
  using dir = tempDir("plugin-onresolve-callback-resolves", {
    "node_modules/dep-pkg/package.json": `{ "name": "dep-pkg", "main": "index.js" }`,
    "node_modules/dep-pkg/index.js": `module.exports = { value: "dep-pkg" };`,
    "node_modules/helper-pkg/package.json": `{ "name": "helper-pkg", "main": "index.js" }`,
    "node_modules/helper-pkg/index.js": `module.exports = { dirname: require("node:path").dirname };`,
    "preload.js": `
      globalThis.calls = [];
      Bun.plugin({
        name: "resolves-bare-names-itself",
        setup(build) {
          build.onResolve({ filter: /^[a-z-]+$/ }, args => {
            // Both of these resolve a bare name while the callback runs.
            const { dirname } = require("helper-pkg");
            calls.push(args.path);
            return { path: require.resolve(args.path, { paths: [dirname(args.importer)] }) };
          });
        },
      });
    `,
    "entry.js": `
      import pkg from "dep-pkg";

      console.log(
        JSON.stringify({
          staticBare: pkg.value,
          // The paths of this call are resolver state, so it does not run the callback.
          resolveWithPaths: require.resolve("dep-pkg", { paths: [import.meta.dir] }) === require.resolve("dep-pkg"),
          calls,
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./preload.js", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    staticBare: "dep-pkg",
    resolveWithPaths: true,
    // The static import and the second require.resolve. "helper-pkg" never appears.
    calls: ["dep-pkg", "dep-pkg"],
  });
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
