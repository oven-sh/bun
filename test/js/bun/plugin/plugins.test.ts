/// <reference types="./plugins" />
import { plugin } from "bun";
import { describe, expect, it } from "bun:test";
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
import { bunEnv, bunExe } from "harness";
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
  it.todo("valid loaders work", () => {
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
