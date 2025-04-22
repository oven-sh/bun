import { fileURLToPath, Loader } from "bun";
import { describe, expect } from "bun:test";
import fs, { readdirSync } from "node:fs";
import { join } from "path";
import { itBundled } from "./expectBundled";

describe("bundler", async () => {
  for (let target of ["bun", "node"] as const) {
    describe(`${target} loader`, async () => {
      itBundled("bun/loader-text-file", {
        target,
        outfile: "",
        outdir: "/out",

        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.foo' with {type: "text"};
        console.log(hello);
      `,
          "/hello.foo": "Hello, world!",
        },
        run: { stdout: "Hello, world!" },
      });
      itBundled("bun/loader-json-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.notjson' with {type: "json"};
        console.write(JSON.stringify(hello));
      `,
          "/hello.notjson": JSON.stringify({ hello: "world" }),
        },
        run: { stdout: '{"hello":"world"}' },
      });
      itBundled("bun/loader-toml-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.nottoml' with {type: "toml"};
        console.write(JSON.stringify(hello));
      `,
          "/hello.nottoml": `hello = "world"`,
        },
        run: { stdout: '{"hello":"world"}' },
      });
      itBundled("bun/loader-text-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.json' with {type: "text"};
        console.write(hello);
      `,
          "/hello.json": JSON.stringify({ hello: "world" }),
        },
        run: { stdout: '{"hello":"world"}' },
      });
    });
  }

  itBundled("bun/loader-text-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import first from './1.boo' with {type: "text"};
    import second from './2.boo' with {type: "text"};
    console.write(first + second);
  `,
      "/1.boo": "'`Hello, \nworld!`",
      "/2.boo": "`${Hello}\n, world!`'",
    },
    run: {
      stdout: "'`Hello, \nworld!``${Hello}\n, world!`'",
    },
  });

  itBundled("bun/wasm-is-copied-to-outdir", {
    target: "bun",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import wasm from './add.wasm';
    import { join } from 'path';
    const { instance } = await WebAssembly.instantiate(await Bun.file(join(import.meta.dir, wasm)).arrayBuffer());
    console.log(instance.exports.add(1, 2));
  `,
      "/add.wasm": fs.readFileSync(join(import.meta.dir, "fixtures", "add.wasm")),
    },
    run: {
      stdout: "3",
    },
  });

  const moon = await Bun.file(
    fileURLToPath(import.meta.resolve("../js/bun/util/text-loader-fixture-text-file.backslashes.txt")),
  ).text();

  // https://github.com/oven-sh/bun/issues/3449
  itBundled("bun/loader-text-file-#3449", {
    target: "bun",
    outfile: "",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import first from './1.boo' with {type: "text"};
    console.write(first);
  `,
      "/1.boo": moon,
    },
    run: {
      stdout: moon,
    },
  });

  const loaders: Loader[] = ["wasm", "json", "file" /* "napi" */, "text"];
  const exts = ["wasm", "json", "lmao" /*  ".node" */, "txt"];
  for (let i = 0; i < loaders.length; i++) {
    const loader = loaders[i];
    const ext = exts[i];
    itBundled(`bun/loader-copy-file-entry-point-with-onLoad-${loader}`, {
      target: "bun",
      outdir: "/out",
      files: {
        [`/entry.${ext}`]: /* js */ `{ "hello": "friends" }`,
      },
      entryNaming: "[dir]/[name]-[hash].[ext]",
      plugins(builder) {
        builder.onLoad({ filter: new RegExp(`.${loader}$`) }, async ({ path }) => {
          const result = await Bun.file(path).text();
          return { contents: result, loader };
        });
      },
      onAfterBundle(api) {
        const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
        const module = require(join(api.outdir, jsFile));

        if (loader === "json") {
          expect(module.default).toStrictEqual({ hello: "friends" });
        } else if (loader === "text") {
          expect(module.default).toStrictEqual('{ "hello": "friends" }');
        } else {
          api.assertFileExists(join("out", module.default));
        }
      },
    });
  }

  for (let i = 0; i < loaders.length; i++) {
    const loader = loaders[i];
    const ext = exts[i];
    itBundled(`bun/loader-copy-file-entry-point-${loader}`, {
      target: "bun",
      outfile: "",
      outdir: "/out",
      files: {
        [`/entry.${ext}`]: /* js */ `{ "hello": "friends" }`,
      },
      entryNaming: "[dir]/[name]-[hash].[ext]",
      onAfterBundle(api) {
        const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
        const module = require(join(api.outdir, jsFile));

        if (loader === "json") {
          expect(module.default).toStrictEqual({ hello: "friends" });
        } else if (loader === "text") {
          expect(module.default).toStrictEqual('{ "hello": "friends" }');
        } else {
          api.assertFileExists(join("out", module.default));
        }
      },
    });
  }

  describe("handles empty files", () => {
    const emptyFilePath = "/empty-file";
    const emptyFileContent = "";

    itBundled("bun/loader-empty-text-file", {
      target: "bun",
      files: {
        "/entry.ts": /* js */ `
          import empty from './empty-file' with {type: "text"};
          console.write(JSON.stringify(empty));
        `,
        [emptyFilePath]: emptyFileContent,
      },
      run: { stdout: '""' },
    });

    // itBundled("bun/loader-empty-file-loader", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import empty from './empty-file' with {type: "file"};
    //       console.write(JSON.stringify(empty));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: JSON.stringify(emptyFilePath) },
    // });

    // itBundled("bun/loader-empty-css-file", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import empty from './empty-file' with {type: "css"};
    //       console.write(JSON.stringify(empty));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: JSON.stringify(emptyFilePath) },
    // });

    // itBundled("bun/loader-empty-html-file", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import empty from './empty-file' with {type: "html"};
    //       console.write(JSON.stringify(empty.index));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: JSON.stringify(emptyFilePath) },
    // });

    // itBundled("bun/loader-empty-js-like-file", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import empty from './empty-file' with {type: "js"};
    //       console.write(JSON.stringify({ ...empty, default: empty.default }));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: JSON.stringify({ default: undefined }) },
    // });

    // itBundled("bun/loader-empty-json-file-throws", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       try {
    //         import('./empty-file', { with: { type: "json" } })
    //           .then(() => console.write("should not succeed"))
    //           .catch(e => console.write(e.message));
    //       } catch (e) {
    //         console.write(e.message);
    //       }
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: {
    //     // Accept either error message variant
    //     stdout: /JSON Parse error: Unexpected EOF|Unexpected end of JSON input/i,
    //   },
    // });

    // itBundled("bun/loader-empty-jsonc-toml-file", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import emptyJsonc from './empty-file' with {type: "jsonc"};
    //       import emptyToml from './empty-file' with {type: "toml"};
    //       console.write(JSON.stringify([emptyJsonc.default, emptyToml.default]));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: "[{},{}]" },
    // });

    // itBundled("bun/loader-empty-other-types", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import emptyWasm from './empty-file' with {type: "wasm"};
    //       import emptyBase64 from './empty-file' with {type: "base64"};
    //       import emptyDataurl from './empty-file' with {type: "dataurl"};
    //       console.write(JSON.stringify([emptyWasm, emptyBase64, emptyDataurl]));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: JSON.stringify([emptyFilePath, emptyFilePath, emptyFilePath]) },
    // });

    // itBundled("bun/loader-empty-sqlite-files", {
    //   target: "bun",
    //   files: {
    //     "/entry.ts": /* js */ `
    //       import { Database } from "bun:sqlite";
    //       import emptySqlite from './empty-file' with {type: "sqlite"};
    //       import emptySqliteEmbedded from './empty-file' with {type: "sqlite_embedded"};
    //       console.write([
    //         emptySqlite.default instanceof Database,
    //         emptySqlite.db instanceof Database,
    //         emptySqliteEmbedded.default instanceof Database,
    //         emptySqliteEmbedded.db instanceof Database
    //       ].join(","));
    //     `,
    //     [emptyFilePath]: emptyFileContent,
    //   },
    //   run: { stdout: "true,true,true,true" },
    // });
  });
});
