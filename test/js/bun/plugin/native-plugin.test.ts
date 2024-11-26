import { plugin } from "bun";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import path, { dirname, join, resolve } from "path";
import source from "./native_plugin.c" with { type: "file" };
import bundlerPluginHeader from "../../../../packages/bun-native-bundler-plugin-api/bundler_plugin.h" with { type: "file" };
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { itBundled } from "bundler/expectBundled";

describe("native-plugins", () => {
  const cwd = process.cwd();
  let tempdir: string = "";
  let outdir: string = "";

  beforeAll(async () => {
    const files = {
      "bun-native-bundler-plugin-api/bundler_plugin.h": await Bun.file(bundlerPluginHeader).text(),
      "plugin.c": await Bun.file(source).text(),
      "package.json": JSON.stringify({
        "name": "fake-plugin",
        "module": "index.ts",
        "type": "module",
        "devDependencies": {
          "@types/bun": "latest",
        },
        "peerDependencies": {
          "typescript": "^5.0.0",
        },
        "scripts": {
          "build:napi": "node-gyp configure && node-gyp build",
        },
        "dependencies": {
          "node-gyp": "10.2.0",
        },
      }),

      "index.ts": /* ts */ `import values from "./stuff.ts";
import json from "./lmao.json";
const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
console.log(JSON.stringify(json));
values;`,
      "stuff.ts": `export default { foo: "bar" }`,
      "lmao.json": ``,
      "binding.gyp": /* gyp */ `{
        "targets": [
          {
            "target_name": "xXx123_foo_counter_321xXx",
            "sources": [ "plugin.c" ],
            "include_dirs": [ "." ]
          }
        ]
      }`,
    };

    tempdir = tempDirWithFiles("native-plugins", files);
    outdir = path.join(tempdir, "dist");

    console.log("tempdir", tempdir);

    process.chdir(tempdir);

    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);
  });

  afterEach(async () => {
    await Bun.$`rm -rf ${outdir}`;
    process.chdir(cwd);
  });

  it("works in a basic case", async () => {
    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const result = await Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /lmao\.json/ }, async ({ defer }) => {
              await defer();
              const count = napiModule.getFooCount(external);
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    if (!result.success) console.log(result);
    expect(result.success).toBeTrue();
    const output = await Bun.$`${bunExe()} run dist/index.js`.cwd(tempdir).json();
    expect(output).toStrictEqual({ fooCount: 9 });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when there are a lot of concurrent files", async () => {
    // Generate 100 json files
    const files: [filepath: string, var_name: string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files/lmao${i}.json"`, `json${i}`];
      }),
    );

    // Append the imports to index.ts
    const prelude = /* ts */ `import values from "./stuff.ts"
  const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
      `;
    await Bun.$`echo ${prelude} > index.ts`;
    await Bun.$`echo ${files.map(([fp]) => fp).join("\n")} >> index.ts`;
    await Bun.$`echo ${files.map(([, varname]) => `console.log(JSON.stringify(${varname}))`).join("\n")} >> index.ts`;

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const result = await Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              const count = napiModule.getFooCount(external);
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    if (!result.success) console.log(result);
    console.log(result);
    expect(result.success).toBeTrue();
    const output = await Bun.$`${bunExe()} run dist/index.js`.cwd(tempdir).text();
    const outputJsons = output
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 9 });
    }

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  // We clone the RegExp object in the C++ code so this test ensures that there
  // is no funny business regarding the filter regular expression and multiple
  // threads
  it("doesn't explode when there are a lot of concurrent files AND the filter regex is used on the JS thread", async () => {
    const filter = /\.ts/;
    // Generate 100 json files
    const files: [filepath: string, var_name: string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files/lmao${i}.json"`, `json${i}`];
      }),
    );

    // Append the imports to index.ts
    const prelude = /* ts */ `import values from "./stuff.ts"
const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
    `;
    await Bun.$`echo ${prelude} > index.ts`;
    await Bun.$`echo ${files.map(([fp]) => fp).join("\n")} >> index.ts`;
    await Bun.$`echo ${files.map(([, varname]) => `console.log(JSON.stringify(${varname}))`).join("\n")} >> index.ts`;
    await Bun.$`echo '(() => values)();' >> index.ts`;

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const resultPromise = Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              const count = napiModule.getFooCount(external);
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    // Now saturate this thread with uses of the filter regex to test that nothing bad happens
    // when the JS thread and the bundler thread use regexes concurrently
    let dummy = 0;
    for (let i = 0; i < 10000; i++) {
      // Match the filter regex on some dummy string
      dummy += filter.test("foo") ? 1 : 0;
    }

    const result = await resultPromise;

    if (!result.success) console.log(result);
    expect(result.success).toBeTrue();
    const output = await Bun.$`${bunExe()} run dist/index.js`.cwd(tempdir).text();
    const outputJsons = output
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 9 });
    }

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when passing invalid external", async () => {
    const filter = /\.ts/;
    // Generate 100 json files
    const files: [filepath: string, var_name: string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files/lmao${i}.json"`, `json${i}`];
      }),
    );

    // Append the imports to index.ts
    const prelude = /* ts */ `import values from "./stuff.ts"
const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
    `;
    await Bun.$`echo ${prelude} > index.ts`;
    await Bun.$`echo ${files.map(([fp]) => fp).join("\n")} >> index.ts`;
    await Bun.$`echo ${files.map(([, varname]) => `console.log(JSON.stringify(${varname}))`).join("\n")} >> index.ts`;

    const resultPromise = Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
            const external = undefined;

            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              let count = 0;
              try {
                count = napiModule.getFooCount(external);
              } catch (e) {}
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    const result = await resultPromise;

    if (!result.success) console.log(result);
    expect(result.success).toBeTrue();
    const output = await Bun.$`${bunExe()} run dist/index.js`.cwd(tempdir).text();
    const outputJsons = output
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 0 });
    }
  });

  it("works when logging an error", async () => {
    const filter = /\.ts/;

    const prelude = /* ts */ `import values from "./stuff.ts"
  const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
      `;
    await Bun.$`echo ${prelude} > index.ts`;

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const resultPromise = Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            napiModule.setThrowsErrors(external, true);

            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              let count = 0;
              try {
                count = napiModule.getFooCount(external);
              } catch (e) {}
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    const result = await resultPromise;

    if (result.success) console.log(result);
    expect(result.success).toBeFalse();
    const log = result.logs[0];
    expect(log.message).toContain("Throwing an error");
    expect(log.level).toBe("error");

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(0);
  });

  it("works with versioning", async () => {
    const filter = /\.ts/;

    const prelude = /* ts */ `import values from "./stuff.ts"
  const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
      `;
    await Bun.$`echo ${prelude} > index.ts`;

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const resultPromise = Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter }, { napiModule, symbol: "incompatible_version_plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              let count = 0;
              try {
                count = napiModule.getFooCount(external);
              } catch (e) {}
              return {
                contents: JSON.stringify({ fooCount: count }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    const result = await resultPromise;

    if (result.success) console.log(result);
    expect(result.success).toBeFalse();
    const log = result.logs[0];
    expect(log.message).toContain("This plugin is built for a newer version of Bun than the one currently running.");
    expect(log.level).toBe("error");

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(0);
  });
});
