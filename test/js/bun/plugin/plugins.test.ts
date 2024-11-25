/// <reference types="./plugins" />
import { plugin } from "bun";
import { describe, expect, it, test } from "bun:test";
import path, { dirname, join, resolve } from "path";

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
    builder.onResolve({ namespace: "http", filter: /.*/ }, ({ path }) => {
      return {
        path,
        namespace: "url",
      };
    });

    builder.onLoad({ filter: /.*/, namespace: "url" }, async ({ path, namespace }) => {
      const res = await fetch("http://" + path);
      return {
        exports: { default: await res.text() },
        loader: "object",
      };
    });
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
import "../../third_party/svelte";
import "./module-plugins";
import { itBundled } from "bundler/expectBundled";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { filter } from "js/node/test/fixtures/aead-vectors";

describe("require", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", () => {
    const { default: App } = require("./hello.svelte");
    const { html } = App.render();

    expect(html).toBe("<h1>Hello world!</h1>");
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

    const { html } = App.render();

    expect(html).toBe("<h1>Hello world!</h1>");
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
    const { html } = SvelteApp.render();

    expect(html).toBe("<h1>Hello world!</h1>");
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
    const { default: text } = await import(`http://${server.hostname}:${server.port}/hey.txt`);
    expect(text).toBe(result);
  });
});

describe("start", () => {
  {
    let state: string = "Should not see this!";

    itBundled("works", {
      experimentalCss: true,
      minifyWhitespace: true,
      files: {
        "/entry.css": /* css */ `
          body {
            background: white;
            color: blue; }
        `,
      },
      plugins: [
        {
          name: "demo",
          setup(build) {
            build.onStart(() => {
              state = "red";
            });

            build.onLoad({ filter: /\.css/ }, async ({ path }) => {
              console.log("[plugin] Path", path);
              return {
                contents: `body { color: ${state} }`,
                loader: "css",
              };
            });
          },
        },
      ],
      outfile: "/out.js",
      onAfterBundle(api) {
        api.expectFile("/out.js").toEqualIgnoringWhitespace(`body{color:${state}}`);
      },
    });
  }

  {
    type Action = "onLoad" | "onStart";
    let actions: Action[] = [];

    itBundled("executes before everything", {
      experimentalCss: true,
      minifyWhitespace: true,
      files: {
        "/entry.css": /* css */ `
          body {
            background: white;
            color: blue; }
        `,
      },
      plugins: [
        {
          name: "demo",
          setup(build) {
            build.onLoad({ filter: /\.css/ }, async ({ path }) => {
              actions.push("onLoad");
              return {
                contents: `body { color: red }`,
                loader: "css",
              };
            });

            build.onStart(() => {
              actions.push("onStart");
            });
          },
        },
      ],
      outfile: "/out.js",
      onAfterBundle(api) {
        api.expectFile("/out.js").toEqualIgnoringWhitespace(`body{ color: red }`);

        expect(actions).toStrictEqual(["onStart", "onLoad"]);
      },
    });
  }

  {
    let action: string[] = [];
    itBundled("executes after all plugins have been setup", {
      experimentalCss: true,
      minifyWhitespace: true,
      files: {
        "/entry.css": /* css */ `
          body {
            background: white;
            color: blue; }
        `,
      },
      plugins: [
        {
          name: "onStart 1",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 1 setup");
              await Bun.sleep(1000);
              action.push("onStart 1 complete");
            });
          },
        },
        {
          name: "onStart 2",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 2 setup");
              await Bun.sleep(1000);
              action.push("onStart 2 complete");
            });
          },
        },
        {
          name: "onStart 3",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 3 setup");
              await Bun.sleep(1000);
              action.push("onStart 3 complete");
            });
          },
        },
      ],
      outfile: "/out.js",
      onAfterBundle(api) {
        expect(action.slice(0, 3)).toStrictEqual(["onStart 1 setup", "onStart 2 setup", "onStart 3 setup"]);
        expect(new Set(action.slice(3))).toStrictEqual(
          new Set(["onStart 1 complete", "onStart 2 complete", "onStart 3 complete"]),
        );
      },
    });
  }

  {
    let action: string[] = [];
    test("LMAO", async () => {
      const folder = tempDirWithFiles("plz", {
        "index.ts": "export const foo = {}",
      });
      try {
        const result = await Bun.build({
          entrypoints: [path.join(folder, "index.ts")],
          experimentalCss: true,
          minify: true,
          plugins: [
            {
              name: "onStart 1",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 1 setup");
                  throw new Error("WOOPS");
                  // await Bun.sleep(1000);
                });
              },
            },
            {
              name: "onStart 2",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 2 setup");
                  await Bun.sleep(1000);
                  action.push("onStart 2 complete");
                });
              },
            },
            {
              name: "onStart 3",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 3 setup");
                  await Bun.sleep(1000);
                  action.push("onStart 3 complete");
                });
              },
            },
          ],
        });
        console.log(result);
      } catch (err) {
        expect(err).toBeDefined();
        return;
      }
      throw new Error("DIDNT GET ERRROR!");
    });
  }
});

