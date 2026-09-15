import { BunFile, Loader } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isMusl, tempDirWithFiles } from "harness";
import path from "path";
import bundlerPluginHeader from "../../packages/bun-native-bundler-plugin-api/bundler_plugin.h" with { type: "file" };
import source from "./native_plugin.cc" with { type: "file" };
import notAPlugin from "./not_native_plugin.cc" with { type: "file" };

// Every test writes to its own entrypoint and outdir under the shared tempdir,
// and each Bun.build uses an independent native external, so nothing here
// shares mutable state; describe.concurrent lets the subprocess spawns overlap.
describe.concurrent("native-plugins", async () => {
  let tempdir: string = "";
  let napiModule: any;

  // The default entry for tests that don't need a custom one: imports stuff.ts and lmao.json.
  // "foo" appears 8 times here and once in stuff.ts, so a single pass of plugin_impl counts 9.
  const baseIndex = /* ts */ `import values from "./stuff.ts";
import json from "./lmao.json";
const many_foo = ["foo","foo","foo","foo","foo","foo","foo"]
const many_bar = ["bar","bar","bar","bar","bar","bar","bar"]
const many_baz = ["baz","baz","baz","baz","baz","baz","baz"]
console.log(JSON.stringify(json));
values;`;

  beforeAll(async () => {
    tempdir = tempDirWithFiles("native-plugins", {
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
      "index.ts": baseIndex,
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
    });

    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);
    napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
  });

  async function writeEntry(name: string, contents: string) {
    const entry = path.join(tempdir, name);
    await Bun.write(entry, contents);
    return { entry, outdir: path.join(tempdir, "dist-" + name.replace(/\W+/g, "_")) };
  }

  async function runBundle(outdir: string, file = "index.js") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(outdir, file)],
      env: bunEnv,
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("works in a basic case", async () => {
    const outdir = path.join(tempdir, "dist-basic");
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
    const { stdout, stderr, exitCode } = await runBundle(outdir);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toStrictEqual({ fooCount: 9 });
    expect(exitCode).toBe(0);

    const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when there are a lot of concurrent files", async () => {
    const files: [string, string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files/lmao${i}.json";`, `json${i}`];
      }),
    );

    const entrySrc = [
      `import values from "./stuff.ts";`,
      `const many_foo = ["foo","foo","foo","foo","foo","foo","foo"];`,
      ...files.map(([imp]) => imp),
      ...files.map(([, v]) => `console.log(JSON.stringify(${v}));`),
      `values;`,
    ].join("\n");
    const { entry, outdir } = await writeEntry("entry_many.ts", entrySrc);

    const external = napiModule.createExternal();
    const result = await Bun.build({
      outdir,
      entrypoints: [entry],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer }) => {
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
    const { stdout, stderr, exitCode } = await runBundle(outdir, "entry_many.js");
    expect(stderr).toBe("");
    const outputJsons = stdout
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    expect(outputJsons).toHaveLength(100);
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 9 });
    }
    expect(exitCode).toBe(0);

    const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  // We clone the RegExp object in the C++ code so this test ensures that there
  // is no funny business regarding the filter regular expression and multiple
  // threads
  it("doesn't explode when there are a lot of concurrent files AND the filter regex is used on the JS thread", async () => {
    const filter = /\.ts/;
    const files: [string, string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files_regex", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files_regex/lmao${i}.json";`, `json${i}`];
      }),
    );

    const entrySrc = [
      `import values from "./stuff.ts";`,
      `const many_foo = ["foo","foo","foo","foo","foo","foo","foo"];`,
      ...files.map(([imp]) => imp),
      ...files.map(([, v]) => `console.log(JSON.stringify(${v}));`),
      `(() => values)();`,
    ].join("\n");
    const { entry, outdir } = await writeEntry("entry_regex.ts", entrySrc);

    const external = napiModule.createExternal();
    const resultPromise = Bun.build({
      outdir,
      entrypoints: [entry],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer }) => {
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
    const { stdout, stderr, exitCode } = await runBundle(outdir, "entry_regex.js");
    expect(stderr).toBe("");
    const outputJsons = stdout
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    expect(outputJsons).toHaveLength(100);
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 9 });
    }
    expect(exitCode).toBe(0);

    const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
    expect(compilationCtxFreedCount).toBe(2);
  });

  it("doesn't explode when passing invalid external", async () => {
    const files: [string, string][] = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await Bun.write(path.join(tempdir, "json_files_noext", `lmao${i}.json`), `{}`);
        return [`import json${i} from "./json_files_noext/lmao${i}.json";`, `json${i}`];
      }),
    );

    const entrySrc = [
      `import values from "./stuff.ts";`,
      `const many_foo = ["foo","foo","foo","foo","foo","foo","foo"];`,
      ...files.map(([imp]) => imp),
      ...files.map(([, v]) => `console.log(JSON.stringify(${v}));`),
      `values;`,
    ].join("\n");
    const { entry, outdir } = await writeEntry("entry_noext.ts", entrySrc);

    const result = await Bun.build({
      outdir,
      entrypoints: [entry],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            const external = undefined;
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });

            build.onLoad({ filter: /\.json/ }, async ({ defer }) => {
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
    const { stdout, stderr, exitCode } = await runBundle(outdir, "entry_noext.js");
    expect(stderr).toBe("");
    const outputJsons = stdout
      .trim()
      .split("\n")
      .map(s => JSON.parse(s));
    expect(outputJsons).toHaveLength(100);
    for (const json of outputJsons) {
      expect(json).toStrictEqual({ fooCount: 0 });
    }
    expect(exitCode).toBe(0);
  });

  it("works when logging an error", async () => {
    const { entry, outdir } = await writeEntry(
      "entry_err.ts",
      `import values from "./stuff.ts";\nconst many_foo = ["foo","foo","foo","foo","foo","foo","foo"];\nvalues;`,
    );
    const external = napiModule.createExternal();

    try {
      await Bun.build({
        outdir,
        entrypoints: [entry],
        plugins: [
          {
            name: "xXx123_foo_counter_321xXx",
            setup(build) {
              napiModule.setThrowsErrors(external, true);
              build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });
            },
          },
        ],
      });
    } catch (e) {
      const err = e as AggregateError;
      expect(err.errors[0].message).toContain("Throwing an error");
      expect(err.errors[0].level).toBe("error");

      const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
      expect(compilationCtxFreedCount).toBe(0);
      return;
    }
    expect.unreachable("Should have caught an error");
  });

  it("works with versioning", async () => {
    const { entry, outdir } = await writeEntry(
      "entry_ver.ts",
      `import values from "./stuff.ts";\nconst many_foo = ["foo","foo","foo","foo","foo","foo","foo"];\nvalues;`,
    );
    const external = napiModule.createExternal();

    try {
      await Bun.build({
        outdir,
        entrypoints: [entry],
        plugins: [
          {
            name: "xXx123_foo_counter_321xXx",
            setup(build) {
              build.onBeforeParse(
                { filter: /\.ts/ },
                { napiModule, symbol: "incompatible_version_plugin_impl", external },
              );
            },
          },
        ],
      });
    } catch (e) {
      const err = e as AggregateError;
      expect(err.errors[0].message).toContain(
        "This plugin is built for a newer version of Bun than the one currently running.",
      );
      const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
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
    await Bun.write(
      path.join(tempdir, "entry_crash.ts"),
      `import values from "./stuff.ts";\nconst many_foo = ["foo","foo","foo","foo","foo","foo","foo"];\nvalues;`,
    );

    const build_code = /* ts */ `
    import * as path from "path";
    const tempdir = process.env.BUN_TEST_TEMP_DIR;
    const filter = /\\.ts/;
    const resultPromise = await Bun.build({
      outdir: path.join(tempdir, "dist-crash"),
      entrypoints: [path.join(tempdir, "entry_crash.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
            const external = napiModule.createExternal();
            napiModule.setWillCrash(external, true);

            build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl", external });
          },
        },
      ],
    });
    console.log(resultPromise);
    `;

    await Bun.write(path.join(tempdir, "build_crash.ts"), build_code);
    // BUN_CRASH_REPORT_URL="": this segfault is deliberate; uploading it to
    // CI's remap server pins a spurious "crash reported" error on the next
    // unrelated failing test (runner only drains /traces on non-zero exit).
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(tempdir, "build_crash.ts")],
      env: { ...bunEnv, BUN_TEST_TEMP_DIR: tempdir, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: tempdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('\x1b[31m\x1b[2m"native_plugin_test"\x1b[0m');
  });

  it("detects when plugin sets function pointer but does not user context pointer", async () => {
    const { entry, outdir } = await writeEntry(
      "entry_badfree.ts",
      `import values from "./stuff.ts";\nconst many_foo = ["foo","foo","foo","foo","foo","foo","foo"];\nvalues;`,
    );
    const external = napiModule.createExternal();

    try {
      await Bun.build({
        outdir,
        entrypoints: [entry],
        plugins: [
          {
            name: "xXx123_foo_counter_321xXx",
            setup(build) {
              build.onBeforeParse(
                { filter: /\.ts/ },
                { napiModule, symbol: "plugin_impl_bad_free_function_pointer", external },
              );
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
      const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
      expect(compilationCtxFreedCount).toBe(0);
      return;
    }

    expect.unreachable("Should have caught an error");
  });

  it("should fail gracefully when passing something that is NOT a bundler plugin", async () => {
    const not_plugins = [require(path.join(tempdir, "build/Release/not_a_plugin.node")), 420, "hi", {}];
    const outdir = path.join(tempdir, "dist-not-a-plugin");

    for (const bad of not_plugins) {
      try {
        await Bun.build({
          outdir,
          entrypoints: [path.join(tempdir, "index.ts")],
          plugins: [
            {
              name: "not_a_plugin",
              setup(build) {
                build.onBeforeParse({ filter: /\.ts/ }, { napiModule: bad, symbol: "plugin_impl" });
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
    const outdir = path.join(tempdir, "dist-no-symbol");
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
    const { entry, outdir } = await writeEntry("entry_first.ts", baseIndex);
    const external = napiModule.createExternal();

    const result = await Bun.build({
      outdir,
      entrypoints: [entry],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl", external });
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl_bar", external });
            build.onBeforeParse({ filter: /\.ts/ }, { napiModule, symbol: "plugin_impl_baz", external });

            build.onLoad({ filter: /lmao\.json/ }, async ({ defer }) => {
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

    expect(result.logs).toEqual([]);
    expect(result.success).toBeTrue();

    const { stdout, stderr, exitCode } = await runBundle(outdir, "entry_first.js");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toStrictEqual({ fooCount: 9, barCount: 0, bazCount: 0 });
    expect(exitCode).toBe(0);

    const compilationCtxFreedCount = napiModule.getCompilationCtxFreedCount(external);
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
    await Bun.write(path.join(tempdir, "json_entry_build.ts"), buildScript);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(tempdir, "json_entry_build.ts")],
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

  type AdditionalFile = {
    name: string;
    contents: BunFile | string;
    loader: Loader;
    // Substring that must appear in the bundled entry output if the plugin ran
    // (i.e. "foo" in the source was rewritten to "qoo"). onBeforeParse does fire
    // for the file loader too, but a PNG's first NUL byte stops the plugin's
    // strstr before it can find "foo", so there is no rewrite to observe; that
    // case instead asserts the asset survived the round-trip.
    expectTransformed?: string;
  };
  const additional_files: AdditionalFile[] = [
    {
      name: "probe_asset.png",
      contents: Bun.file(path.join(import.meta.dir, "../integration/sharp/bun.png")),
      loader: "file",
    },
    {
      name: "loader.js",
      contents: /* js */ `export default "HELLO foo FRIENDS";\n`,
      loader: "js",
      expectTransformed: "HELLO qoo FRIENDS",
    },
    {
      name: "loader.ts",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      loader: "ts",
      expectTransformed: "HELLO qoo FRIENDS",
    },
    {
      name: "loader.jsx",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      loader: "jsx",
      expectTransformed: "HELLO qoo FRIENDS",
    },
    {
      name: "loader.tsx",
      contents: /* ts */ `export default "HELLO foo FRIENDS";\n`,
      loader: "tsx",
      expectTransformed: "HELLO qoo FRIENDS",
    },
    {
      name: "loader.toml",
      contents: /* toml */ `hello = "foo"\n`,
      loader: "toml",
      expectTransformed: "qoo",
    },
    {
      name: "loader.txt",
      contents: "HELLO foo FRIENDS\n",
      loader: "text",
      expectTransformed: "HELLO qoo FRIENDS",
    },
  ];

  for (const { name, contents, loader, expectTransformed } of additional_files) {
    it(`works with ${loader} loader`, async () => {
      const assetPath = path.join(tempdir, name);
      await Bun.write(assetPath, contents);
      const { entry, outdir } = await writeEntry(
        `entry_loader_${loader}.ts`,
        `import val from "./${name}";\nconsole.log(val);`,
      );

      const ext = name.split(".").pop()!;
      const filter = new RegExp(`\\.${ext}$`);
      const result = await Bun.build({
        outdir,
        entrypoints: [entry],
        plugins: [
          {
            name: "test",
            setup(build) {
              build.onBeforeParse({ filter }, { napiModule, symbol: "plugin_impl" });
            },
          },
        ],
      });

      expect(result.logs).toEqual([]);
      expect(result.success).toBeTrue();
      const output = result.outputs.find(o => o.kind === "entry-point");
      expect(output).toBeDefined();
      const text = await output!.text();
      if (expectTransformed) {
        expect(text).toContain(expectTransformed);
        expect(text).not.toContain("foo");
      } else {
        // file loader: plugin ran but found no "foo" in the PNG bytes, so the
        // bundler must still emit the asset and reference it from the entry.
        const asset = result.outputs.find(o => o.kind === "asset" && o.path.endsWith("." + ext));
        expect(asset).toBeDefined();
        expect(text).toContain(path.basename(asset!.path));
      }
    });
  }
});
