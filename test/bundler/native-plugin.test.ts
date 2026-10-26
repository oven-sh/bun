import type { BunFile } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isMusl, tempDirWithFiles } from "harness";
import path from "path";
import bundlerPluginHeader from "../../packages/bun-native-bundler-plugin-api/bundler_plugin.h" with { type: "file" };
import source from "./native_plugin.cc" with { type: "file" };
import notAPlugin from "./not_native_plugin.cc" with { type: "file" };

// Concurrent is safe here: each test builds into its own outdir with its own
// native `external`, and a test that needs its own entrypoint writes it under a
// unique name. The shared files (index.ts, stuff.ts, lmao.json, the built
// addon) are only read.
describe.concurrent("native-plugins", async () => {
  let tempdir: string = "";

  beforeAll(async () => {
    const files = {
      "bun-native-bundler-plugin-api/bundler_plugin.h": await Bun.file(bundlerPluginHeader).text(),
      "plugin.cc": await Bun.file(source).text(),
      "not_a_plugin.cc": await Bun.file(notAPlugin).text(),
      "package.json": JSON.stringify({
        "name": "fake-plugin",
        "module": "index.ts",
        "type": "module",
        "scripts": {
          "build:napi": "node-gyp configure && node-gyp build",
        },
        "dependencies": {
          "node-gyp": "10.2.0",
        },
      }),

      // plugin_impl counts "foo": 8 in index.ts (7 strings and the name many_foo)
      // and 1 in stuff.ts. `values;` keeps the stuff.ts import. An unused import
      // is dropped from a .ts file, and then the plugin never sees stuff.ts.
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

    // --ignore-scripts: a binding.gyp makes a plain `bun i` run `node-gyp rebuild`
    // by itself, which would compile the addon a second time before build:napi.
    await Bun.$`${bunExe()} i --ignore-scripts && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);
  });

  // Runs a bundled entrypoint with the bun under test.
  async function runBundle(file: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", file],
      env: bunEnv,
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Writes 100 JSON modules and an entrypoint that imports and prints each one,
  // under names unique to `tag`. `lastLine` must use `values`, see index.ts above.
  async function writeManyJsonEntry(tag: string, lastLine: string) {
    const dir = `json_files_${tag}`;
    const names = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, dir, `lmao${i}.json`), `{}`);
        return `json${i}`;
      }),
    );
    const entry = path.join(tempdir, `entry_${tag}.ts`);
    await Bun.write(
      entry,
      [
        `import values from "./stuff.ts";`,
        `const many_foo = ["foo","foo","foo","foo","foo","foo","foo"];`,
        ...names.map((name, i) => `import ${name} from "./${dir}/lmao${i}.json";`),
        ...names.map(name => `console.log(JSON.stringify(${name}));`),
        lastLine,
      ].join("\n"),
    );
    const outdir = path.join(tempdir, `dist-${tag}`);
    return { entry, outdir, bundle: path.join(outdir, `entry_${tag}.js`) };
  }

  // What a bundle from writeManyJsonEntry prints when every module holds `json`.
  function hundredLines(json: object) {
    const line = JSON.stringify(json) + "\n";
    return Buffer.alloc(line.length * 100, line).toString();
  }

  it("works in a basic case", async () => {
    const outdir = path.join(tempdir, "dist-basic");
    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const result = await Bun.build({
      outdir,
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            const chainedThis = build.onBeforeParse(
              { filter: /\.ts/ },
              { napiModule, symbol: "plugin_impl", external },
            );
            expect(chainedThis).toBe(build);

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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();
    expect(await runBundle(path.join(outdir, "index.js"))).toEqual({
      stdout: '{"fooCount":9}\n',
      stderr: "",
      exitCode: 0,
    });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when there are a lot of concurrent files", async () => {
    const { entry, outdir, bundle } = await writeManyJsonEntry("many", "values;");

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const result = await Bun.build({
      outdir,
      entrypoints: [entry],
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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();
    expect(await runBundle(bundle)).toEqual({ stdout: hundredLines({ fooCount: 9 }), stderr: "", exitCode: 0 });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  // We clone the RegExp object in the C++ code so this test ensures that there
  // is no funny business regarding the filter regular expression and multiple
  // threads
  it("doesn't explode when there are a lot of concurrent files AND the filter regex is used on the JS thread", async () => {
    const filter = /\.ts/;
    const { entry, outdir, bundle } = await writeManyJsonEntry("regex", "(() => values)();");

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    const resultPromise = Bun.build({
      outdir,
      entrypoints: [entry],
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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();
    expect(await runBundle(bundle)).toEqual({ stdout: hundredLines({ fooCount: 9 }), stderr: "", exitCode: 0 });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when passing invalid external", async () => {
    const filter = /\.ts/;
    const { entry, outdir, bundle } = await writeManyJsonEntry("invalid_external", "values;");

    const result = await Bun.build({
      outdir,
      entrypoints: [entry],
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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();
    expect(await runBundle(bundle)).toEqual({ stdout: hundredLines({ fooCount: 0 }), stderr: "", exitCode: 0 });
  });

  it("works when logging an error", async () => {
    const filter = /\.ts/;
    const outdir = path.join(tempdir, "dist-logging-an-error");

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    try {
      const resultPromise = await Bun.build({
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
    } catch (e) {
      const err = e as AggregateError;
      expect(err.errors[0].message).toContain("Throwing an error");
      expect(err.errors[0].level).toBe("error");

      const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
      expect(compilationCtxFreedCount).toBe(0);
      return;
    }
    expect.unreachable("Should have caught an error");
  });

  it("works with versioning", async () => {
    const filter = /\.ts/;
    const outdir = path.join(tempdir, "dist-versioning");

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    try {
      const resultPromise = await Bun.build({
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
    } catch (e) {
      const err = e as AggregateError;
      expect(err.errors[0].message).toContain(
        "This plugin is built for a newer version of Bun than the one currently running.",
      );
      const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
      expect(compilationCtxFreedCount).toBe(0);
      return;
    }

    expect.unreachable("Should have caught an error");
  });

  // This test segfaults on purpose. Windows: never worked. ASAN: traps the SEGV
  // and aborts before the crash handler can print the name. musl: the crash
  // handler re-raises and the agent writes a core, which the runner counts as a
  // failed job even though every test passed.
  it.skipIf(process.platform === "win32" || isASAN || isMusl)("prints name when plugin crashes", async () => {
    const build_code = /* ts */ `
    import * as path from "path";
    const tempdir = process.env.BUN_TEST_TEMP_DIR;
    const filter = /\.ts/;
    const resultPromise = await Bun.build({
      outdir: path.join(tempdir, "dist-crash"),
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

    const buildScript = path.join(tempdir, "crash-fixture.ts");
    await Bun.write(buildScript, build_code);
    // BUN_CRASH_REPORT_URL="": this segfault is deliberate; uploading it to
    // CI's remap server pins a spurious "crash reported" error on the next
    // unrelated failing test (runner only drains /traces on non-zero exit).
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", buildScript],
      env: { ...bunEnv, BUN_TEST_TEMP_DIR: tempdir, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('\x1b[31m\x1b[2m"native_plugin_test"\x1b[0m');
    expect(exitCode).not.toBe(0);
  });

  it("detects when plugin sets function pointer but does not user context pointer", async () => {
    const filter = /\.ts/;
    const outdir = path.join(tempdir, "dist-bad-free-function-pointer");

    const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
    const external = napiModule.createExternal();

    try {
      const resultPromise = await Bun.build({
        outdir,
        entrypoints: [path.join(tempdir, "index.ts")],
        plugins: [
          {
            name: "xXx123_foo_counter_321xXx",
            setup(build) {
              build.onBeforeParse(
                { filter },
                { napiModule, symbol: "plugin_impl_bad_free_function_pointer", external },
              );

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
    } catch (e) {
      const err = e as AggregateError;
      expect(err.errors[0].message).toContain(
        "Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field.",
      );
      expect(err.errors[0].level).toBe("error");
      const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
      expect(compilationCtxFreedCount).toBe(0);
      return;
    }

    expect.unreachable("Should have caught an error");
  });

  it("should fail gracefully when passing something that is NOT a bunler plugin", async () => {
    const outdir = path.join(tempdir, "dist-not-a-plugin");
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
      } catch (e: any) {
        expect(e.toString()).toContain(
          "onBeforeParse `napiModule` must be a Napi module which exports the `BUN_PLUGIN_NAME` symbol.",
        );
      }
    }
  });

  it("should fail gracefully when can't find the symbol", async () => {
    const outdir = path.join(tempdir, "dist-missing-symbol");
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
    } catch (e: any) {
      expect(e.toString()).toContain(
        'TypeError [ERR_INVALID_ARG_TYPE]: Could not find the symbol "OOGA_BOOGA_420" in the given napi module.',
      );
    }
  });

  it("keeps the onBeforeParse external alive across GC when JS drops its reference", async () => {
    // The external is passed inline with no other JS reference, and onLoad
    // forces a full GC after defer(); the NapiExternal must survive the build.
    const srcDir = path.join(tempdir, "gc_safe_src");
    const files = Array.from({ length: 40 }, (_, i) => `src${i}.ts`);
    await Promise.all(files.map(f => Bun.write(path.join(srcDir, f), `export const v = "foo foo foo";\n`)));
    const imports = files.map((f, i) => `import { v as v${i} } from "./gc_safe_src/${f}";`).join("\n");
    await Bun.write(
      path.join(tempdir, "gc_safe_index.ts"),
      `${imports}\nimport j from "./gc_safe_trigger.json";\nconsole.log(j, ${files.map((_, i) => `v${i}`).join("+")});\n`,
    );
    await Bun.write(path.join(tempdir, "gc_safe_trigger.json"), "{}");

    const buildScript = /* ts */ `
      import * as path from "path";
      const tempdir = process.env.BUN_TEST_TEMP_DIR!;
      const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));

      let finalizedDuringBuild = -1;
      const result = await Bun.build({
        outdir: path.join(tempdir, "dist-gc-safe"),
        entrypoints: [path.join(tempdir, "gc_safe_index.ts")],
        plugins: [
          {
            name: "gc-safe",
            setup(build) {
              build.onBeforeParse(
                { filter: /\\.ts$/ },
                { napiModule, symbol: "plugin_impl", external: napiModule.createExternal() },
              );
              build.onLoad({ filter: /gc_safe_trigger\\.json$/ }, async ({ defer }) => {
                await defer();
                Bun.gc(true);
                await Bun.sleep(0);
                Bun.gc(true);
                finalizedDuringBuild = napiModule.getExternalFinalizedCount();
                return { contents: "{}", loader: "json" };
              });
            },
          },
        ],
      });
      console.log(JSON.stringify({
        success: result.success,
        finalizedDuringBuild,
        finalizedAfterBuild: napiModule.getExternalFinalizedCount(),
      }));
    `;
    await Bun.write(path.join(tempdir, "gc_safe_build.ts"), buildScript);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(tempdir, "gc_safe_build.ts")],
      env: { ...bunEnv, BUN_TEST_TEMP_DIR: tempdir },
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const resultLine = stdout.split("\n").find(line => line.startsWith('{"success"'));
    const parsed = resultLine ? JSON.parse(resultLine) : { stderr, stdout };
    expect(parsed).toEqual({ success: true, finalizedDuringBuild: 0, finalizedAfterBuild: 0 });
    expect(exitCode).toBe(0);
  });

  it("should use result of the first plugin that runs and doesn't execute the others", async () => {
    const filter = /\.ts/;
    const outdir = path.join(tempdir, "dist-first-plugin");

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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();
    expect(await runBundle(path.join(outdir, "index.js"))).toEqual({
      stdout: '{"fooCount":9,"barCount":0,"bazCount":0}\n',
      stderr: "",
      exitCode: 0,
    });

    const compilationCtxFreedCount = await napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("frees the plugin-provided source exactly once when the replaced contents fail to parse", async () => {
    await Bun.write(path.join(tempdir, "needs_foo.json"), `{ "a": foo }`);
    await Bun.write(
      path.join(tempdir, "json_entry.ts"),
      `import json from "./needs_foo.json";\nconsole.log(JSON.stringify(json));\n`,
    );
    await Bun.write(path.join(tempdir, "after_json_entry.ts"), `export const ok = 1;\n`);

    const buildScript = `
      import * as path from "path";
      const tempdir = process.env.BUN_TEST_TEMP_DIR;
      const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
      const external = napiModule.createExternal();
      let failed = false;
      try {
        await Bun.build({
          outdir: path.join(tempdir, "dist-json-entry"),
          entrypoints: [path.join(tempdir, "json_entry.ts")],
          plugins: [
            {
              name: "xXx123_foo_counter_321xXx",
              setup(build) {
                build.onBeforeParse({ filter: /\\.json$/ }, { napiModule, symbol: "plugin_impl", external });
              },
            },
          ],
        });
      } catch (e) {
        failed = true;
      }
      await Bun.build({
        outdir: path.join(tempdir, "dist-after-json-entry"),
        entrypoints: [path.join(tempdir, "after_json_entry.ts")],
      });
      console.log(JSON.stringify({ failed, freed: napiModule.getCompilationCtxFreedCount(external) }));
    `;
    await Bun.write(path.join(tempdir, "json-entry-fixture.ts"), buildScript);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(tempdir, "json-entry-fixture.ts")],
      env: { ...bunEnv, BUN_TEST_TEMP_DIR: tempdir },
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("Freed compilation ctx!").length - 1).toBe(1);
    const resultLine = stdout.split("\n").find(line => line.startsWith('{"failed"'));
    expect(resultLine).toBe('{"failed":true,"freed":1}');
    expect(exitCode).toBe(0);
  });

  // plugin_impl rewrites "foo" to "qoo". Each text fixture holds "foo" once.
  // The expectations avoid a bare "foo"/"qoo" match because the bundle's path
  // comments contain the random tempdir name.
  type AdditionalFile = {
    title: string;
    name: string;
    contents: BunFile | Uint8Array | string;
    // What the entry bundle must contain once the rewritten module is inlined.
    inlined?: string;
    // What the emitted asset must be, byte for byte (file loader).
    asset?: BunFile | Uint8Array;
  };
  // bun.png holds no "foo", so the plugin hands it back untouched.
  const png = Bun.file(path.join(import.meta.dir, "../integration/sharp/bun.png"));
  const additional_files: AdditionalFile[] = [
    { title: "works with file loader", name: "probe_asset.png", contents: png, asset: png },
    {
      // Both "foo" are rewritten, also the one after the NUL. The other bytes
      // must come out unchanged.
      title: "works with file loader when the plugin rewrites the asset",
      name: "probe_asset.bin",
      contents: Buffer.from("\x89BIN foo \x00\x01\xff\xfefoo\x00", "latin1"),
      asset: Buffer.from("\x89BIN qoo \x00\x01\xff\xfeqoo\x00", "latin1"),
    },
    {
      title: "works with js loader",
      name: "loader.js",
      contents: /* js */ `export default "HELLO foo FRIENDS";\n`,
      inlined: "HELLO qoo FRIENDS",
    },
    {
      title: "works with ts loader",
      name: "loader.ts",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      inlined: "HELLO qoo FRIENDS",
    },
    {
      title: "works with jsx loader",
      name: "loader.jsx",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      inlined: "HELLO qoo FRIENDS",
    },
    {
      title: "works with tsx loader",
      name: "loader.tsx",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      inlined: "HELLO qoo FRIENDS",
    },
    {
      title: "works with toml loader",
      name: "loader.toml",
      contents: /* toml */ `hello = "foo"\n`,
      inlined: `"qoo"`,
    },
    {
      title: "works with text loader",
      name: "loader.txt",
      contents: "HELLO foo FRIENDS\n",
      inlined: "HELLO qoo FRIENDS",
    },
  ];

  for (const { title, name, contents, inlined, asset } of additional_files) {
    it(title, async () => {
      const tag = name.replace(/\W+/g, "_");
      const entry = path.join(tempdir, `entry_${tag}.ts`);
      await Bun.write(path.join(tempdir, name), contents);
      await Bun.write(entry, `import val from "./${name}";\nconsole.log(val);`);

      const result = await Bun.build({
        outdir: path.join(tempdir, `dist-${tag}`),
        entrypoints: [entry],
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
      });

      expect(result.logs).toEqual([]);
      expect(result.success).toBeTrue();
      const entryText = await result.outputs.find(o => o.kind === "entry-point")!.text();
      if (inlined !== undefined) {
        expect(entryText).toContain(inlined);
      }
      if (asset !== undefined) {
        const emitted = result.outputs.find(o => o.kind === "asset");
        expect(emitted).toBeDefined();
        expect(entryText).toContain(path.basename(emitted!.path));
        const emittedBytes = Buffer.from(await emitted!.arrayBuffer());
        const expectedBytes = asset instanceof Blob ? Buffer.from(await asset.arrayBuffer()) : Buffer.from(asset);
        expect(emittedBytes.length).toBe(expectedBytes.length);
        expect(emittedBytes.equals(expectedBytes)).toBeTrue();
      }
    });
  }
});
