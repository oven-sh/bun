import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import * as path from "node:path";
import { itBundled } from "./expectBundled";

describe("defer", () => {
  {
    let state: string = "Should not see this!";

    itBundled("works", {
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
              await Bun.sleep(50);
              action.push("onStart 1 complete");
            });
          },
        },
        {
          name: "onStart 2",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 2 setup");
              await Bun.sleep(50);
              action.push("onStart 2 complete");
            });
          },
        },
        {
          name: "onStart 3",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 3 setup");
              await Bun.sleep(50);
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
    test("onstart throwing an error works", async () => {
      await using folder = tempDir("plugin", {
        "index.ts": "export const foo = {}",
      });
      try {
        const result = await Bun.build({
          entrypoints: [path.join(folder, "index.ts")],
          minify: true,
          plugins: [
            {
              name: "onStart 1",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 1 setup");
                  throw new Error("WOOPS");
                });
              },
            },
            {
              name: "onStart 2",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 2 setup");
                  await Bun.sleep(50);
                  action.push("onStart 2 complete");
                });
              },
            },
            {
              name: "onStart 3",
              setup(build) {
                build.onStart(async () => {
                  action.push("onStart 3 setup");
                  await Bun.sleep(50);
                  action.push("onStart 3 complete");
                });
              },
            },
          ],
        });
        console.log(result);
      } catch (err: any) {
        expect(err).toBeDefined();
        expect(err.message).toBe("WOOPS");
        return;
      }
      throw new Error("DIDNT GET ERROR!");
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
              contents: `hello friends`,
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
      "/lmao.ts": ["Can't call .defer() more than once within an onLoad plugin"],
    },
  });

  test("integration", async () => {
    await using folder = tempDir("integration", {
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

    let onFinalizeCallCount = 0;
    let onFinalizeCallRegistry = new FinalizationRegistry(() => {
      onFinalizeCallCount++;
    });

    const result = await (async function () {
      return await Bun.build({
        entrypoints: [entrypoint],
        outdir,
        plugins: [
          (() => {
            const plugin = {
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

                const onLoadTS = async ({ path }) => {
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
                };

                const onLoadModuleData = async ({ defer }) => {
                  await defer();
                  const contents = JSON.stringify(imports_and_exports);

                  return {
                    contents,
                    loader: "json",
                  };
                };

                build.onLoad({ filter: /\.ts/ }, onLoadTS);

                build.onLoad({ filter: /module_data\.json/ }, onLoadModuleData);

                onFinalizeCallRegistry.register(onLoadTS, undefined);
                onFinalizeCallRegistry.register(onLoadModuleData, undefined);
              },
            };
            onFinalizeCallRegistry.register(plugin.setup, undefined);
            return plugin;
          })(),
        ],
      });
    })();

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
    // GC doesn't guarantee immediate finalization; spin the event loop and
    // retry so the FinalizationRegistry callbacks have a chance to fire.
    for (let i = 0; i < 100 && onFinalizeCallCount < 3; i++) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
    if (onFinalizeCallCount < 3) {
      const { heapStats } = require("bun:jsc");
      const stats = heapStats();
      console.error(
        `onFinalizeCallCount=${onFinalizeCallCount} ` +
          `BundlerPlugin alive=${stats.objectTypeCounts.BundlerPlugin ?? 0} ` +
          `protected=${JSON.stringify(stats.protectedObjectTypeCounts)} ` +
          `protectedCount=${stats.protectedObjectCount}`,
      );
    }
    expect(onFinalizeCallCount).toBe(3);
  });
});

