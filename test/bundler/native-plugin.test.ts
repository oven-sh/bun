import { BunFile, Loader, plugin } from "bun";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import path, { dirname, join, resolve } from "path";
import source from "./native_plugin.cc" with { type: "file" };
import notAPlugin from "./not_native_plugin.cc" with { type: "file" };
import bundlerPluginHeader from "../../packages/bun-native-bundler-plugin-api/bundler_plugin.h" with { type: "file" };
import { bunEnv, bunExe, makeTree, tempDirWithFiles } from "harness";
import { itBundled } from "bundler/expectBundled";
import os from "os";
import fs from "fs";

describe("native-plugins", async () => {
  const cwd = process.cwd();
  let tempdir: string = "";
  let outdir: string = "";

  beforeAll(async () => {
    const files = {
      "bun-native-bundler-plugin-api/bundler_plugin.h": await Bun.file(bundlerPluginHeader).text(),
      "plugin.cc": await Bun.file(source).text(),
      "not_a_plugin.cc": await Bun.file(notAPlugin).text(),
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
const many_bar = ["bar","bar","bar","bar","bar","bar","bar"]
const many_baz = ["baz","baz","baz","baz","baz","baz","baz"]
console.log(JSON.stringify(json));
values;`,
      "stuff.ts": `export default { foo: "bar", baz: "baz" }`,
      "lmao.json": ``,
      "binding.gyp": /* gyp */ `{
        "targets": [
          {
            "target_name": "xXx123_foo_counter_321xXx",
            "sources": [ "plugin.cc" ],
            "include_dirs": [ "." ]
          },
          {
            "target_name": "not_a_plugin",
            "sources": [ "not_a_plugin.cc" ],
            "include_dirs": [ "." ]
          }
        ]
      }`,
    };

    tempdir = tempDirWithFiles("native-plugins", files);

    await makeTree(tempdir, files);
    outdir = path.join(tempdir, "dist");

    console.log("tempdir", tempdir);

    process.chdir(tempdir);

    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);
  });

  beforeEach(() => {
    const tempdir2 = tempDirWithFiles("native-plugins", {});
    process.chdir(tempdir2);
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

    const result = await Bun.build({
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
      throw: true,
    });

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

  // don't know how to reliably test this on windows
  it.skipIf(process.platform === "win32")("prints name when plugin crashes", async () => {
    const prelude = /* ts */ `import values from "./stuff.ts"
  const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
      `;
    await Bun.$`echo ${prelude} > index.ts`;

    const build_code = /* ts */ `
    import * as path from "path";
    const tempdir = process.env.BUN_TEST_TEMP_DIR;
    const filter = /\.ts/;
    const resultPromise = await Bun.build({
      outdir: "dist",
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();
            napiModule.setWillCrash(external, true);

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
    console.log(resultPromise);
    `;

    await Bun.$`echo ${build_code} > build.ts`;
    const { stdout, stderr } = await Bun.$`BUN_TEST_TEMP_DIR=${tempdir} ${bunExe()} run build.ts`.throws(false);
    const errorString = stderr.toString();
    expect(errorString).toContain('\x1b[31m\x1b[2m"native_plugin_test"\x1b[0m');
  });

  it("detects when plugin sets function pointer but does not user context pointer", async () => {
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
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl_bad_free_function_pointer", external });

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
    expect(log.message).toContain(
      "Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field.",
    );
    expect(log.level).toBe("error");

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(0);
  });

  it("should fail gracefully when passing something that is NOT a bunler plugin", async () => {
    const not_plugins = [require(path.join(tempdir, "build/Release/not_a_plugin.node")), 420, "hi", {}];

    for (const napiModule of not_plugins) {
      try {
        await Bun.build({
          outdir,
          entrypoints: [path.join(tempdir, "index.ts")],
          plugins: [
            {
              name: "not_a_plugin",
              setup(build) {
                build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl" });
              },
            },
          ],
        });
        expect.unreachable();
      } catch (e) {
        expect(e.toString()).toContain(
          "onBeforeParse `napiModule` must be a Napi module which exports the `BUN_PLUGIN_NAME` symbol.",
        );
      }
    }
  });

  it("should fail gracefully when can't find the symbol", async () => {
    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));

    try {
      await Bun.build({
        outdir,
        entrypoints: [path.join(tempdir, "index.ts")],
        plugins: [
          {
            name: "not_a_plugin",
            setup(build) {
              build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "OOGA_BOOGA_420" });
            },
          },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e.toString()).toContain('TypeError: Could not find the symbol "OOGA_BOOGA_420" in the given napi module.');
    }
  });

  it("should use result of the first plugin that runs and doesn't execute the others", async () => {
    const filter = /\.ts/;

    const prelude = /* ts */ `import values from "./stuff.ts"
import json from "./lmao.json";
  const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
  const many_bar = ["bar","bar","bar","bar","bar","bar","bar"]
  const many_baz = ["baz","baz","baz","baz","baz","baz","baz"]
console.log(JSON.stringify(json))
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
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl_bar", external });
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl_baz", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer, path }) => {
              await defer();
              let fooCount = 0;
              let barCount = 0;
              let bazCount = 0;
              try {
                fooCount = napiModule.getFooCount(external);
                barCount = napiModule.getBarCount(external);
                bazCount = napiModule.getBazCount(external);
              } catch (e) {}
              return {
                contents: JSON.stringify({ fooCount, barCount, bazCount }),
                loader: "json",
              };
            });
          },
        },
      ],
    });

    const result = await resultPromise;

    if (result.success) console.log(result);
    expect(result.success).toBeTrue();

    const output = await Bun.$`${bunExe()} run dist/index.js`.cwd(tempdir).json();

    expect(output).toStrictEqual({ fooCount: 9, barCount: 0, bazCount: 0 });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  type AdditionalFile = {
    name: string;
    contents: BunFile | string;
    loader: Loader;
  };
  const additional_files: AdditionalFile[] = [
    {
      name: "bun.png",
      contents: await Bun.file(path.join(import.meta.dir, "../integration/sharp/bun.png")),
      loader: "file",
    },
    {
      name: "index.js",
      contents: /* ts */ `console.log('HELLO FRIENDS')`,
      loader: "js",
    },
    {
      name: "index.ts",
      contents: /* ts */ `console.log('HELLO FRIENDS')`,
      loader: "ts",
    },
    {
      name: "lmao.jsx",
      contents: /* ts */ `console.log('HELLO FRIENDS')`,
      loader: "jsx",
    },
    {
      name: "lmao.tsx",
      contents: /* ts */ `console.log('HELLO FRIENDS')`,
      loader: "tsx",
    },
    {
      name: "lmao.toml",
      contents: /* toml */ `foo = "bar"`,
      loader: "toml",
    },
    {
      name: "lmao.text",
      contents: "HELLO FRIENDS",
      loader: "text",
    },
  ];

  for (const { name, contents, loader } of additional_files) {
    it(`works with ${loader} loader`, async () => {
      await Bun.$`echo ${contents} > ${name}`;
      const source = /* ts */ `import foo from "./${name}";
      console.log(foo);`;
      await Bun.$`echo ${source} > index.ts`;

      const result = await Bun.build({
        outdir,
        entrypoints: [path.join(tempdir, "index.ts")],
        plugins: [
          {
            name: "test",
            setup(build) {
              const ext = name.split(".").pop()!;
              const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));

              // Construct regexp to match the file extension
              const filter = new RegExp(`\\.${ext}$`);
              build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl" });
            },
          },
        ],
        throw: true,
      });

      expect(result.success).toBeTrue();
    });
  }
});