describe("defer", () => {
  {
    type Action = {
      type: "load" | "defer";
      path: string;
    };
    let actions: Action[] = [];
    function logLoad(path: string) {
      actions.push({ type: "load", path: path.replaceAll("\\", "/") });
    }
    function logDefer(path: string) {
      actions.push({ type: "defer", path: path.replaceAll("\\", "/") });
    }

    itBundled("basic", {
      experimentalCss: true,
      files: {
        "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
      `,
        "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
      `,
        "/foo.ts": `
      export const foo = 'lkdfjlsdf';
      console.log('hi')`,
        "/a.css": `
      h1 {
        color: blue;
      }
            `,
      },
      entryPoints: ["index.ts"],
      plugins: [
        {
          name: "demo",
          setup(build) {
            build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
              // console.log("Running on load plugin", path);
              if (path.includes("index.ts")) {
                logLoad(path);
                return undefined;
              }
              logDefer(path);
              await defer();
              logLoad(path);
              return undefined;
            });
          },
        },
      ],
      outdir: "/out",
      onAfterBundle(api) {
        const expected_actions: Action[] = [
          {
            type: "load",
            path: "index.ts",
          },
          {
            type: "defer",
            path: "lmao.ts",
          },
          {
            type: "load",
            path: "lmao.ts",
          },
          {
            type: "defer",
            path: "foo.ts",
          },
          {
            type: "load",
            path: "foo.ts",
          },
        ];

        expect(actions.length).toBe(expected_actions.length);
        for (let i = 0; i < expected_actions.length; i++) {
          const expected = expected_actions[i];
          const action = actions[i];
          const filename = action.path.split("/").pop();

          expect(action.type).toEqual(expected.type);
          expect(filename).toEqual(expected.path);
        }
      },
    });
  }

  itBundled("edgecase", {
    experimentalCss: true,
    minifyWhitespace: true,
    files: {
      "/entry.css": /* css */ `
          body {
            background: white;
            color: black }
        `,
    },
    plugins: [
      {
        name: "demo",
        setup(build) {
          build.onLoad({ filter: /\.css/ }, async ({ path }) => {
            console.log("[plugin] Path", path);
            return {
              contents: 'h1 [this_worked="nice!"] { color: red; }',
              loader: "css",
            };
          });
        },
      },
    ],
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`h1 [this_worked=nice\\!]{color:red}
`);
    },
  });

  // encountered double free when CSS build has error
  itBundled("shouldn't crash on CSS parse error", {
    experimentalCss: true,
    files: {
      "/index.ts": /* ts */ `
  import { lmao } from "./lmao.ts";
  import foo from "./a.css";

  console.log("Foo", foo, lmao);
        `,
      "/lmao.ts": `
  import { foo } from "./foo.ts";
  export const lmao = "lolss";
  console.log(foo);
        `,
      "/foo.ts": `
  export const foo = "LOL bro";
  console.log("FOOOO", foo);
        `,
      "/a.css": `
        /* helllooo friends */
              `,
    },
    entryPoints: ["index.ts"],
    plugins: [
      {
        name: "demo",
        setup(build) {
          build.onLoad({ filter: /\.css/ }, async ({ path }) => {
            console.log("[plugin] CSS path", path);
            return {
              // this fails, because it causes a Build error I think?
              contents: `hello friends!`,
              loader: "css",
            };
          });

          build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
            // console.log("Running on load plugin", path);
            if (path.includes("index.ts")) {
              console.log("[plugin] Path", path);
              return undefined;
            }
            await defer();
            return undefined;
          });
        },
      },
    ],
    outdir: "/out",
    bundleErrors: {
      "/a.css": ["Unexpected end of input"],
    },
  });

  itBundled("works as expected when onLoad error occurs after defer", {
    experimentalCss: true,
    files: {
      "/index.ts": /* ts */ `
  import { lmao } from "./lmao.ts";
  import foo from "./a.css";

  console.log("Foo", foo, lmao);
        `,
      "/lmao.ts": `
  import { foo } from "./foo.ts";
  export const lmao = "lolss";
  console.log(foo);
        `,
      "/foo.ts": `
  export const foo = "LOL bro";
  console.log("FOOOO", foo);
        `,
      "/a.css": `
        /* helllooo friends */
              `,
    },
    entryPoints: ["index.ts"],
    plugins: [
      {
        name: "demo",
        setup(build) {
          build.onLoad({ filter: /\.css/ }, async ({ path }) => {
            return {
              // this fails, because it causes a Build error I think?
              contents: `hello friends`,
              loader: "css",
            };
          });

          build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
            if (path.includes("index.ts")) {
              return undefined;
            }
            await defer();
            throw new Error("woopsie");
          });
        },
      },
    ],
    outdir: "/out",
    bundleErrors: {
      "/a.css": ["Unexpected end of input"],
      "/lmao.ts": ["woopsie"],
    },
  });

  itBundled("calling defer more than once errors", {
    experimentalCss: true,
    files: {
      "/index.ts": /* ts */ `
  import { lmao } from "./lmao.ts";
  import foo from "./a.css";

  console.log("Foo", foo, lmao);
        `,
      "/lmao.ts": `
  import { foo } from "./foo.ts";
  export const lmao = "lolss";
  console.log(foo);
        `,
      "/foo.ts": `
  export const foo = "LOL bro";
  console.log("FOOOO", foo);
        `,
      "/a.css": `
        /* helllooo friends */
              `,
    },
    entryPoints: ["index.ts"],
    plugins: [
      {
        name: "demo",
        setup(build) {
          build.onLoad({ filter: /\.css/ }, async ({ path }) => {
            return {
              // this fails, because it causes a Build error I think?
              contents: `hello friends`,
              loader: "css",
            };
          });

          build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
            if (path.includes("index.ts")) {
              return undefined;
            }
            await defer();
            await defer();
          });
        },
      },
    ],
    outdir: "/out",
    bundleErrors: {
      "/a.css": ["Unexpected end of input"],
      "/lmao.ts": ["can't call .defer() more than once within an onLoad plugin"],
    },
  });

  test("integration", async () => {
    const folder = tempDirWithFiles("integration", {
      "module_data.json": "{}",
      "package.json": `{
        "name": "integration-test",
        "version": "1.0.0",
        "private": true,
        "type": "module",
        "dependencies": {
        }
      }`,
      "src/index.ts": `
import { greet } from "./utils/greetings";
import { formatDate } from "./utils/dates";
import { calculateTotal } from "./math/calculations";
import { logger } from "./services/logger";
import moduleData from "../module_data.json";
import path from "path";


await Bun.write(path.join(import.meta.dirname, 'output.json'), JSON.stringify(moduleData))

function main() {
  const today = new Date();
  logger.info("Application started");
  
  const total = calculateTotal([10, 20, 30, 40]);
  console.log(greet("World"));
  console.log(\`Today is \${formatDate(today)}\`);
  console.log(\`Total: \${total}\`);
}
`,
      "src/utils/greetings.ts": `
export function greet(name: string): string {
  return \`Hello \${name}!\`;
}
`,
      "src/utils/dates.ts": `
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric", 
    month: "long",
    day: "numeric"
  });
}
`,
      "src/math/calculations.ts": `
export function calculateTotal(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0);
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      "src/services/logger.ts": `
export const logger = {
  info: (msg: string) => console.log(\`[INFO] \${msg}\`),
  error: (msg: string) => console.error(\`[ERROR] \${msg}\`),
  warn: (msg: string) => console.warn(\`[WARN] \${msg}\`)
};
`,
    });

    const entrypoint = path.join(folder, "src", "index.ts");
    await Bun.$`${bunExe()} install`.env(bunEnv).cwd(folder);

    const outdir = path.join(folder, "dist");

    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir,
      plugins: [
        {
          name: "xXx123_import_checker_321xXx",
          setup(build) {
            type Import = {
              imported: string[];
              dep: string;
            };
            type Export = {
              ident: string;
            };
            let imports_and_exports: Record<string, { imports: Array<Import>; exports: Array<Export> }> = {};

            build.onLoad({ filter: /\.ts/ }, async ({ path }) => {
              const contents = await Bun.$`cat ${path}`.quiet().text();

              const import_regex = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];/g;
              const imports: Array<Import> = [...contents.toString().matchAll(import_regex)].map(m => ({
                imported: m
                  .slice(1, m.length - 1)
                  .map(match => (match[0] === "{" ? match.slice(2, match.length - 2) : match)),
                dep: m[m.length - 1],
              }));

              const export_regex =
                /export\s+(?:default\s+|const\s+|let\s+|var\s+|function\s+|class\s+|enum\s+|type\s+|interface\s+)?([\w$]+)?(?:\s*=\s*|(?:\s*{[^}]*})?)?[^;]*;/g;
              const exports: Array<Export> = [...contents.matchAll(export_regex)].map(m => ({
                ident: m[1],
              }));

              imports_and_exports[path.replaceAll("\\", "/").split("/").pop()!] = { imports, exports };
              return undefined;
            });

            build.onLoad({ filter: /module_data\.json/ }, async ({ defer }) => {
              await defer();
              const contents = JSON.stringify(imports_and_exports);

              return {
                contents,
                loader: "json",
              };
            });
          },
        },
      ],
    });

    expect(result.success).toBeTrue();
    await Bun.$`${bunExe()} run ${result.outputs[0].path}`;
    const output = await Bun.$`cat ${path.join(folder, "dist", "output.json")}`.json();
    expect(output).toStrictEqual({
      "index.ts": {
        "imports": [
          { "imported": ["greet"], "dep": "./utils/greetings" },
          { "imported": ["formatDate"], "dep": "./utils/dates" },
          { "imported": ["calculateTotal"], "dep": "./math/calculations" },
          { "imported": ["logger"], "dep": "./services/logger" },
          { "imported": ["moduleData"], "dep": "../module_data.json" },
          { "imported": ["path"], "dep": "path" },
        ],
        "exports": [],
      },
      "greetings.ts": {
        "imports": [],
        "exports": [{ "ident": "greet" }],
      },
      "dates.ts": {
        "imports": [],
        "exports": [{ "ident": "formatDate" }],
      },
      "calculations.ts": {
        "imports": [],
        "exports": [{ "ident": "calculateTotal" }, { "ident": "multiply" }],
      },
      "logger.ts": {
        "imports": [],
        "exports": [{ "ident": "logger" }],
      },
    });
  });
});