// An onLoad callback that calls `defer()` without waiting for it. The bundler used
// to count such a load twice (once when `defer()` parked its pending unit, again
// when the parse scheduled by the answer completed) and, on the Bun.build thread,
// to queue both notifications on the same intrusive node, so a build died with
// `panic: int cast: TryFromIntError(NegOverflow)` in `BundleV2::on_parse_task_complete`
// or never finished; whether the promise ever settled depended on the same timing.
// The builds run in a subprocess because the failures take the whole process down.
describe("defer() that is not awaited", () => {
  test.concurrent(
    "before answering: builds with the plugin's contents and settles the promise when the build completes",
    async () => {
      const moduleNames = Array.from({ length: 24 }, (_, i) => `m${i}`);
      using dir = tempDir(
        "defer-no-await",
        Object.fromEntries([
          ...moduleNames.map(name => [`${name}.ts`, `throw new Error("disk contents of ${name} were bundled");`]),
          ["entry.ts", `throw new Error("disk contents of entry were bundled");`],
          [
            "build.ts",
            /* ts */ `
              const moduleNames = ${JSON.stringify(moduleNames)};
              const entryContents = moduleNames.map(name => 'import "./' + name + '";').join("\\n");
              for (let build = 0; build < 4; build++) {
                let issued = 0;
                let settled = 0;
                const result = await Bun.build({
                  entrypoints: [import.meta.dir + "/entry.ts"],
                  format: "iife",
                  plugins: [
                    {
                      name: "defer-without-await",
                      setup(build) {
                        build.onLoad({ filter: /\\.ts$/ }, args => {
                          issued++;
                          args.defer().then(() => settled++);
                          const base = args.path.replaceAll("\\\\", "/").split("/").pop().slice(0, -".ts".length);
                          return {
                            loader: "ts",
                            contents: base === "entry" ? entryContents : 'globalThis.loaded.push("' + base + '");',
                          };
                        });
                      },
                    },
                  ],
                });
                if (!result.success) {
                  console.log("build " + build + " failed:", result.logs.map(String));
                  process.exit(1);
                }
                // The leftover promises are resolved before the build's own promise is.
                if (issued !== moduleNames.length + 1 || settled !== issued) {
                  console.log("build " + build + ": " + settled + " of " + issued + " defer() promises settled");
                  process.exit(1);
                }
                globalThis.loaded = [];
                new Function(await result.outputs[0].text())();
                const loaded = globalThis.loaded;
                if (loaded.length !== moduleNames.length || moduleNames.some((name, i) => loaded[i] !== name)) {
                  console.log("build " + build + " bundled the wrong modules:", loaded);
                  process.exit(1);
                }
              }
              console.log("ok");
            `,
          ],
        ]),
      );

      expect(await bunRun(path.join(String(dir), "build.ts"))).toSpawn("ok");
    },
  );

  // With a gap between defer() and the answer, the bundle thread sees the scan
  // reach zero, schedules the task that resolves the promise, and then gets the
  // answer and finishes the build while that task is still queued behind a busy
  // JS thread. The task used to live inside the build's BundleV2 (ASAN:
  // heap-use-after-free in DeferredBatchTask::run_on_js_thread); it must not
  // touch the build at all.
  test.concurrent("before answering: a drain scheduled before the answer outlives the build safely", async () => {
    using dir = tempDir("defer-drain-outlives-build", {
      "entry.ts": `throw new Error("disk contents of entry were bundled");`,
      "build.ts": /* ts */ `
        // Spinning (not sleeping) keeps this thread busy; there is no event the
        // bundle thread could signal, it is the bundle thread we are racing.
        const spin = (ms: number) => {
          const end = performance.now() + ms;
          while (performance.now() < end) {}
        };
        for (let build = 0; build < 2; build++) {
          let settled = false;
          const result = await Bun.build({
            entrypoints: [import.meta.dir + "/entry.ts"],
            plugins: [
              {
                name: "defer-then-busy",
                setup(build) {
                  build.onLoad({ filter: /entry\\.ts$/ }, args => {
                    args.defer().then(() => (settled = true));
                    spin(20); // let the bundle thread take the defer() notification first
                    queueMicrotask(() => spin(250)); // runs right after the answer is posted
                    return { contents: "export const x = 1;", loader: "ts" };
                  });
                },
              },
            ],
          });
          if (!result.success || !settled) {
            console.log("build " + build + ": success=" + result.success + " settled=" + settled);
            process.exit(1);
          }
        }
        console.log("ok");
      `,
    });

    expect(await bunRun(path.join(String(dir), "build.ts"))).toSpawn("ok");
  });

  // Here the load's pending unit already belongs to the parse its answer scheduled.
  // Parking it anyway made the scan look finished early, which resolved the
  // `defer()` promises of loads that were genuinely waiting before the answer's
  // own imports had been loaded. Calling defer() this late is a misuse that the
  // JS side may reject outright (hence the try/catch); whatever still reaches the
  // bundler must not count against the scan.
  test.concurrent("after answering: does not resolve other loads' defer() early", async () => {
    using dir = tempDir("defer-after-answer", {
      "entry.ts": `import "./x"; import "./y";`,
      "x.ts": `throw new Error("disk contents of x were bundled");`,
      "y.ts": `throw new Error("disk contents of y were bundled");`,
      "z.ts": `throw new Error("disk contents of z were bundled");`,
      "build.ts": /* ts */ `
        for (let build = 0; build < 5; build++) {
          const events: string[] = [];
          const result = await Bun.build({
            entrypoints: [import.meta.dir + "/entry.ts"],
            plugins: [
              {
                name: "late-defer",
                setup(build) {
                  // x waits for every other module, as documented.
                  build.onLoad({ filter: /[\\\\/]x\\.ts$/ }, async ({ defer }) => {
                    events.push("x:defer");
                    await defer();
                    events.push("x:resumed");
                    return { contents: "export const x = 1;", loader: "ts" };
                  });
                  // y answers synchronously (so onLoadAsync runs before the microtask),
                  // then calls defer() once its answer is already on its way.
                  build.onLoad({ filter: /[\\\\/]y\\.ts$/ }, ({ defer }) => {
                    queueMicrotask(() => {
                      try {
                        void defer();
                      } catch {}
                    });
                    events.push("y:load");
                    return { contents: 'import "./z";', loader: "ts" };
                  });
                  // z only becomes known once y's answer has been parsed.
                  build.onLoad({ filter: /[\\\\/]z\\.ts$/ }, () => {
                    events.push("z:load");
                    return { contents: "export const z = 1;", loader: "ts" };
                  });
                },
              },
            ],
          });
          if (!result.success) {
            console.log("build " + build + " failed:", result.logs.map(String));
            process.exit(1);
          }
          const resumed = events.indexOf("x:resumed");
          const zLoaded = events.indexOf("z:load");
          if (resumed === -1 || zLoaded === -1 || zLoaded > resumed) {
            console.log("build " + build + " resumed x before z was loaded:", events);
            process.exit(1);
          }
        }
        console.log("ok");
      `,
    });

    expect(await bunRun(path.join(String(dir), "build.ts"))).toSpawn("ok");
  });

  // Terminating the worker cancels the build while one load is parked in
  // `defer()` and another is still unanswered; both are failed through the
  // same path, and the parked one has to give its unit back first.
  test.concurrent("cancelling the build while a load is parked in defer()", async () => {
    using dir = tempDir("defer-cancelled", {
      "main.ts": /* ts */ `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const { data } = await new Promise<MessageEvent>((resolve, reject) => {
          worker.addEventListener("message", resolve, { once: true });
          worker.addEventListener("error", reject, { once: true });
        });
        if (data !== "armed") {
          console.log(data);
          process.exit(1);
        }
        await worker.terminate();
        console.log("terminated");
      `,
      "worker.ts": /* ts */ `
        let entered = 0;
        const armIfBothEntered = () => ++entered === 2 && postMessage("armed");
        Bun.build({
          entrypoints: ["virtual:deferring", "virtual:stuck"],
          plugins: [
            {
              name: "cancelled-while-deferred",
              setup(build) {
                build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path, namespace: "v" }));
                build.onLoad({ filter: /deferring/, namespace: "v" }, async ({ defer }) => {
                  const everythingElse = defer();
                  armIfBothEntered();
                  await everythingElse;
                  return { contents: "export const deferring = 1;", loader: "ts" };
                });
                build.onLoad({ filter: /stuck/, namespace: "v" }, () => new Promise(armIfBothEntered));
              },
            },
          ],
        }).then(
          () => postMessage("unexpected: the build finished"),
          error => postMessage("unexpected: the build failed before being cancelled: " + error),
        );
      `,
    });

    expect(await bunRun(path.join(String(dir), "main.ts"))).toSpawn("terminated");
  });
});
