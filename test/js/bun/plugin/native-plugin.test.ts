import { plugin } from "bun";
import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import path, { dirname, join, resolve } from "path";
import source from "./native_plugin.c" with { type: "file" };
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { itBundled } from "bundler/expectBundled";

describe("native-plugins", () => {
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
  });

  test("basic", async () => {
    const files = {
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
console.log(JSON.stringify(json));`,
      "stuff.ts": `sdfjldjfakdjfsdf`,
      "lmao.json": ``,
      "binding.gyp": /* gyp */ `{
        "targets": [
          {
            "target_name": "xXx123_foo_counter_321xXx",
            "sources": [ "plugin.c" ]
          }
        ]
      }`,
    };

    const tempdir = tempDirWithFiles("native-plugins", files);

    process.chdir(tempdir);
    console.log("Tempdir", tempdir);

    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);

    const result = await Bun.build({
      outdir: path.join(tempdir, "dist"),
      entrypoints: [path.join(tempdir, "index.ts")],
      plugins: [
        {
          name: "xXx123_foo_counter_321xXx",
          setup(build) {
            const napiModule = require(path.join(tempdir, "build/Release/xXx123_foo_counter_321xXx.node"));
            console.log("napi module", napiModule);
            const external = napiModule.createExternal();

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
    expect(output).toStrictEqual({ fooCount: 8 });
  });
});
