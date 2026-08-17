/// <reference types="./plugins" />
import { Loader, plugin } from "bun";
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

// Loaders whose result is a parsed value rather than JavaScript source.
const valueLoaderContents: Record<string, { contents: string; loader?: Loader }> = {
  "json-object": { contents: `{"hello": "world", "nested": {"n": 1}}`, loader: "json" },
  "json-string": { contents: `"hello world"`, loader: "json" },
  "json-array": { contents: `[1, 2, 3]`, loader: "json" },
  "json-invalid": { contents: `{"hello":`, loader: "json" },
  "toml": { contents: `hello = "world"\n[nested]\nn = 1`, loader: "toml" },
  "yaml": { contents: `hello: world\nnested:\n  n: 1`, loader: "yaml" },
  "xml": { contents: `<root><hello>world</hello></root>`, loader: "xml" },
  // No loader: Bun picks it from the specifier's extension.
  "by-extension.json": { contents: `{"hello": "json"}` },
  "by-extension.toml": { contents: `hello = "toml"` },
  "by-extension.yaml": { contents: `hello: yaml` },
};

plugin({
  name: "value loaders",
  setup(builder) {
    builder.onResolve({ filter: /.*/, namespace: "value-loader" }, ({ path }) => ({
      path,
      namespace: "value-loader",
    }));
    // The specifier is "value-loader:<how>/<name>". <how> only keeps the specifiers
    // distinct so that every test loads a fresh module; "async/..." returns a promise.
    builder.onLoad({ filter: /.*/, namespace: "value-loader" }, ({ path }) => {
      const [how, name] = path.split("/");
      const result = valueLoaderContents[name];
      if (!result) throw new Error("no contents registered for " + path);
      return how === "async" ? Promise.resolve(result) : result;
    });

    for (const how of ["import", "require"]) {
      builder.module(`value-loader-module-json/${how}`, () => ({
        contents: `{"hello": "from build.module()"}`,
        loader: "json",
      }));
    }
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

// These loaders must behave exactly like the same contents in a file on disk:
// import gets the value as the default export (plus an object's keys as named
// exports) and require() gets the value itself.
describe("json, toml, yaml and xml loaders", () => {
  const objectExports = { default: { hello: "world", nested: { n: 1 } }, hello: "world", nested: { n: 1 } };

  it.each(["json-object", "toml", "yaml"])("%s: import() exposes the value and its keys", async name => {
    expect({ ...(await import(`value-loader:import/${name}`)) }).toEqual(objectExports);
  });

  it.each(["json-object", "toml", "yaml"])("%s: require() returns the value", name => {
    expect(require(`value-loader:require/${name}`)).toEqual({ hello: "world", nested: { n: 1 } });
  });

  it("xml: import() and require()", async () => {
    const xml = { root: { hello: "world" } };
    expect({ ...(await import("value-loader:import/xml")) }).toEqual({ default: xml, ...xml });
    expect(require("value-loader:require/xml")).toEqual(xml);
  });

  it("json string: import() default export is the string", async () => {
    expect({ ...(await import("value-loader:import/json-string")) }).toEqual({
      __esModule: true,
      default: "hello world",
    });
  });

  it("json string: require() returns the string", () => {
    expect(require("value-loader:require/json-string")).toBe("hello world");
  });

  it("json array: import() default export is the array, require() returns it", async () => {
    expect({ ...(await import("value-loader:import/json-array")) }).toEqual({ __esModule: true, default: [1, 2, 3] });
    expect(require("value-loader:require/json-array")).toEqual([1, 2, 3]);
  });

  it.each(["json", "toml", "yaml"])("loader defaults to the one for the .%s extension", async ext => {
    expect({ ...(await import(`value-loader:import/by-extension.${ext}`)) }).toEqual({
      default: { hello: ext },
      hello: ext,
    });
    expect(require(`value-loader:require/by-extension.${ext}`)).toEqual({ hello: ext });
  });

  it.each(["json-object", "toml", "yaml"])("%s: works when onLoad returns a promise", async name => {
    expect({ ...(await import(`value-loader:async/${name}`)) }).toEqual(objectExports);
  });

  it("works for build.module()", async () => {
    expect({ ...(await import("value-loader-module-json/import")) }).toEqual({
      default: { hello: "from build.module()" },
      hello: "from build.module()",
    });
    expect(require("value-loader-module-json/require")).toEqual({ hello: "from build.module()" });
  });

  it("invalid json is reported by the JSON parser", async () => {
    await expect(import("value-loader:import/json-invalid")).rejects.toThrow("JSON Parse error");
    await expect(import("value-loader:async/json-invalid")).rejects.toThrow("JSON Parse error");
    expect(() => require("value-loader:require/json-invalid")).toThrow("JSON Parse error");
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

it.concurrent("onLoad can replace the contents of .json, .toml, .yaml and .css files on disk", async () => {
  using dir = tempDir("plugin-onload-value-loaders", {
    "preload.js": `
      Bun.plugin({
        name: "replace contents",
        setup(build) {
          build.onLoad({ filter: /\\.json$/ }, () => ({ contents: '{"from": "plugin", "kind": "json"}' }));
          build.onLoad({ filter: /\\.toml$/ }, () => ({ contents: 'from = "plugin"\\nkind = "toml"' }));
          build.onLoad({ filter: /\\.yaml$/ }, () => ({ contents: 'from: plugin\\nkind: yaml' }));
          build.onLoad({ filter: /\\.css$/ }, () => ({ contents: 'a { color: red }' }));
        },
      });
    `,
    "data.json": `{"from": "disk"}`,
    "data.toml": `from = "disk"`,
    "data.yaml": `from: disk`,
    "style.css": `a { color: blue }`,
    "entry.js": `
      import json, { kind as jsonKind } from "./data.json";
      import toml, { kind as tomlKind } from "./data.toml";
      import yaml, { kind as yamlKind } from "./data.yaml";
      import css from "./style.css";

      console.log(
        JSON.stringify({
          imported: { json, jsonKind, toml, tomlKind, yaml, yamlKind, css },
          required: {
            json: require("./required.json"),
            toml: require("./required.toml"),
            yaml: require("./required.yaml"),
            css: require("./required.css"),
          },
        }),
      );
    `,
    "required.json": `{"from": "disk"}`,
    "required.toml": `from = "disk"`,
    "required.yaml": `from: disk`,
    "required.css": `a { color: blue }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.js", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() ? JSON.parse(stdout) : { stderr }).toEqual({
    imported: {
      json: { from: "plugin", kind: "json" },
      jsonKind: "json",
      toml: { from: "plugin", kind: "toml" },
      tomlKind: "toml",
      yaml: { from: "plugin", kind: "yaml" },
      yamlKind: "yaml",
      // The runtime css loader exports an empty object, like it does without a plugin.
      css: {},
    },
    required: {
      json: { from: "plugin", kind: "json" },
      toml: { from: "plugin", kind: "toml" },
      yaml: { from: "plugin", kind: "yaml" },
      css: {},
    },
  });
  expect(exitCode).toBe(0);
});
