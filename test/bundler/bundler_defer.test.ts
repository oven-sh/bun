import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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
    test("onstart throwing an error works", async () => {
      const folder = tempDirWithFiles("plugin", {
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
